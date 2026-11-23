import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDeletionSnapshot,
  entityTypeLabel,
  recordDeletion,
  summarizeDeletedRow,
  validateDeletionReason,
} from "@/lib/deletion-audit";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";

export type DeletionApprovalRequest = {
  id: string;
  company_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  entity_type: string;
  entity_id: string;
  entity_code: string | null;
  summary: string | null;
  screen_key: string | null;
  delete_mode: "soft" | "hard";
  reason: string;
  reason_code: string | null;
  payload_json: Record<string, unknown> | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_by_email: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  audit_event_id: string | null;
};

async function resolveActor(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ userId: string | null; name: string | null; email: string | null }> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return { userId: null, name: null, email: null };

  const email = user.email ?? null;
  let name: string | null =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    null;

  const { data: member } = await supabase
    .from("company_members")
    .select("partner_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (member?.partner_id) {
    const { data: partner } = await supabase
      .from("partners")
      .select("name")
      .eq("id", member.partner_id)
      .maybeSingle();
    if (partner?.name) name = partner.name as string;
  }

  if (!name && email) name = email.split("@")[0] ?? email;
  return { userId: user.id, name, email };
}

export async function createDeletionApprovalRequest(input: {
  supabase: SupabaseClient;
  companyId: string;
  entityType: string;
  entityId: string;
  entityCode?: string | null;
  summary?: string | null;
  screenKey?: string | null;
  deleteMode: "soft" | "hard";
  reason: string;
  reasonCode?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<{ error: string | null; id?: string }> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  const reasonError = validateDeletionReason(reason);
  if (reasonError) return { error: reasonError };

  const actor = await resolveActor(input.supabase, input.companyId);
  const { data, error } = await input.supabase
    .from("deletion_approval_requests")
    .insert({
      company_id: input.companyId,
      status: "pending",
      entity_type: input.entityType,
      entity_id: String(input.entityId),
      entity_code: input.entityCode ?? null,
      summary: input.summary ?? null,
      screen_key: input.screenKey ?? null,
      delete_mode: input.deleteMode,
      reason,
      reason_code: input.reasonCode ?? null,
      payload_json: buildDeletionSnapshot(input.payload),
      requested_by: actor.userId,
      requested_by_name: actor.name,
      requested_by_email: actor.email,
    })
    .select("id")
    .single();

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("uq_deletion_approval_pending_entity") || msg.includes("duplicate")) {
      return {
        error: `Já existe um pedido pendente para este ${entityTypeLabel(input.entityType).toLowerCase()}.`,
      };
    }
    if (msg.includes("does not exist") || msg.includes("não existe")) {
      return {
        error:
          "Tabela de pedidos de exclusão ainda não existe. Aplique apply-055-deletion-approval-hard-restore-alerts.sql no Supabase.",
      };
    }
    return { error: error.message };
  }

  return { error: null, id: data?.id as string };
}

export async function listPendingDeletionApprovals(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: DeletionApprovalRequest[]; error: string | null }> {
  const { data, error } = await supabase
    .from("deletion_approval_requests")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(100);

  if (error) {
    if (
      error.message.toLowerCase().includes("does not exist") ||
      error.message.toLowerCase().includes("não existe")
    ) {
      return { rows: [], error: null };
    }
    return { rows: [], error: error.message };
  }

  return { rows: (data ?? []) as DeletionApprovalRequest[], error: null };
}

export async function rejectDeletionApprovalRequest(input: {
  supabase: SupabaseClient;
  companyId: string;
  requestId: string;
  reviewNote?: string | null;
}): Promise<{ error: string | null }> {
  const actor = await resolveActor(input.supabase, input.companyId);
  const { error } = await input.supabase
    .from("deletion_approval_requests")
    .update({
      status: "rejected",
      reviewed_by: actor.userId,
      reviewed_by_name: actor.name,
      reviewed_by_email: actor.email,
      reviewed_at: new Date().toISOString(),
      review_note: input.reviewNote?.trim() || "Pedido rejeitado pelo administrador.",
    })
    .eq("id", input.requestId)
    .eq("company_id", input.companyId)
    .eq("status", "pending");

  if (!error) {
    await enqueueDeletionAlert({
      supabase: input.supabase,
      companyId: input.companyId,
      alertType: "approval_rejected",
      title: "Pedido de exclusão rejeitado",
      body: `Um pedido de exclusão foi rejeitado por ${actor.name || actor.email || "admin"}.`,
      meta: { requestId: input.requestId },
    });
  }

  return { error: error?.message ?? null };
}

/** Admin aprova: executa a exclusão real + grava auditoria + fecha o pedido. */
export async function approveDeletionApprovalRequest(input: {
  supabase: SupabaseClient;
  companyId: string;
  request: DeletionApprovalRequest;
  reviewNote?: string | null;
}): Promise<{ error: string | null }> {
  const req = input.request;
  if (req.status !== "pending") return { error: "Este pedido já foi revisado." };

  const table = req.entity_type;
  const id = req.entity_id;
  let existing = req.payload_json;

  const { data: live } = await input.supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (live) existing = live as Record<string, unknown>;
  if (!existing) {
    return {
      error:
        "Registro não está mais disponível para exclusão (já excluído ou inexistente). Rejeite o pedido.",
    };
  }

  const actor = await resolveActor(input.supabase, input.companyId);
  let auditId: string | null = null;

  if (table === "financial_transactions") {
    const { data: auditedId, error: rpcError } = await input.supabase.rpc(
      "delete_financial_transaction_audited",
      {
        p_id: id,
        p_reason: req.reason,
        p_reason_code: req.reason_code,
        p_screen_key: req.screen_key,
      },
    );
    if (rpcError) return { error: rpcError.message };
    auditId = (auditedId as string | null) ?? null;
  } else {
    const { entityCode, summary } = summarizeDeletedRow(existing, table);
    const logged = await recordDeletion({
      supabase: input.supabase,
      companyId: input.companyId,
      entityType: table,
      entityId: id,
      entityCode: req.entity_code || entityCode,
      summary: req.summary || summary,
      reason: req.reason,
      reasonCode: req.reason_code,
      screenKey: req.screen_key,
      deleteMode: req.delete_mode,
      payload: existing,
    });
    if (logged.error) return { error: logged.error };

    const { error: delErr } =
      req.delete_mode === "soft"
        ? await input.supabase
            .from(table)
            .update(
              table === "partners"
                ? { deleted_at: new Date().toISOString(), status: "Inativo" }
                : { deleted_at: new Date().toISOString() }
            )
            .eq("id", id)
            .eq("company_id", input.companyId)
        : await input.supabase.from(table).delete().eq("id", id).eq("company_id", input.companyId);

    if (delErr) return { error: delErr.message };

    const { data: auditRow } = await input.supabase
      .from("deletion_audit_events")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("entity_type", table)
      .eq("entity_id", String(id))
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    auditId = (auditRow?.id as string | undefined) ?? null;
  }

  const { error } = await input.supabase
    .from("deletion_approval_requests")
    .update({
      status: "approved",
      reviewed_by: actor.userId,
      reviewed_by_name: actor.name,
      reviewed_by_email: actor.email,
      reviewed_at: new Date().toISOString(),
      review_note: input.reviewNote?.trim() || "Pedido aprovado e exclusão executada.",
      audit_event_id: auditId,
    })
    .eq("id", req.id)
    .eq("company_id", input.companyId)
    .eq("status", "pending");

  if (error) return { error: error.message };

  await enqueueDeletionAlert({
    supabase: input.supabase,
    companyId: input.companyId,
    alertType: "approval_executed",
    title: `Exclusão aprovada: ${entityTypeLabel(table)}`,
    body: `${actor.name || actor.email || "Admin"} aprovou e executou a exclusão de ${
      req.entity_code || req.summary || id
    }. Motivo: ${req.reason}`,
    entityType: table,
    entityId: id,
    meta: { requestId: req.id },
  });

  return { error: null };
}

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeletionAuditEvent = {
  id: string;
  company_id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  screen_key: string | null;
  entity_type: string;
  entity_id: string;
  entity_code: string | null;
  summary: string | null;
  reason: string | null;
  delete_mode: "soft" | "hard";
  payload_json: Record<string, unknown> | null;
};

export type RecordDeletionInput = {
  supabase: SupabaseClient;
  companyId: string;
  entityType: string;
  entityId: string;
  entityCode?: string | null;
  summary?: string | null;
  reason?: string | null;
  screenKey?: string | null;
  deleteMode: "soft" | "hard";
  payload?: Record<string, unknown> | null;
};

/** Campos úteis para resumo / código a partir de um registro genérico. */
export function summarizeDeletedRow(
  row: Record<string, unknown> | null | undefined,
  entityType: string
): { entityCode: string | null; summary: string } {
  if (!row) return { entityCode: null, summary: entityType };

  const code =
    (typeof row.code === "string" && row.code) ||
    (typeof row.plate === "string" && row.plate) ||
    null;

  const parts: string[] = [];
  if (typeof row.name === "string" && row.name.trim()) parts.push(row.name.trim());
  if (typeof row.client_name === "string" && row.client_name.trim()) {
    parts.push(row.client_name.trim());
  }
  if (typeof row.description === "string" && row.description.trim()) {
    parts.push(row.description.trim());
  }
  if (typeof row.plate === "string" && row.plate && row.plate !== code) {
    parts.push(row.plate);
  }
  if (row.amount != null && row.amount !== "") {
    parts.push(`R$ ${Number(row.amount).toFixed(2)}`);
  }
  if (typeof row.transaction_date === "string" && row.transaction_date) {
    parts.push(row.transaction_date);
  }
  if (typeof row.status === "string" && row.status) parts.push(row.status);

  const summary = parts.length > 0 ? parts.slice(0, 4).join(" · ") : entityType;
  return { entityCode: code, summary };
}

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

/** Grava evento de exclusão. Falha do log não bloqueia a exclusão (retorna erro só informativo). */
export async function recordDeletion(
  input: RecordDeletionInput
): Promise<{ error: string | null }> {
  const actor = await resolveActor(input.supabase, input.companyId);
  const { error } = await input.supabase.from("deletion_audit_events").insert({
    company_id: input.companyId,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    actor_email: actor.email,
    screen_key: input.screenKey ?? null,
    entity_type: input.entityType,
    entity_id: String(input.entityId),
    entity_code: input.entityCode ?? null,
    summary: input.summary ?? null,
    reason: input.reason?.trim() || null,
    delete_mode: input.deleteMode,
    payload_json: input.payload ?? null,
  });
  return { error: error?.message ?? null };
}

export async function listDeletionAuditEvents(
  supabase: SupabaseClient,
  companyId: string,
  options?: { limit?: number; entityType?: string | null; fromDate?: string | null; toDate?: string | null }
): Promise<{ rows: DeletionAuditEvent[]; error: string | null }> {
  let query = supabase
    .from("deletion_audit_events")
    .select(
      "id, company_id, occurred_at, actor_user_id, actor_name, actor_email, screen_key, entity_type, entity_id, entity_code, summary, reason, delete_mode, payload_json"
    )
    .eq("company_id", companyId)
    .order("occurred_at", { ascending: false })
    .limit(options?.limit ?? 200);

  if (options?.entityType) query = query.eq("entity_type", options.entityType);
  if (options?.fromDate) query = query.gte("occurred_at", `${options.fromDate}T00:00:00`);
  if (options?.toDate) query = query.lte("occurred_at", `${options.toDate}T23:59:59.999`);

  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as DeletionAuditEvent[], error: null };
}

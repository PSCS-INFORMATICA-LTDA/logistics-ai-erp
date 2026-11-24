import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY_LEDGER_ENTRY_SOURCE } from "@/lib/company-ledger";
import { VEHICLE_EXPENSE_ENTRY_SOURCE } from "@/lib/vehicle-expense-categories";
import { isMasterSessionUnlocked, verifyMasterPassword } from "@/lib/master-password";
import { validateDeletionReason } from "@/lib/deletion-audit";

export type ApprovalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type ApproverMode = "admin" | "admin_or_master" | "master_only";

export type FinancialApprovalSettings = {
  company_id: string;
  approver_mode: ApproverMode;
  auto_approve_below_amount: number | null;
};

export const MANUAL_ENTRY_SOURCES = new Set([
  COMPANY_LEDGER_ENTRY_SOURCE,
  VEHICLE_EXPENSE_ENTRY_SOURCE,
]);

export const DEFAULT_APPROVAL_SETTINGS: Omit<FinancialApprovalSettings, "company_id"> = {
  approver_mode: "admin_or_master",
  auto_approve_below_amount: null,
};

export type PendingApprovalRow = {
  id: string;
  company_id: string;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  classification: string;
  description: string | null;
  entry_source: string | null;
  approval_status: ApprovalStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  /** Nome (ou e-mail) de quem criou/enviou o lançamento. */
  submitted_by_name: string | null;
  dre_account_name: string | null;
  plate: string | null;
};

export function isManualEntrySource(entrySource: string | null | undefined): boolean {
  return Boolean(entrySource && MANUAL_ENTRY_SOURCES.has(entrySource));
}

/** Status inicial ao criar lançamento. */
export function resolveInitialApprovalStatus(
  settings: FinancialApprovalSettings | null,
  amount: number,
  entrySource: string | null
): ApprovalStatus {
  if (!isManualEntrySource(entrySource)) return "approved";

  const autoBelow = settings?.auto_approve_below_amount;
  if (autoBelow != null && Number.isFinite(autoBelow) && amount <= Number(autoBelow)) {
    return "approved";
  }
  return "submitted";
}

export async function loadFinancialApprovalSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<FinancialApprovalSettings> {
  const { data, error } = await supabase
    .from("company_financial_approval_settings")
    .select("company_id, approver_mode, auto_approve_below_amount")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) {
    return { company_id: companyId, ...DEFAULT_APPROVAL_SETTINGS };
  }

  return {
    company_id: companyId,
    approver_mode: (data.approver_mode as ApproverMode) || "admin_or_master",
    auto_approve_below_amount:
      data.auto_approve_below_amount == null ? null : Number(data.auto_approve_below_amount),
  };
}

export async function saveFinancialApprovalSettings(
  supabase: SupabaseClient,
  companyId: string,
  input: { approverMode: ApproverMode; autoApproveBelowAmount: number | null }
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("company_financial_approval_settings").upsert(
    {
      company_id: companyId,
      approver_mode: input.approverMode,
      auto_approve_below_amount: input.autoApproveBelowAmount,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  return { error: error?.message ?? null };
}

export async function buildApprovalInsertFields(
  supabase: SupabaseClient,
  companyId: string,
  amount: number,
  entrySource: string | null
): Promise<Record<string, unknown>> {
  const settings = await loadFinancialApprovalSettings(supabase, companyId);
  const status = resolveInitialApprovalStatus(settings, amount, entrySource);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    approval_status: status,
    submitted_by: user?.id ?? null,
    submitted_at: new Date().toISOString(),
  };
}

export async function canUserApproveFinancial(
  supabase: SupabaseClient,
  companyId: string,
  isAdmin: boolean,
  masterPassword?: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await loadFinancialApprovalSettings(supabase, companyId);
  const mode = settings.approver_mode;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const masterUnlocked = Boolean(
    user?.id && isMasterSessionUnlocked(companyId, user.id)
  );

  if (mode === "admin" || mode === "admin_or_master") {
    if (isAdmin) return { ok: true };
  }

  if (mode === "master_only" || mode === "admin_or_master") {
    if (masterUnlocked) return { ok: true };
    if (!masterPassword) {
      if (mode === "master_only") {
        return { ok: false, error: "Informe a Senha Máster para aprovar." };
      }
      if (!isAdmin) {
        return { ok: false, error: "Somente administrador ou Senha Máster podem aprovar." };
      }
      return { ok: false, error: "Somente administrador pode aprovar lançamentos." };
    }
    const { data: security } = await supabase
      .from("company_security_settings")
      .select("master_password_salt, master_password_hash")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!security?.master_password_salt || !security?.master_password_hash) {
      return {
        ok: false,
        error: "Cadastre a Senha Máster em Parâmetros para aprovar neste modo.",
      };
    }
    const valid = await verifyMasterPassword(
      masterPassword,
      security.master_password_salt as string,
      security.master_password_hash as string
    );
    if (!valid) return { ok: false, error: "Senha Máster incorreta." };
    return { ok: true };
  }

  return { ok: false, error: "Somente administrador pode aprovar lançamentos." };
}

export async function listPendingFinancialApprovals(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: PendingApprovalRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("financial_transactions")
    .select(
      `
      id,
      company_id,
      transaction_date,
      amount,
      transaction_type,
      classification,
      description,
      entry_source,
      approval_status,
      submitted_at,
      submitted_by,
      chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey ( name ),
      vehicle:vehicles!financial_transactions_allocation_vehicle_id_fkey ( plate )
    `
    )
    .eq("company_id", companyId)
    .eq("approval_status", "submitted")
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (error) {
    if (
      error.message.toLowerCase().includes("approval_status") &&
      (error.message.toLowerCase().includes("does not exist") ||
        error.message.toLowerCase().includes("não existe"))
    ) {
      return { rows: [], error: null };
    }
    return { rows: [], error: error.message };
  }

  const submitterIds = Array.from(
    new Set(
      (data ?? [])
        .map((raw) => (raw as { submitted_by?: string | null }).submitted_by)
        .filter((id): id is string => Boolean(id))
    )
  );

  const nameByUserId = new Map<string, string>();
  if (submitterIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", submitterIds);

    for (const p of profiles ?? []) {
      const label =
        (typeof p.full_name === "string" && p.full_name.trim()) ||
        (typeof p.email === "string" && p.email.trim()) ||
        null;
      if (label) nameByUserId.set(p.id, label);
    }
  }

  const rows: PendingApprovalRow[] = (data ?? []).map((raw) => {
    const item = raw as Record<string, unknown>;
    const account = item.chart_of_account as { name?: string } | { name?: string }[] | null;
    const vehicle = item.vehicle as { plate?: string } | { plate?: string }[] | null;
    const accountName = Array.isArray(account) ? account[0]?.name : account?.name;
    const plate = Array.isArray(vehicle) ? vehicle[0]?.plate : vehicle?.plate;
    const submittedBy = (item.submitted_by as string | null) ?? null;
    return {
      id: String(item.id),
      company_id: String(item.company_id),
      transaction_date: String(item.transaction_date),
      amount: Number(item.amount),
      transaction_type: String(item.transaction_type),
      classification: String(item.classification ?? ""),
      description: (item.description as string | null) ?? null,
      entry_source: (item.entry_source as string | null) ?? null,
      approval_status: (item.approval_status as ApprovalStatus) ?? "submitted",
      submitted_at: (item.submitted_at as string | null) ?? null,
      submitted_by: submittedBy,
      submitted_by_name: submittedBy ? nameByUserId.get(submittedBy) ?? null : null,
      dre_account_name: accountName ?? null,
      plate: plate ?? null,
    };
  });

  return { rows, error: null };
}

async function resolveReviewerName(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ userId: string | null; name: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, name: null };
  let name =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email?.split("@")[0] ||
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

  return { userId: user.id, name };
}

export async function approveFinancialTransaction(input: {
  supabase: SupabaseClient;
  companyId: string;
  transactionId: string;
  isAdmin: boolean;
  masterPassword?: string;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const gate = await canUserApproveFinancial(
    input.supabase,
    input.companyId,
    input.isAdmin,
    input.masterPassword
  );
  if (!gate.ok) return { error: gate.error ?? "Sem permissão." };

  const reviewer = await resolveReviewerName(input.supabase, input.companyId);
  const { error } = await input.supabase
    .from("financial_transactions")
    .update({
      approval_status: "approved",
      reviewed_by: reviewer.userId,
      reviewed_by_name: reviewer.name,
      reviewed_at: new Date().toISOString(),
      review_note: input.note?.trim() || "Aprovado.",
    })
    .eq("id", input.transactionId)
    .eq("company_id", input.companyId)
    .eq("approval_status", "submitted");

  return { error: error?.message ?? null };
}

export async function rejectFinancialTransaction(input: {
  supabase: SupabaseClient;
  companyId: string;
  transactionId: string;
  isAdmin: boolean;
  masterPassword?: string;
  note: string;
}): Promise<{ error: string | null }> {
  const reasonError = validateDeletionReason(input.note);
  if (reasonError) {
    return { error: reasonError.replace("motivo", "motivo da rejeição") };
  }

  const gate = await canUserApproveFinancial(
    input.supabase,
    input.companyId,
    input.isAdmin,
    input.masterPassword
  );
  if (!gate.ok) return { error: gate.error ?? "Sem permissão." };

  const reviewer = await resolveReviewerName(input.supabase, input.companyId);
  const { error } = await input.supabase
    .from("financial_transactions")
    .update({
      approval_status: "rejected",
      reviewed_by: reviewer.userId,
      reviewed_by_name: reviewer.name,
      reviewed_at: new Date().toISOString(),
      review_note: input.note.trim().replace(/\s+/g, " "),
    })
    .eq("id", input.transactionId)
    .eq("company_id", input.companyId)
    .eq("approval_status", "submitted");

  return { error: error?.message ?? null };
}

export function entrySourceLabel(source: string | null): string {
  if (source === COMPANY_LEDGER_ENTRY_SOURCE) return "Empresa";
  if (source === "import_historico_teste") return "Importação teste";
  if (source === "import_historico_teste_parceiros") return "Importação teste (parceiros)";

  if (source === VEHICLE_EXPENSE_ENTRY_SOURCE) return "Veículo";
  if (!source) return "Sistema";
  return source;
}

/**
 * Exclui lançamento pendente (errado / por engano) com registro no histórico de exclusões.
 * Diferente de rejeitar: remove o registro e permite restauração hard pelo histórico.
 */
export async function deleteSubmittedFinancialTransaction(input: {
  supabase: SupabaseClient;
  companyId: string;
  transactionId: string;
  reason: string;
  reasonCode?: string | null;
}): Promise<{ error: string | null }> {
  const { data: existing, error: fetchErr } = await input.supabase
    .from("financial_transactions")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.transactionId)
    .eq("approval_status", "submitted")
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) {
    return { error: "Lançamento pendente não encontrado (já aprovado, rejeitado ou excluído)." };
  }

  const { error } = await input.supabase.rpc("delete_financial_transaction_audited", {
    p_id: input.transactionId,
    p_reason: input.reason,
    p_reason_code: input.reasonCode ?? null,
    p_screen_key: "dre.aprovacoes",
  });

  return { error: error?.message ?? null };
}

export const AUDITED_CORRECTION_FIELDS = [
  "amount",
  "description",
  "transaction_date",
] as const;

export type AuditedCorrectionPatch = {
  amount?: number;
  description?: string | null;
  transaction_date?: string;
};

export async function correctApprovedLedgerEntry(input: {
  supabase: SupabaseClient;
  transactionId: string;
  patch: AuditedCorrectionPatch;
  reason: string;
  reasonCode: string;
}): Promise<{ error: string | null }> {
  const reasonError = validateDeletionReason(input.reason);
  if (reasonError) return { error: reasonError };
  const patch: Record<string, string | number | null> = {};
  if (input.patch.amount !== undefined) patch.amount = input.patch.amount;
  if (input.patch.description !== undefined) patch.description = input.patch.description;
  if (input.patch.transaction_date !== undefined) patch.transaction_date = input.patch.transaction_date;
  if (Object.keys(patch).length === 0) {
    return { error: "Informe ao menos um campo autorizado para corrigir." };
  }
  const { error } = await input.supabase.rpc("correct_financial_transaction_audited", {
    p_id: input.transactionId,
    p_reason: input.reason.trim().replace(/\s+/g, " "),
    p_patch: patch,
    p_reason_code: input.reasonCode,
    p_screen_key: "dre.lancamentos",
  });
  return { error: error?.message ?? null };
}

export type FinancialCorrectionEvent = {
  id: string;
  occurred_at: string;
  reason: string;
  reason_code: string | null;
  transaction_id: string;
  old_amount: number | null;
  new_amount: number | null;
  old_description: string | null;
  new_description: string | null;
};

export async function listFinancialCorrectionEvents(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: FinancialCorrectionEvent[]; error: string | null }> {
  const { data, error } = await supabase
    .from("financial_correction_events")
    .select("id, occurred_at, reason, reason_code, transaction_id, old_values, new_values")
    .eq("company_id", companyId)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []).map((row) => {
    const oldValues = (row.old_values ?? {}) as Record<string, unknown>;
    const newValues = (row.new_values ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      occurred_at: String(row.occurred_at),
      reason: String(row.reason ?? ""),
      reason_code: (row.reason_code as string | null) ?? null,
      transaction_id: String(row.transaction_id),
      old_amount: oldValues.amount == null ? null : Number(oldValues.amount),
      new_amount: newValues.amount == null ? null : Number(newValues.amount),
      old_description: (oldValues.description as string | null) ?? null,
      new_description: (newValues.description as string | null) ?? null,
    };
  });
  return { rows, error: null };
}

/** Filtro PostgREST: só aprovados (totais DRE/dashboard). */
export function approvedOnlyFilter<T extends { eq: (c: string, v: string) => T }>(query: T): T {
  return query.eq("approval_status", "approved");
}

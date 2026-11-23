/**
 * Regra da trigger guard_financial_transaction_approval_status.
 * O papel é o vínculo real em company_members da empresa da linha.
 * isAdmin vindo da tela e a sessão da Senha Máster não entram nesta decisão.
 */
export type ApprovalActorRole = "admin" | "financeiro" | "operacional" | "socio" | null;

export type ApprovalStatusUpdateInput = {
  actorRoleInOldCompany: ApprovalActorRole;
  actorRoleInNewCompany: ApprovalActorRole;
  oldStatus: string | null;
  newStatus: string | null;
  oldCompanyId: string;
  newCompanyId: string;
};

export type ApprovalStatusUpdateDecision =
  | { ok: true }
  | { ok: false; reason: string };

export const APPROVAL_STATUS_ADMIN_ERROR =
  "Somente administrador da empresa pode alterar o status de aprovação.";

export const APPROVAL_COMPANY_MOVE_ERROR =
  "A empresa do lançamento só pode ser alterada por administrador das duas empresas.";

export const APPROVAL_INSERT_ADMIN_ERROR =
  "Somente administrador da empresa pode criar lançamento já aprovado.";

export const APPROVAL_DELETE_DIRECT_ERROR =
  "Exclusão direta de lançamento financeiro não é permitida. A exclusão precisa de administrador e de auditoria.";

export const MANUAL_APPROVAL_ENTRY_SOURCES = ["company_ledger", "vehicle_expense"] as const;

export type ApprovalInsertInput = {
  actorRole: ApprovalActorRole;
  /** true só dentro de função SECURITY DEFINER de posse do postgres. O cliente não liga isso. */
  internalWriter: boolean;
  /** null reproduz a coluna omitida. O padrão novo é submitted. */
  requestedStatus: string | null;
  entrySource: string | null;
  amount: number;
  autoApproveBelowAmount: number | null;
};

export type ApprovalInsertDecision =
  | { ok: true; status: "draft" | "submitted" | "approved" | "rejected" | "cancelled" | string }
  | { ok: false; reason: string };

/**
 * Espelho da trigger guard_financial_transaction_approval_insert.
 * A autoridade é o banco. Esta função serve à tela e aos testes.
 */
export function evaluateApprovalInsert(input: ApprovalInsertInput): ApprovalInsertDecision {
  const status = input.requestedStatus ?? "submitted";
  if (status !== "approved") return { ok: true, status };

  if (input.actorRole === "admin" || input.internalWriter) {
    return { ok: true, status: "approved" };
  }

  const manual = MANUAL_APPROVAL_ENTRY_SOURCES.includes(
    input.entrySource as (typeof MANUAL_APPROVAL_ENTRY_SOURCES)[number],
  );
  const limit = input.autoApproveBelowAmount;
  if (manual && limit != null && Number.isFinite(limit) && input.amount <= limit) {
    return { ok: true, status: "approved" };
  }

  return { ok: false, reason: APPROVAL_INSERT_ADMIN_ERROR };
}

/** Espelho da trigger de DELETE. Sem a função auditada, a exclusão direta falha. */
export function evaluateFinancialDelete(input: {
  viaAuditedFunction: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.viaAuditedFunction) return { ok: true };
  return { ok: false, reason: APPROVAL_DELETE_DIRECT_ERROR };
}

export function evaluateApprovalStatusUpdate(
  input: ApprovalStatusUpdateInput,
): ApprovalStatusUpdateDecision {
  const statusChanged = input.oldStatus !== input.newStatus;
  const companyChanged = input.oldCompanyId !== input.newCompanyId;

  if (!statusChanged && !companyChanged) return { ok: true };

  const adminOfOld = input.actorRoleInOldCompany === "admin";
  const adminOfNew = input.actorRoleInNewCompany === "admin";

  if (companyChanged && (!adminOfOld || !adminOfNew)) {
    return { ok: false, reason: APPROVAL_COMPANY_MOVE_ERROR };
  }

  if (statusChanged && !adminOfOld) {
    return { ok: false, reason: APPROVAL_STATUS_ADMIN_ERROR };
  }

  return { ok: true };
}

export function evaluateApprovalStatusBatch(
  rows: readonly ApprovalStatusUpdateInput[],
): { ok: true } | { ok: false; index: number; reason: string } {
  for (let index = 0; index < rows.length; index += 1) {
    const decision = evaluateApprovalStatusUpdate(rows[index]);
    if (!decision.ok) return { ok: false, index, reason: decision.reason };
  }
  return { ok: true };
}

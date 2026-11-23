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

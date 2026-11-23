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

export const APPROVED_FIELD_CORRECTION_ERROR =
  "Lançamento aprovado não aceita alteração direta de valor, origem ou vínculo. A correção precisa de administrador e de auditoria.";

/** Campos que a 090 congela quando o lançamento está ou fica approved. */
export const SENSITIVE_APPROVED_FIELDS = [
  "amount",
  "entry_source",
  "description",
  "transaction_type",
  "transaction_date",
  "service_date",
  "chart_of_account_id",
  "classification",
  "company_id",
  "branch_id",
  "client_id",
  "supplier_id",
  "driver_id",
  "service_order_id",
  "allocation_vehicle_id",
  "operational_vehicle_id",
  "legacy_number",
  "submitted_by",
  "submitted_at",
  "id",
  "created_at",
  "created_by",
] as const;

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

/**
 * Espelho da trigger guard_financial_transaction_approved_fields.
 * viaAuditedCorrection só é true dentro de correct_financial_transaction_audited:
 * current_user postgres, session_user da conexão e flag igual ao id da linha.
 * Ligar a flag por set_config não basta.
 */
export function evaluateApprovedSensitiveUpdate(input: {
  oldStatus: string | null;
  newStatus: string | null;
  changedFields: readonly string[];
  viaAuditedCorrection: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const sensitive = input.changedFields.some((field) =>
    (SENSITIVE_APPROVED_FIELDS as readonly string[]).includes(field),
  );
  if (!sensitive) return { ok: true };
  const touchesApproved = input.oldStatus === "approved" || input.newStatus === "approved";
  if (!touchesApproved) return { ok: true };
  if (input.viaAuditedCorrection) return { ok: true };
  return { ok: false, reason: APPROVED_FIELD_CORRECTION_ERROR };
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

export const CORRECTION_LINK_FIELDS = [
  "branch_id",
  "client_id",
  "supplier_id",
  "driver_id",
  "service_order_id",
  "allocation_vehicle_id",
  "operational_vehicle_id",
] as const;

/** Vínculo nulo é válido. Id de outra empresa, ou id inexistente, não entra. */
export function evaluateCorrectionLinks(input: {
  companyId: string;
  links: Partial<Record<(typeof CORRECTION_LINK_FIELDS)[number], string | null>>;
  companyByEntityId: Readonly<Record<string, string>>;
}): { ok: true } | { ok: false; field: string } {
  for (const field of CORRECTION_LINK_FIELDS) {
    const entityId = input.links[field];
    if (!entityId) continue;
    if (input.companyByEntityId[entityId] !== input.companyId) {
      return { ok: false, field };
    }
  }
  return { ok: true };
}

export type PersistedCorrectionRow = {
  amount: number;
  entrySource: string | null;
  description: string | null;
  transactionType: string;
  classification: string;
  chartOfAccountId: string;
  companyId: string;
};

/**
 * Espelho do UPDATE da 090 e da trigger sync_transaction_classification.
 * A conta só entra no SET quando o patch a traz. Nesse caso a trigger
 * reescreve classification e transaction_type, e o evento usa esse resultado.
 */
export function persistAuditedCorrection(input: {
  oldRow: PersistedCorrectionRow;
  patch: Partial<PersistedCorrectionRow>;
  chart: { classification: string; transactionType: string } | null;
}): {
  persisted: PersistedCorrectionRow;
  oldValues: Partial<PersistedCorrectionRow>;
  newValues: Partial<PersistedCorrectionRow>;
} {
  const chartInSet = Object.prototype.hasOwnProperty.call(input.patch, "chartOfAccountId");
  const persisted: PersistedCorrectionRow = { ...input.oldRow };
  if (Object.prototype.hasOwnProperty.call(input.patch, "amount") && input.patch.amount !== undefined) {
    persisted.amount = input.patch.amount;
  }
  if (Object.prototype.hasOwnProperty.call(input.patch, "entrySource")) {
    persisted.entrySource = input.patch.entrySource ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input.patch, "description")) {
    persisted.description = input.patch.description ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input.patch, "companyId") && input.patch.companyId) {
    persisted.companyId = input.patch.companyId;
  }
  if (chartInSet && input.patch.chartOfAccountId) {
    persisted.chartOfAccountId = input.patch.chartOfAccountId;
    if (input.chart) {
      persisted.classification = input.chart.classification;
      persisted.transactionType = input.chart.transactionType;
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(input.patch, "classification") && input.patch.classification) {
      persisted.classification = input.patch.classification;
    }
    if (Object.prototype.hasOwnProperty.call(input.patch, "transactionType") && input.patch.transactionType) {
      persisted.transactionType = input.patch.transactionType;
    }
  }

  const oldValues: Partial<PersistedCorrectionRow> = {};
  const newValues: Partial<PersistedCorrectionRow> = {};
  for (const key of Object.keys(persisted) as (keyof PersistedCorrectionRow)[]) {
    if (persisted[key] !== input.oldRow[key]) {
      oldValues[key] = input.oldRow[key] as never;
      newValues[key] = persisted[key] as never;
    }
  }
  return { persisted, oldValues, newValues };
}

/** A trilha aceita inclusão só no caminho auditado. Update, delete e truncate nunca. */
export function evaluateCorrectionEventWrite(input: {
  op: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
  viaAuditedCorrection: boolean;
}): { ok: true } | { ok: false } {
  if (input.op === "INSERT" && input.viaAuditedCorrection) return { ok: true };
  return { ok: false };
}

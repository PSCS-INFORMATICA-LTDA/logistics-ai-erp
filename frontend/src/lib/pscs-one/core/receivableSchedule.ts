/**
 * Datas do recebível.
 * issued_at = data do documento da OS (service_date), meia-noite UTC.
 * due_at: Core exige o campo no JSON (YYYY-MM-DD ou null). Logistics ainda não
 * tem vencimento/payment terms canônico na OS — nesta wave enviamos null.
 */

export const AR_DUE_DATE_GAP =
  "Vencimento explícito inválido. Use YYYY-MM-DD ou null quando não houver data canônica.";

export type IssuedAtResult =
  | { ok: true; issuedAt: string }
  | { ok: false; code: "ISSUED_AT_REQUIRED" };

export type DueAtResult =
  | { ok: true; dueAt: string | null }
  | { ok: false; code: "AR_DUE_DATE_RULE_REQUIRED"; gap: string };

export function resolveServiceOrderReceivableIssuedAt(order: {
  service_date?: string | null;
}): IssuedAtResult {
  const date = order.service_date?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, code: "ISSUED_AT_REQUIRED" };
  }
  return { ok: true, issuedAt: `${date}T00:00:00.000Z` };
}

export function resolveServiceOrderReceivableDueAt(
  _order: { service_date?: string | null },
): DueAtResult {
  return { ok: true, dueAt: null };
}

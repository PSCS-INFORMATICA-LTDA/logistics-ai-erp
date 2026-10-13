/**
 * Datas do recebível.
 * issued_at = data do documento da OS (service_date), meia-noite UTC.
 * due_at não existe em service_orders, clients nem em prazo/payment terms.
 * O POST do Core exige due_at string. Inventar 30 dias quebraria a fixture
 * oficial, cujo due_on está nulo e divergiria no contrato de idempotência.
 */

export const AR_DUE_DATE_GAP =
  "service_orders não possui vencimento, payment terms ou due date. Core POST /api/receivables exige due_at. Fixture oficial due_on=null.";

export type IssuedAtResult =
  | { ok: true; issuedAt: string }
  | { ok: false; code: "ISSUED_AT_REQUIRED" };

export type DueAtResult = { ok: false; code: "AR_DUE_DATE_RULE_REQUIRED"; gap: string };

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
  _order: unknown,
): DueAtResult {
  return { ok: false, code: "AR_DUE_DATE_RULE_REQUIRED", gap: AR_DUE_DATE_GAP };
}

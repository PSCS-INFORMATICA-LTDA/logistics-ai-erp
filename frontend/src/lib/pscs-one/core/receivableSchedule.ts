/**
 * Datas do recebível.
 * issued_at = data do documento da OS (service_date), meia-noite UTC.
 * due_at não existe em service_orders, clients nem payment terms no Logistics.
 * O POST do Core exige due_at. Não inventamos prazo fixo no código: use
 * PSCS_ONE_LOGISTICS_RECEIVABLE_DUE_DAYS (dias corridos após service_date).
 */

export const AR_DUE_DATE_GAP =
  "service_orders não possui vencimento. Defina PSCS_ONE_LOGISTICS_RECEIVABLE_DUE_DAYS (dias após a data da OS) ou injete resolveDueAt nos testes.";

export type IssuedAtResult =
  | { ok: true; issuedAt: string }
  | { ok: false; code: "ISSUED_AT_REQUIRED" };

export type DueAtResult =
  | { ok: true; dueAt: string }
  | { ok: false; code: "AR_DUE_DATE_RULE_REQUIRED"; gap: string };

export function readLogisticsReceivableDueDaysFromEnv(
  source: Record<string, string | undefined> = process.env,
): number | null {
  const raw = source.PSCS_ONE_LOGISTICS_RECEIVABLE_DUE_DAYS?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days > 3660) return null;
  return days;
}

/** Soma dias corridos em UTC sobre YYYY-MM-DD (sem drift de fuso). */
export function addCalendarDaysUtc(isoDate: string, days: number): string {
  const parts = isoDate.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) {
    throw new Error("invalid iso date");
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

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
  order: { service_date?: string | null },
  env: Record<string, string | undefined> = process.env,
): DueAtResult {
  const date = order.service_date?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, code: "AR_DUE_DATE_RULE_REQUIRED", gap: AR_DUE_DATE_GAP };
  }
  const days = readLogisticsReceivableDueDaysFromEnv(env);
  if (days === null) {
    return { ok: false, code: "AR_DUE_DATE_RULE_REQUIRED", gap: AR_DUE_DATE_GAP };
  }
  return { ok: true, dueAt: addCalendarDaysUtc(date, days) };
}

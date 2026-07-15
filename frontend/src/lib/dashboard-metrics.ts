/** Agregações do Dashboard executivo (Fase 3). */

export const DASHBOARD_DEMO_PREFIX = "[DEMO-DASH]";
export const DASHBOARD_DEMO_ENTRY_SOURCE = "dashboard_demo";

export type DashboardBucket = "frete" | "estacionamento" | "lava" | "outros";

export type DashboardPeriodKey = "current_month" | "previous_month" | "last_3_months";

export type BucketTotals = {
  revenue: number;
  expense: number;
  result: number;
};

export type MonthlyPoint = {
  key: string; // YYYY-MM
  label: string;
  revenue: number;
  expense: number;
  result: number;
};

export type PartnerShareRow = {
  partnerId: string;
  partnerName: string;
  plate: string;
  ownershipPct: number;
  revenue: number;
  expense: number;
  result: number;
  isFullOwner: boolean;
};

export type PartnerConsolidated = {
  partnerId: string;
  partnerName: string;
  revenue: number;
  expense: number;
  result: number;
  resultSharePct: number;
};

export type DashboardSnapshot = {
  periodKey: DashboardPeriodKey;
  from: string;
  to: string;
  kpis: BucketTotals & { marginPct: number };
  frete: BucketTotals;
  estacionamento: BucketTotals;
  lava: BucketTotals;
  trend: MonthlyPoint[];
  participationRows: PartnerShareRow[];
  participationByPartner: PartnerConsolidated[];
  demoRows: number;
};

export type FtRow = {
  id: string;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  classification: string | null;
  description: string | null;
  entry_source: string | null;
  allocation_vehicle_id: string | null;
  chart_of_account_id: string;
  account_name?: string | null;
};

const FRETE_REVENUE = new Set(["Receita Caminhão", "Receita Van"]);
const ESTAC_REVENUE = new Set(["Receita Estacionamento"]);
const LAVA_REVENUE = new Set(["Receita Lava Rápido"]);

const FRETE_EXPENSE_HINTS = [
  "combustível",
  "combustivel",
  "pedágio",
  "pedagio",
  "motorista",
  "ajudante",
  "caminhão",
  "caminhao",
  "frete",
  "pneu",
  "oficina",
  "manutenção",
  "manutencao",
];
const ESTAC_EXPENSE_HINTS = ["estacionamento"];
const LAVA_EXPENSE_HINTS = ["lava", "lavagem", "higien"];

function normalize(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function classifyBucket(row: FtRow): DashboardBucket {
  const name = row.account_name ?? "";
  const source = row.entry_source ?? "";
  const desc = normalize(row.description);
  const account = normalize(name);
  const classification = normalize(row.classification);

  if (source === "parking" || ESTAC_REVENUE.has(name)) return "estacionamento";
  if (source === "car_wash" || LAVA_REVENUE.has(name)) return "lava";
  if (FRETE_REVENUE.has(name)) return "frete";

  if (source === "vehicle_expense" || source === "driver_payment") return "frete";

  if (row.transaction_type === "Despesa") {
    if (ESTAC_EXPENSE_HINTS.some((h) => account.includes(h) || classification.includes(h) || desc.includes(h))) {
      return "estacionamento";
    }
    if (LAVA_EXPENSE_HINTS.some((h) => account.includes(h) || classification.includes(h) || desc.includes(h))) {
      return "lava";
    }
    if (FRETE_EXPENSE_HINTS.some((h) => account.includes(h) || classification.includes(h) || desc.includes(h))) {
      return "frete";
    }
    if (row.allocation_vehicle_id) return "frete";
  }

  if (row.transaction_type === "Receita" && row.allocation_vehicle_id) return "frete";

  return "outros";
}

export function emptyTotals(): BucketTotals {
  return { revenue: 0, expense: 0, result: 0 };
}

export function addToTotals(t: BucketTotals, row: FtRow): void {
  const amount = Number(row.amount) || 0;
  if (row.transaction_type === "Receita") t.revenue += amount;
  else if (row.transaction_type === "Despesa") t.expense += amount;
  t.result = t.revenue - t.expense;
}

export function periodRange(
  key: DashboardPeriodKey,
  now = new Date()
): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  const iso = (d: Date) => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };

  if (key === "previous_month") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { from: iso(start), to: iso(end) };
  }

  if (key === "last_3_months") {
    const start = new Date(y, m - 2, 1);
    const end = new Date(y, m + 1, 0);
    return { from: iso(start), to: iso(end) };
  }

  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return { from: iso(start), to: iso(end) };
}

export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [yy, mm] = key.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const idx = Number(mm) - 1;
  return `${names[idx] ?? mm}/${yy?.slice(2) ?? ""}`;
}

export function buildTrend(rows: FtRow[], from: string, to: string): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, {
      key,
      label: monthLabel(key),
      revenue: 0,
      expense: 0,
      result: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const row of rows) {
    const key = monthKey(row.transaction_date);
    const point = map.get(key);
    if (!point) continue;
    const amount = Number(row.amount) || 0;
    if (row.transaction_type === "Receita") point.revenue += amount;
    else if (row.transaction_type === "Despesa") point.expense += amount;
    point.result = point.revenue - point.expense;
  }

  return [...map.values()];
}

export function buildSnapshot(params: {
  periodKey: DashboardPeriodKey;
  from: string;
  to: string;
  rows: FtRow[];
  ownership: Array<{
    vehicle_id: string;
    partner_id: string;
    partner_name: string;
    plate: string;
    ownership_percentage: number;
  }>;
}): DashboardSnapshot {
  const frete = emptyTotals();
  const estacionamento = emptyTotals();
  const lava = emptyTotals();
  const kpis = emptyTotals();

  for (const row of params.rows) {
    addToTotals(kpis, row);
    const bucket = classifyBucket(row);
    if (bucket === "frete") addToTotals(frete, row);
    else if (bucket === "estacionamento") addToTotals(estacionamento, row);
    else if (bucket === "lava") addToTotals(lava, row);
  }

  const byVehicle = new Map<string, BucketTotals>();
  for (const row of params.rows) {
    if (!row.allocation_vehicle_id) continue;
    const t = byVehicle.get(row.allocation_vehicle_id) ?? emptyTotals();
    addToTotals(t, row);
    byVehicle.set(row.allocation_vehicle_id, t);
  }

  const participationRows: PartnerShareRow[] = [];
  const partnerMap = new Map<string, PartnerConsolidated>();

  for (const own of params.ownership) {
    const vehicleTotals = byVehicle.get(own.vehicle_id) ?? emptyTotals();
    const pct = Number(own.ownership_percentage) / 100;
    const revenue = vehicleTotals.revenue * pct;
    const expense = vehicleTotals.expense * pct;
    const result = revenue - expense;
    participationRows.push({
      partnerId: own.partner_id,
      partnerName: own.partner_name,
      plate: own.plate,
      ownershipPct: Number(own.ownership_percentage),
      revenue,
      expense,
      result,
      isFullOwner: Number(own.ownership_percentage) >= 99.99,
    });

    const cons = partnerMap.get(own.partner_id) ?? {
      partnerId: own.partner_id,
      partnerName: own.partner_name,
      revenue: 0,
      expense: 0,
      result: 0,
      resultSharePct: 0,
    };
    cons.revenue += revenue;
    cons.expense += expense;
    cons.result += result;
    partnerMap.set(own.partner_id, cons);
  }

  const participationByPartner = [...partnerMap.values()].sort((a, b) => b.result - a.result);
  const resultAbsSum = participationByPartner.reduce((s, p) => s + Math.abs(p.result), 0);
  for (const p of participationByPartner) {
    p.resultSharePct = resultAbsSum > 0 ? (Math.abs(p.result) / resultAbsSum) * 100 : 0;
  }

  const marginPct = kpis.revenue > 0 ? (kpis.result / kpis.revenue) * 100 : 0;
  const demoRows = params.rows.filter(
    (r) =>
      r.entry_source === DASHBOARD_DEMO_ENTRY_SOURCE ||
      String(r.description ?? "").startsWith(DASHBOARD_DEMO_PREFIX)
  ).length;

  return {
    periodKey: params.periodKey,
    from: params.from,
    to: params.to,
    kpis: { ...kpis, marginPct },
    frete,
    estacionamento,
    lava,
    trend: buildTrend(params.rows, params.from, params.to),
    participationRows: participationRows.sort((a, b) => b.result - a.result),
    participationByPartner,
    demoRows,
  };
}

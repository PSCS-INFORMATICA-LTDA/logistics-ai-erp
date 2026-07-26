/** Constantes e helpers do módulo Estacionamento / Lava-rápido. */

export const PATIO_MODALITIES = ["Estacionamento", "Lava Rápido"] as const;
export type PatioModality = (typeof PATIO_MODALITIES)[number];

export const PATIO_BILLING_UNITS = ["Diária", "Mensal", "Serviço", "Hora"] as const;
export type PatioBillingUnit = (typeof PATIO_BILLING_UNITS)[number];

export const PARKING_BILLING_MODES = ["Diária", "Mensal", "Rotativo"] as const;
export type ParkingBillingMode = (typeof PARKING_BILLING_MODES)[number];

export const PARKING_STATUSES = ["Aberto", "Finalizado", "Cancelado"] as const;
export const CAR_WASH_STATUSES = ["Aberto", "Concluido", "Cancelado"] as const;

export const CAR_WASH_SERVICE_NAMES = [
  "Lavagem Simples",
  "Lavagem Completa",
  "Lavagem Técnica",
  "Higienização Interna",
  "Polimento",
] as const;

export const PARKING_SERVICE_NAMES = {
  diaria: "Diária Estacionamento",
  mensal: "Mensalidade Estacionamento",
  rotativoFirst: "Rotativo 1ª Hora",
  rotativoExtra: "Rotativo Hora Adicional",
} as const;

export const PATIO_PAYMENT_METHODS = ["Pix", "Dinheiro", "Cartão", "Faturado", "Outros"] as const;

export const PATIO_ENTRY_SOURCE_PARKING = "parking";
export const PATIO_ENTRY_SOURCE_WASH = "car_wash";

export type PatioVehicleType = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  usage_category: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
};

export type PatioPriceRow = {
  id: string;
  company_id: string;
  code: string;
  modality: PatioModality | string;
  vehicle_type_id: string;
  service_name: string;
  price: number;
  billing_unit: PatioBillingUnit | string;
  valid_from: string;
  valid_until: string | null;
  status: string;
  notes: string | null;
  vehicle_type_name?: string;
};

export type ParkingEntryRow = {
  id: string;
  company_id: string;
  code: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string | null;
  vehicle_type_id: string | null;
  client_name: string | null;
  phone: string | null;
  entry_date: string;
  entry_time: string | null;
  exit_date: string | null;
  exit_time: string | null;
  /** Fim da vigência mensal (inclusivo). */
  period_end_date: string | null;
  /** Aniversário / início do próximo período mensal. */
  next_charge_date: string | null;
  daily_count: number | null;
  daily_rate: number | null;
  total_amount: number | null;
  billing_mode: ParkingBillingMode | string | null;
  status: string;
  notes: string | null;
  financial_transaction_id: string | null;
};

export type CarWashServiceRow = {
  id: string;
  company_id: string;
  code: string;
  service_date: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string | null;
  vehicle_type_id: string | null;
  client_name: string | null;
  phone: string | null;
  service_name: string;
  service_amount: number | null;
  status: string;
  entry_date: string | null;
  entry_time: string | null;
  exit_date: string | null;
  exit_time: string | null;
  attendant: string | null;
  payment_method: string | null;
  notes: string | null;
  financial_transaction_id: string | null;
};

/** RN-082: mínimo 1 diária. */
export function calcParkingDailyCount(entryDate: string, exitDate: string): number {
  const a = new Date(`${entryDate}T00:00:00`);
  const b = new Date(`${exitDate}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 1;
  const days = Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return Math.max(1, days);
}

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Soma 1 mês mantendo o dia (aniversário); ajusta meses curtos (31→28/29). */
export function addOneMonthAnniversary(isoDate: string): string {
  const start = parseISODateLocal(isoDate);
  const day = start.getDate();
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return toISODateLocal(next);
}

export function addDaysISO(isoDate: string, days: number): string {
  const d = parseISODateLocal(isoDate);
  d.setDate(d.getDate() + days);
  return toISODateLocal(d);
}

/**
 * Mensalidade por aniversário:
 * entrada 05/07 → vigência até 04/08 → próxima cobrança 05/08.
 */
export function calcMensalPeriod(entryDate: string): {
  periodEndDate: string;
  nextChargeDate: string;
} {
  const nextChargeDate = addOneMonthAnniversary(entryDate);
  const periodEndDate = addDaysISO(nextChargeDate, -1);
  return { periodEndDate, nextChargeDate };
}

/** Próxima cobrança = dia seguinte ao fim da vigência. */
export function nextChargeFromPeriodEnd(periodEndDate: string): string {
  return addDaysISO(periodEndDate, 1);
}

export function formatParkingDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Mensal vencido para renovação (próxima cobrança já chegou e ainda Aberto). */
export function isMensalDueForRenewal(
  row: Pick<ParkingEntryRow, "billing_mode" | "status" | "next_charge_date">,
  todayISO = toISODateLocal(new Date())
): boolean {
  if (row.billing_mode !== "Mensal" || row.status !== "Aberto" || !row.next_charge_date) {
    return false;
  }
  return row.next_charge_date <= todayISO;
}

function parsePatioDateTime(date: string, time: string | null | undefined): Date {
  const t = (time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "00:00") + ":00";
  return new Date(`${date}T${t}`);
}

/** Rotativo: horas cobradas (ceil), mínimo 1. */
export function calcParkingHourCount(
  entryDate: string,
  entryTime: string | null | undefined,
  exitDate: string,
  exitTime: string | null | undefined
): number {
  const start = parsePatioDateTime(entryDate, entryTime);
  const end = parsePatioDateTime(exitDate, exitTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 1;
  }
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  return Math.max(1, Math.ceil(minutes / 60));
}

/** Total rotativo: 1ª hora + (n − 1) × hora adicional. */
export function calcRotativoTotal(
  hourCount: number,
  firstHourPrice: number,
  additionalHourPrice: number
): number {
  const hours = Math.max(1, hourCount);
  if (hours <= 1) return firstHourPrice;
  return firstHourPrice + (hours - 1) * additionalHourPrice;
}

export function allowsWash(usageCategory: string): boolean {
  return usageCategory === "Estacionamento/Lava Rápido" || usageCategory === "Lava Rápido";
}

export function allowsParking(usageCategory: string): boolean {
  return (
    usageCategory === "Estacionamento/Lava Rápido" || usageCategory === "Estacionamento"
  );
}

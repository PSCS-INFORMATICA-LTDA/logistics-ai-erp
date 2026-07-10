import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadEntityAttachment } from "@/lib/attachments";

export const DRIVER_PAYMENT_PROOF_DESCRIPTION = "Comprovante pagamento motorista";

export type DriverPaymentRow = {
  id: string;
  code: string;
  service_date: string;
  status: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  pix_key: string | null;
  bank_code: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  driver_assignment_pay_amount: number | null;
  driver_assignment_assistant_pay_amount: number | null;
  driver_payment_paid_at: string | null;
  payment_proof_count: number;
};

export type DriverPaymentFilter = "all" | "pending" | "paid";

type DriverBanking = {
  code: string;
  name: string;
  pix_key: string | null;
  bank_code: string | null;
  bank_agency: string | null;
  bank_account: string | null;
};

type RawOrderRow = {
  id: string;
  code: string;
  service_date: string;
  status: string;
  driver_id: string;
  driver_assignment_pay_amount: number | string | null;
  driver_assignment_assistant_pay_amount: number | string | null;
  driver_payment_paid_at: string | null;
  drivers?: DriverBanking & { id?: string } | null;
};

const ORDER_FIELDS =
  "id, code, service_date, status, driver_id, driver_assignment_pay_amount, driver_assignment_assistant_pay_amount, driver_payment_paid_at";

const ORDER_FIELDS_WITH_DRIVER = `
  id, code, service_date, status, driver_id,
  driver_assignment_pay_amount, driver_assignment_assistant_pay_amount, driver_payment_paid_at,
  drivers!service_orders_driver_id_fkey ( code, name, pix_key, bank_code, bank_agency, bank_account )
`;

function parsePayAmount(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchDriversWithBanking(
  supabase: SupabaseClient,
  driverIds: string[]
): Promise<Map<string, DriverBanking>> {
  const byId = new Map<string, DriverBanking>();
  if (!driverIds.length) return byId;

  const full = await supabase
    .from("drivers")
    .select("id, code, name, pix_key, bank_code, bank_agency, bank_account")
    .in("id", driverIds);

  let drivers = full.data;

  if (full.error?.message.includes("pix_key") || full.error?.message.includes("bank_code")) {
    const basic = await supabase.from("drivers").select("id, code, name").in("id", driverIds);
    drivers = (basic.data ?? []).map((d) => ({
      ...d,
      pix_key: null,
      bank_code: null,
      bank_agency: null,
      bank_account: null,
    }));
  } else if (full.error) {
    return byId;
  }

  for (const driver of drivers ?? []) {
    byId.set(driver.id as string, {
      code: (driver.code as string) ?? "—",
      name: (driver.name as string) ?? "—",
      pix_key: (driver.pix_key as string | null) ?? null,
      bank_code: (driver.bank_code as string | null) ?? null,
      bank_agency: (driver.bank_agency as string | null) ?? null,
      bank_account: (driver.bank_account as string | null) ?? null,
    });
  }

  return byId;
}

async function fetchPaymentProofCountsByOrderId(
  supabase: SupabaseClient,
  companyId: string,
  orderIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!orderIds.length) return counts;

  const { data, error } = await supabase
    .from("attachments")
    .select("entity_id")
    .eq("company_id", companyId)
    .eq("entity_type", "service_order")
    .eq("description", DRIVER_PAYMENT_PROOF_DESCRIPTION)
    .in("entity_id", orderIds);

  if (error) return counts;

  for (const item of data ?? []) {
    const orderId = item.entity_id as string;
    counts.set(orderId, (counts.get(orderId) ?? 0) + 1);
  }

  return counts;
}

async function fetchPaymentOrders(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ data: RawOrderRow[] | null; error: string | null; schemaWarning: string | null }> {
  const base = () =>
    supabase
      .from("service_orders")
      .select(ORDER_FIELDS)
      .eq("company_id", companyId)
      .not("driver_id", "is", null)
      .or("driver_assignment_response.eq.accepted,status.eq.Concluido")
      .order("service_date", { ascending: false });

  let withDriver = await supabase
    .from("service_orders")
    .select(ORDER_FIELDS_WITH_DRIVER)
    .eq("company_id", companyId)
    .not("driver_id", "is", null)
    .or("driver_assignment_response.eq.accepted,status.eq.Concluido")
    .order("service_date", { ascending: false });

  if (!withDriver.error && withDriver.data?.length) {
    return {
      data: withDriver.data as unknown as RawOrderRow[],
      error: null,
      schemaWarning: null,
    };
  }

  if (
    withDriver.error &&
    (withDriver.error.message.includes("driver_assignment_pay_amount") ||
      withDriver.error.message.includes("driver_payment_paid_at") ||
      withDriver.error.message.includes("driver_assignment_response"))
  ) {
    return {
      data: null,
      error: null,
      schemaWarning:
        "Colunas de pagamento/designação ainda não existem no Supabase. Rode apply-all-driver-designation-flow.sql.",
    };
  }

  let res = await base();

  if (res.error?.message.includes("driver_assignment_pay_amount")) {
    const minimal = await supabase
      .from("service_orders")
      .select("id, code, service_date, status, driver_id")
      .eq("company_id", companyId)
      .not("driver_id", "is", null)
      .or("driver_assignment_response.eq.accepted,status.eq.Concluido")
      .order("service_date", { ascending: false });

    if (minimal.error) {
      return { data: null, error: minimal.error.message, schemaWarning: null };
    }

    return {
      data: (minimal.data ?? []).map((row) => ({
        ...(row as RawOrderRow),
        driver_assignment_pay_amount: null,
        driver_assignment_assistant_pay_amount: null,
        driver_payment_paid_at: null,
      })),
      error: null,
      schemaWarning:
        "Valores de pagamento ao motorista não encontrados no banco. Rode apply-all-driver-designation-flow.sql ou redesigne informando os valores.",
    };
  }

  if (res.error) {
    return { data: null, error: res.error.message, schemaWarning: null };
  }

  return { data: (res.data as RawOrderRow[]) ?? [], error: null, schemaWarning: null };
}

function mapOrderToPaymentRow(
  row: RawOrderRow,
  driversById: Map<string, DriverBanking>,
  proofCounts: Map<string, number>
): DriverPaymentRow | null {
  const driverId = row.driver_id;
  if (!driverId) return null;

  const embedded = row.drivers;
  const driver = embedded
    ? {
        code: embedded.code ?? "—",
        name: embedded.name ?? "—",
        pix_key: embedded.pix_key ?? null,
        bank_code: embedded.bank_code ?? null,
        bank_agency: embedded.bank_agency ?? null,
        bank_account: embedded.bank_account ?? null,
      }
    : driversById.get(driverId);

  const driverPay = parsePayAmount(row.driver_assignment_pay_amount);
  const assistantPayRaw = row.driver_assignment_assistant_pay_amount;
  let assistantPay: number | null = null;
  if (assistantPayRaw != null && assistantPayRaw !== "") {
    assistantPay = parsePayAmount(assistantPayRaw) ?? (Number(assistantPayRaw) > 0 ? Number(assistantPayRaw) : null);
  }

  return {
    id: row.id,
    code: row.code,
    service_date: row.service_date,
    status: row.status,
    driver_id: driverId,
    driver_code: driver?.code ?? "—",
    driver_name: driver?.name ?? "—",
    pix_key: driver?.pix_key ?? null,
    bank_code: driver?.bank_code ?? null,
    bank_agency: driver?.bank_agency ?? null,
    bank_account: driver?.bank_account ?? null,
    driver_assignment_pay_amount: driverPay,
    driver_assignment_assistant_pay_amount: assistantPay,
    driver_payment_paid_at: row.driver_payment_paid_at ?? null,
    payment_proof_count: proofCounts.get(row.id) ?? 0,
  };
}

export async function uploadDriverPaymentProof(params: {
  companyId: string;
  orderId: string;
  file: File;
}): Promise<{ error: string | null }> {
  const { error } = await uploadEntityAttachment({
    companyId: params.companyId,
    entityType: "service_order",
    entityId: params.orderId,
    file: params.file,
    description: DRIVER_PAYMENT_PROOF_DESCRIPTION,
  });

  return { error };
}

export async function fetchDriverPaymentRows(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: DriverPaymentRow[]; error: string | null; schemaWarning: string | null }> {
  const { data, error, schemaWarning } = await fetchPaymentOrders(supabase, companyId);

  if (error) {
    return { rows: [], error, schemaWarning: null };
  }

  if (!data?.length) {
    return { rows: [], error: null, schemaWarning };
  }

  const needsDriverLookup = data.some((row) => !row.drivers);
  const driverIds = [...new Set(data.map((row) => row.driver_id).filter(Boolean))];
  const driversById = needsDriverLookup
    ? await fetchDriversWithBanking(supabase, driverIds)
    : new Map<string, DriverBanking>();

  const orderIds = data.map((row) => row.id);
  const proofCounts = await fetchPaymentProofCountsByOrderId(supabase, companyId, orderIds);

  const rows = data
    .map((row) => mapOrderToPaymentRow(row, driversById, proofCounts))
    .filter(Boolean) as DriverPaymentRow[];

  return { rows, error: null, schemaWarning };
}

export async function markDriverPaymentPaid(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ paidAt: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("mark_driver_payment_paid", {
    p_order_id: orderId,
  });

  if (error) {
    const message = error.message.includes("mark_driver_payment_paid")
      ? "Função mark_driver_payment_paid não encontrada. Rode apply-all-driver-designation-flow.sql no Supabase."
      : error.message;
    return { paidAt: null, error: message };
  }

  const payload = data as { driver_payment_paid_at?: string } | null;
  return { paidAt: payload?.driver_payment_paid_at ?? null, error: null };
}

export function filterDriverPaymentRows(
  rows: DriverPaymentRow[],
  filter: DriverPaymentFilter
): DriverPaymentRow[] {
  if (filter === "pending") {
    return rows.filter((row) => !row.driver_payment_paid_at);
  }
  if (filter === "paid") {
    return rows.filter((row) => Boolean(row.driver_payment_paid_at));
  }
  return rows;
}

export function driverPaymentTotal(row: DriverPaymentRow): number {
  const driver = row.driver_assignment_pay_amount ?? 0;
  const assistant = row.driver_assignment_assistant_pay_amount ?? 0;
  return driver + assistant;
}

export function summarizeDriverPayments(rows: DriverPaymentRow[]): {
  motoristaTotal: number;
  ajudanteTotal: number;
  combinedTotal: number;
} {
  let motoristaTotal = 0;
  let ajudanteTotal = 0;

  for (const row of rows) {
    motoristaTotal += row.driver_assignment_pay_amount ?? 0;
    ajudanteTotal += row.driver_assignment_assistant_pay_amount ?? 0;
  }

  return {
    motoristaTotal,
    ajudanteTotal,
    combinedTotal: motoristaTotal + ajudanteTotal,
  };
}

export function formatDriverPayAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

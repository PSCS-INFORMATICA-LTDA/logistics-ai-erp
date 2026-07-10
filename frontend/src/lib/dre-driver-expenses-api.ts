import type { SupabaseClient } from "@supabase/supabase-js";

export type DreDriverExpenseRow = {
  id: string;
  transaction_date: string;
  amount: number;
  dre_account_name: string;
  driver_name: string | null;
  driver_code: string | null;
  service_order_code: string | null;
  pix_key: string | null;
  bank_code: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  description: string | null;
};

export type DreDriverExpenseSummary = {
  motoristaTotal: number;
  ajudanteTotal: number;
  combinedTotal: number;
};

const DRE_DRIVER_EXPENSE_ACCOUNTS = ["Motorista", "Ajudante"] as const;

function parseOrderCodeFromDescription(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/OS\s+(\S+)/i);
  return match?.[1] ?? null;
}

function applyMonthFilter<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
  query: T,
  options?: { year?: number; month?: number }
): T {
  if (!options?.year || !options?.month) return query;
  const start = `${options.year}-${String(options.month).padStart(2, "0")}-01`;
  const endMonth = options.month === 12 ? 1 : options.month + 1;
  const endYear = options.month === 12 ? options.year + 1 : options.year;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  return query.gte("transaction_date", start).lt("transaction_date", end);
}

export async function fetchDreDriverExpenses(
  supabase: SupabaseClient,
  companyId: string,
  options?: { year?: number; month?: number }
): Promise<{ rows: DreDriverExpenseRow[]; summary: DreDriverExpenseSummary; error: string | null }> {
  const baseSelect = `
      id,
      transaction_date,
      amount,
      description,
      driver_id,
      chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey (name)
    `;

  let query = applyMonthFilter(
    supabase
      .from("financial_transactions")
      .select(`${baseSelect}, service_order_id`)
      .eq("company_id", companyId)
      .eq("transaction_type", "Despesa")
      .order("transaction_date", { ascending: false }),
    options
  );

  let { data, error } = await query;

  if (error?.message.includes("service_order_id")) {
    const fallbackRes = await applyMonthFilter(
      supabase
        .from("financial_transactions")
        .select(baseSelect)
        .eq("company_id", companyId)
        .eq("transaction_type", "Despesa")
        .order("transaction_date", { ascending: false }),
      options
    );
    data = fallbackRes.data as typeof data;
    error = fallbackRes.error;
  }

  if (error) {
    return {
      rows: [],
      summary: { motoristaTotal: 0, ajudanteTotal: 0, combinedTotal: 0 },
      error: error.message,
    };
  }

  const orderIds = [
    ...new Set(
      (data ?? [])
        .map((item) => item.service_order_id as string | null)
        .filter(Boolean) as string[]
    ),
  ];
  const driverIds = [
    ...new Set(
      (data ?? []).map((item) => item.driver_id as string | null).filter(Boolean) as string[]
    ),
  ];

  const orderCodeById = new Map<string, string>();
  if (orderIds.length) {
    const { data: orders } = await supabase.from("service_orders").select("id, code").in("id", orderIds);
    for (const order of orders ?? []) {
      orderCodeById.set(order.id as string, order.code as string);
    }
  }

  const driverById = new Map<
    string,
    {
      code: string;
      name: string;
      pix_key: string | null;
      bank_code: string | null;
      bank_agency: string | null;
      bank_account: string | null;
    }
  >();
  if (driverIds.length) {
    const full = await supabase
      .from("drivers")
      .select("id, code, name, pix_key, bank_code, bank_agency, bank_account")
      .in("id", driverIds);

    let drivers = full.data;
    if (full.error?.message.includes("pix_key")) {
      const basic = await supabase.from("drivers").select("id, code, name").in("id", driverIds);
      drivers = (basic.data ?? []).map((d) => ({
        ...d,
        pix_key: null,
        bank_code: null,
        bank_agency: null,
        bank_account: null,
      }));
    }

    for (const driver of drivers ?? []) {
      driverById.set(driver.id as string, {
        code: driver.code as string,
        name: driver.name as string,
        pix_key: (driver.pix_key as string | null) ?? null,
        bank_code: (driver.bank_code as string | null) ?? null,
        bank_agency: (driver.bank_agency as string | null) ?? null,
        bank_account: (driver.bank_account as string | null) ?? null,
      });
    }
  }

  const rows: DreDriverExpenseRow[] = [];
  let motoristaTotal = 0;
  let ajudanteTotal = 0;

  for (const item of data ?? []) {
    const accountName = (item.chart_of_account as { name?: string } | null)?.name ?? "";
    if (!DRE_DRIVER_EXPENSE_ACCOUNTS.includes(accountName as (typeof DRE_DRIVER_EXPENSE_ACCOUNTS)[number])) {
      continue;
    }

    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) continue;

    if (accountName === "Motorista") motoristaTotal += amount;
    if (accountName === "Ajudante") ajudanteTotal += amount;

    const driverId = item.driver_id as string | null;
    const driver = driverId ? driverById.get(driverId) : null;
    const orderId = item.service_order_id as string | null;
    const description = (item.description as string | null) ?? null;

    rows.push({
      id: item.id as string,
      transaction_date: item.transaction_date as string,
      amount,
      dre_account_name: accountName,
      driver_name: driver?.name ?? null,
      driver_code: driver?.code ?? null,
      service_order_code:
        (orderId && orderCodeById.get(orderId)) ?? parseOrderCodeFromDescription(description),
      pix_key: driver?.pix_key ?? null,
      bank_code: driver?.bank_code ?? null,
      bank_agency: driver?.bank_agency ?? null,
      bank_account: driver?.bank_account ?? null,
      description,
    });
  }

  return {
    rows,
    summary: {
      motoristaTotal,
      ajudanteTotal,
      combinedTotal: motoristaTotal + ajudanteTotal,
    },
    error: null,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordDeletion, summarizeDeletedRow } from "@/lib/deletion-audit";
import {
  VEHICLE_EXPENSE_CATEGORIES,
  VEHICLE_EXPENSE_ENTRY_SOURCE,
  type VehicleExpenseCategoryKey,
} from "@/lib/vehicle-expense-categories";

export type DreVehicleExpenseRow = {
  id: string;
  transaction_date: string;
  amount: number;
  dre_account_name: string;
  plate: string | null;
  vehicle_id: string | null;
  service_order_id: string | null;
  service_order_code: string | null;
  description: string | null;
  entry_source: string | null;
};

export type DreVehicleExpenseSummary = {
  byAccount: Record<string, number>;
  totalExpense: number;
  totalRevenue: number;
  result: number;
};

export type CreateVehicleExpenseInput = {
  vehicleId: string;
  transactionDate: string;
  amount: number;
  categoryKey: VehicleExpenseCategoryKey;
  chartOfAccountId?: string | null;
  serviceOrderId?: string | null;
  description?: string | null;
};

function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  return { start, end };
}

function applyMonthFilter<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
  query: T,
  year?: number,
  month?: number
): T {
  if (!year || !month) return query;
  const { start, end } = monthBounds(year, month);
  return query.gte("transaction_date", start).lt("transaction_date", end);
}

export async function resolveVehicleExpenseAccountId(
  supabase: SupabaseClient,
  companyId: string,
  categoryKey: VehicleExpenseCategoryKey,
  chartOfAccountId?: string | null
): Promise<{ accountId: string; accountName: string; classification: string } | { error: string }> {
  const category = VEHICLE_EXPENSE_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return { error: "Categoria invÃ¡lida." };

  if (category.key === "outros") {
    if (!chartOfAccountId) return { error: "Selecione a conta DRE para Â«OutrosÂ»." };
    const { data, error } = await supabase
      .from("chart_of_accounts")
      .select("id, name, classification, transaction_type")
      .eq("company_id", companyId)
      .eq("id", chartOfAccountId)
      .eq("status", "Ativo")
      .maybeSingle();
    if (error || !data) return { error: "Conta DRE nÃ£o encontrada." };
    if (data.transaction_type !== "Despesa") return { error: "A conta precisa ser do tipo Despesa." };
    return {
      accountId: data.id as string,
      accountName: data.name as string,
      classification: (data.classification as string) || "Operacional",
    };
  }

  const accountName = category.accountName!;
  let { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, name, classification")
    .eq("company_id", companyId)
    .eq("name", accountName)
    .eq("status", "Ativo")
    .maybeSingle();

  if ((!data || error) && accountName === "Pneus") {
    const inserted = await supabase
      .from("chart_of_accounts")
      .upsert(
        {
          company_id: companyId,
          name: "Pneus",
          classification: "Operacional",
          transaction_type: "Despesa",
          status: "Ativo",
        },
        { onConflict: "company_id,name" }
      )
      .select("id, name, classification")
      .maybeSingle();
    data = inserted.data;
    error = inserted.error;
  }

  if (error || !data) {
    return {
      error: `Conta DRE Â«${accountName}Â» nÃ£o encontrada. Importe o plano de contas ou rode apply-038-vehicle-expenses.sql.`,
    };
  }

  return {
    accountId: data.id as string,
    accountName: data.name as string,
    classification: (data.classification as string) || "Operacional",
  };
}

/** Duplicata: mesma data + mesma OS + mesma conta DRE. */
export async function findDuplicateVehicleExpense(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    transactionDate: string;
    serviceOrderId: string;
    chartOfAccountId: string;
    excludeId?: string;
  }
): Promise<DreVehicleExpenseRow | null> {
  let query = supabase
    .from("financial_transactions")
    .select(
      `
      id,
      transaction_date,
      amount,
      description,
      entry_source,
      service_order_id,
      allocation_vehicle_id,
      chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey (name)
    `
    )
    .eq("company_id", companyId)
    .eq("transaction_type", "Despesa")
    .eq("transaction_date", input.transactionDate)
    .eq("service_order_id", input.serviceOrderId)
    .eq("chart_of_account_id", input.chartOfAccountId)
    .limit(1);

  if (input.excludeId) {
    query = query.neq("id", input.excludeId);
  }

  const { data } = await query.maybeSingle();
  if (!data) return null;

  return {
    id: data.id as string,
    transaction_date: data.transaction_date as string,
    amount: Number(data.amount),
    dre_account_name: (data.chart_of_account as { name?: string } | null)?.name ?? "",
    plate: null,
    vehicle_id: (data.allocation_vehicle_id as string | null) ?? null,
    service_order_id: data.service_order_id as string,
    service_order_code: null,
    description: (data.description as string | null) ?? null,
    entry_source: (data.entry_source as string | null) ?? null,
  };
}

export async function createVehicleExpense(
  supabase: SupabaseClient,
  companyId: string,
  input: CreateVehicleExpenseInput
): Promise<{ row: DreVehicleExpenseRow | null; error: string | null }> {
  if (!input.vehicleId) return { row: null, error: "Selecione o veÃ­culo (placa)." };
  if (!input.transactionDate) return { row: null, error: "Informe a data." };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { row: null, error: "Informe um valor vÃ¡lido." };

  const account = await resolveVehicleExpenseAccountId(
    supabase,
    companyId,
    input.categoryKey,
    input.chartOfAccountId
  );
  if ("error" in account) return { row: null, error: account.error };

  if (input.serviceOrderId) {
    const dup = await findDuplicateVehicleExpense(supabase, companyId, {
      transactionDate: input.transactionDate,
      serviceOrderId: input.serviceOrderId,
      chartOfAccountId: account.accountId,
    });
    if (dup) {
      return {
        row: null,
        error: `LanÃ§amento duplicado: jÃ¡ existe Â«${account.accountName}Â» nesta data para a mesma OS. Evite duplicar pedÃ¡gio/combustÃ­vel da OS.`,
      };
    }
  }

  const categoryLabel =
    VEHICLE_EXPENSE_CATEGORIES.find((c) => c.key === input.categoryKey)?.label ?? "Despesa";

  const payload: Record<string, unknown> = {
    company_id: companyId,
    transaction_date: input.transactionDate,
    amount,
    chart_of_account_id: account.accountId,
    classification: account.classification,
    transaction_type: "Despesa",
    operational_vehicle_id: input.vehicleId,
    allocation_vehicle_id: input.vehicleId,
    service_order_id: input.serviceOrderId || null,
    service_date: input.transactionDate,
    description: (input.description || `${categoryLabel} â€” veÃ­culo`).trim(),
    entry_source: VEHICLE_EXPENSE_ENTRY_SOURCE,
  };

  let { data, error } = await supabase
    .from("financial_transactions")
    .insert(payload)
    .select(
      `
      id,
      transaction_date,
      amount,
      description,
      entry_source,
      service_order_id,
      allocation_vehicle_id
    `
    )
    .single();

  if (error?.message.includes("entry_source")) {
    delete payload.entry_source;
    const retry = await supabase
      .from("financial_transactions")
      .insert(payload)
      .select(
        `
        id,
        transaction_date,
        amount,
        description,
        service_order_id,
        allocation_vehicle_id
      `
      )
      .single();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    if (error.message.includes("uq_ft_vehicle_expense_os_date_account") || error.code === "23505") {
      return {
        row: null,
        error:
          "LanÃ§amento duplicado: jÃ¡ existe despesa desta conta na mesma data e OS. NÃ£o Ã© permitido repetir.",
      };
    }
    return { row: null, error: error.message };
  }

  if (!data) {
    return { row: null, error: "Falha ao gravar o lancamento." };
  }

  return {
    row: {
      id: data.id as string,
      transaction_date: data.transaction_date as string,
      amount: Number(data.amount),
      dre_account_name: account.accountName,
      plate: null,
      vehicle_id: data.allocation_vehicle_id as string,
      service_order_id: (data.service_order_id as string | null) ?? null,
      service_order_code: null,
      description: (data.description as string | null) ?? null,
      entry_source: (data.entry_source as string | null) ?? VEHICLE_EXPENSE_ENTRY_SOURCE,
    },
    error: null,
  };
}

export async function deleteVehicleExpense(
  supabase: SupabaseClient,
  companyId: string,
  id: string,
  reason?: string | null
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from("financial_transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    const row = existing as Record<string, unknown>;
    const { entityCode, summary } = summarizeDeletedRow(row, "financial_transactions");
    await recordDeletion({
      supabase,
      companyId,
      entityType: "financial_transactions",
      entityId: id,
      entityCode,
      summary,
      reason,
      screenKey: "dre.despesas-veiculo",
      deleteMode: "hard",
      payload: row,
    });
  }

  const { error } = await supabase
    .from("financial_transactions")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  return { error: error?.message ?? null };
}

export async function fetchDreVehicleExpenses(
  supabase: SupabaseClient,
  companyId: string,
  options: { year: number; month: number; vehicleId?: string | null }
): Promise<{
  rows: DreVehicleExpenseRow[];
  summary: DreVehicleExpenseSummary;
  error: string | null;
}> {
  const emptySummary: DreVehicleExpenseSummary = {
    byAccount: {},
    totalExpense: 0,
    totalRevenue: 0,
    result: 0,
  };

  let query = applyMonthFilter(
    supabase
      .from("financial_transactions")
      .select(
        `
        id,
        transaction_date,
        amount,
        description,
        entry_source,
        service_order_id,
        allocation_vehicle_id,
        operational_vehicle_id,
        chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey (name)
      `
      )
      .eq("company_id", companyId)
      .eq("transaction_type", "Despesa")
      .order("transaction_date", { ascending: false }),
    options.year,
    options.month
  );

  if (options.vehicleId) {
    query = query.or(
      `allocation_vehicle_id.eq.${options.vehicleId},operational_vehicle_id.eq.${options.vehicleId}`
    );
  } else {
    query = query.not("allocation_vehicle_id", "is", null);
  }

  const { data, error } = await query;

  if (error) {
    return { rows: [], summary: emptySummary, error: error.message };
  }

  const vehicleIds = [
    ...new Set(
      (data ?? [])
        .map(
          (item) =>
            (item.allocation_vehicle_id as string | null) ||
            (item.operational_vehicle_id as string | null)
        )
        .filter(Boolean) as string[]
    ),
  ];
  if (options.vehicleId && !vehicleIds.includes(options.vehicleId)) {
    vehicleIds.push(options.vehicleId);
  }

  const plateById = new Map<string, string>();
  if (vehicleIds.length) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, plate, plate_display")
      .in("id", vehicleIds);
    for (const v of vehicles ?? []) {
      plateById.set(
        v.id as string,
        ((v.plate_display as string | null) || (v.plate as string) || "").toUpperCase()
      );
    }
  }

  const orderIds = [
    ...new Set(
      (data ?? []).map((item) => item.service_order_id as string | null).filter(Boolean) as string[]
    ),
  ];
  const orderCodeById = new Map<string, string>();
  if (orderIds.length) {
    const { data: orders } = await supabase.from("service_orders").select("id, code").in("id", orderIds);
    for (const order of orders ?? []) {
      orderCodeById.set(order.id as string, order.code as string);
    }
  }

  const driverAccountNames = new Set(["Motorista", "Ajudante"]);
  const rows: DreVehicleExpenseRow[] = [];
  const byAccount: Record<string, number> = {};
  let totalExpense = 0;

  for (const item of data ?? []) {
    const accountName = (item.chart_of_account as { name?: string } | null)?.name ?? "â€”";
    if (driverAccountNames.has(accountName)) continue;

    const vehicleId =
      (item.allocation_vehicle_id as string | null) ||
      (item.operational_vehicle_id as string | null);
    if (!vehicleId) continue;

    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) continue;

    totalExpense += amount;
    byAccount[accountName] = (byAccount[accountName] ?? 0) + amount;

    const orderId = item.service_order_id as string | null;
    rows.push({
      id: item.id as string,
      transaction_date: item.transaction_date as string,
      amount,
      dre_account_name: accountName,
      plate: plateById.get(vehicleId) ?? null,
      vehicle_id: vehicleId,
      service_order_id: orderId,
      service_order_code: orderId ? orderCodeById.get(orderId) ?? null : null,
      description: (item.description as string | null) ?? null,
      entry_source: (item.entry_source as string | null) ?? null,
    });
  }

  let totalRevenue = 0;
  if (options.vehicleId) {
    const { start, end } = monthBounds(options.year, options.month);
    const { data: orders } = await supabase
      .from("service_orders")
      .select("service_amount, freight_agreed_amount, status")
      .eq("company_id", companyId)
      .eq("vehicle_id", options.vehicleId)
      .gte("service_date", start)
      .lt("service_date", end)
      .neq("status", "Cancelado");

    for (const order of orders ?? []) {
      const agreed = Number(order.freight_agreed_amount);
      const service = Number(order.service_amount);
      const value = Number.isFinite(agreed) && agreed > 0 ? agreed : service;
      if (Number.isFinite(value) && value > 0) totalRevenue += value;
    }
  }

  return {
    rows,
    summary: {
      byAccount,
      totalExpense,
      totalRevenue,
      result: totalRevenue - totalExpense,
    },
    error: null,
  };
}

export async function fetchVehicleOrdersForSelect(
  supabase: SupabaseClient,
  companyId: string,
  vehicleId: string,
  limit = 40
): Promise<{ value: string; label: string }[]> {
  const { data } = await supabase
    .from("service_orders")
    .select("id, code, service_date, client_name, status")
    .eq("company_id", companyId)
    .eq("vehicle_id", vehicleId)
    .neq("status", "Cancelado")
    .order("service_date", { ascending: false })
    .limit(limit);

  return (data ?? []).map((order) => {
    const date = order.service_date
      ? String(order.service_date).split("-").reverse().join("/")
      : "â€”";
    const client = order.client_name ? ` Â· ${order.client_name}` : "";
    return {
      value: order.id as string,
      label: `${order.code} Â· ${date}${client}`,
    };
  });
}

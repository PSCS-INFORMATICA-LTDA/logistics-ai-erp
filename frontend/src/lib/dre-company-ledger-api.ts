import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY_LEDGER_ENTRY_SOURCE } from "@/lib/company-ledger";
import { recordDeletion, summarizeDeletedRow } from "@/lib/deletion-audit";

export type CompanyLedgerRow = {
  id: string;
  transaction_date: string;
  amount: number;
  transaction_type: "Receita" | "Despesa" | "Outros";
  dre_account_name: string;
  classification: string;
  description: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  entry_source: string | null;
};

export type CompanyLedgerSummary = {
  totalRevenue: number;
  totalExpense: number;
  balance: number;
  byAccount: Record<string, number>;
};

export type CreateCompanyLedgerInput = {
  transactionDate: string;
  amount: number;
  chartOfAccountId: string;
  description?: string | null;
  supplierId?: string | null;
};

function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  return { start, end };
}

export async function createCompanyLedgerEntry(
  supabase: SupabaseClient,
  companyId: string,
  input: CreateCompanyLedgerInput
): Promise<{ row: CompanyLedgerRow | null; error: string | null }> {
  if (!input.transactionDate) return { row: null, error: "Informe a data." };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { row: null, error: "Informe um valor válido." };
  if (!input.chartOfAccountId) return { row: null, error: "Selecione a conta DRE." };

  const { data: account, error: accountError } = await supabase
    .from("chart_of_accounts")
    .select("id, name, classification, transaction_type")
    .eq("company_id", companyId)
    .eq("id", input.chartOfAccountId)
    .eq("status", "Ativo")
    .maybeSingle();

  if (accountError || !account) return { row: null, error: "Conta DRE não encontrada." };
  if (account.transaction_type !== "Receita" && account.transaction_type !== "Despesa") {
    return { row: null, error: "A conta precisa ser Receita ou Despesa." };
  }

  const { data: dup } = await supabase
    .from("financial_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("transaction_date", input.transactionDate)
    .eq("chart_of_account_id", input.chartOfAccountId)
    .eq("amount", amount)
    .eq("entry_source", COMPANY_LEDGER_ENTRY_SOURCE)
    .limit(1)
    .maybeSingle();

  if (dup) {
    return {
      row: null,
      error:
        "Lançamento duplicado: já existe o mesmo valor nesta conta e data. Confira antes de lançar de novo.",
    };
  }

  const description =
    (input.description || "").trim() ||
    `${account.transaction_type === "Receita" ? "Receita" : "Despesa"} — ${account.name}`;

  const payload: Record<string, unknown> = {
    company_id: companyId,
    transaction_date: input.transactionDate,
    amount,
    chart_of_account_id: account.id,
    classification: (account.classification as string) || "Administrativo",
    transaction_type: account.transaction_type,
    supplier_id:
      account.transaction_type === "Despesa" && input.supplierId ? input.supplierId : null,
    client_id: null,
    description,
    entry_source: COMPANY_LEDGER_ENTRY_SOURCE,
  };

  let { data, error } = await supabase
    .from("financial_transactions")
    .insert(payload)
    .select("id, transaction_date, amount, transaction_type, classification, description, entry_source, supplier_id")
    .single();

  if (error?.message.includes("entry_source")) {
    delete payload.entry_source;
    const retry = await supabase
      .from("financial_transactions")
      .insert(payload)
      .select("id, transaction_date, amount, transaction_type, classification, description, supplier_id")
      .single();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    if (error.code === "23505") {
      return { row: null, error: "Lançamento duplicado (mesma data, conta e valor)." };
    }
    return { row: null, error: error.message };
  }

  if (!data) {
    return { row: null, error: "Falha ao gravar lancamento." };
  }

  return {
    row: {
      id: data.id as string,
      transaction_date: data.transaction_date as string,
      amount: Number(data.amount),
      transaction_type: data.transaction_type as CompanyLedgerRow["transaction_type"],
      dre_account_name: account.name as string,
      classification: (data.classification as string) || "",
      description: (data.description as string | null) ?? null,
      supplier_id: (data.supplier_id as string | null) ?? null,
      supplier_name: null,
      entry_source: (data.entry_source as string | null) ?? COMPANY_LEDGER_ENTRY_SOURCE,
    },
    error: null,
  };
}

export async function deleteCompanyLedgerEntry(
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
    .eq("entry_source", COMPANY_LEDGER_ENTRY_SOURCE)
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
      screenKey: "dre.lancamentos",
      deleteMode: "hard",
      payload: row,
    });
  }

  const { error } = await supabase
    .from("financial_transactions")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id)
    .eq("entry_source", COMPANY_LEDGER_ENTRY_SOURCE);
  return { error: error?.message ?? null };
}

export async function fetchCompanyLedger(
  supabase: SupabaseClient,
  companyId: string,
  options: {
    year: number;
    month: number;
    typeFilter?: "all" | "Receita" | "Despesa";
    accountId?: string | null;
  }
): Promise<{ rows: CompanyLedgerRow[]; summary: CompanyLedgerSummary; error: string | null }> {
  const empty: CompanyLedgerSummary = {
    totalRevenue: 0,
    totalExpense: 0,
    balance: 0,
    byAccount: {},
  };

  const { start, end } = monthBounds(options.year, options.month);

  let query = supabase
    .from("financial_transactions")
    .select(
      `
      id,
      transaction_date,
      amount,
      transaction_type,
      classification,
      description,
      entry_source,
      supplier_id,
      chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey (name)
    `
    )
    .eq("company_id", companyId)
    .eq("entry_source", COMPANY_LEDGER_ENTRY_SOURCE)
    .gte("transaction_date", start)
    .lt("transaction_date", end)
    .order("transaction_date", { ascending: false });

  if (options.typeFilter && options.typeFilter !== "all") {
    query = query.eq("transaction_type", options.typeFilter);
  }
  if (options.accountId) {
    query = query.eq("chart_of_account_id", options.accountId);
  }

  let { data, error } = await query;

  if (error?.message.includes("entry_source")) {
    // Fallback: lançamentos manuais sem placa e sem motorista (legado)
    let fallback = supabase
      .from("financial_transactions")
      .select(
        `
        id,
        transaction_date,
        amount,
        transaction_type,
        classification,
        description,
        supplier_id,
        driver_id,
        allocation_vehicle_id,
        chart_of_account:chart_of_accounts!financial_transactions_chart_of_account_id_fkey (name)
      `
      )
      .eq("company_id", companyId)
      .is("allocation_vehicle_id", null)
      .is("driver_id", null)
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .order("transaction_date", { ascending: false });

    if (options.typeFilter && options.typeFilter !== "all") {
      fallback = fallback.eq("transaction_type", options.typeFilter);
    }
    if (options.accountId) {
      fallback = fallback.eq("chart_of_account_id", options.accountId);
    }
    const retry = await fallback;
    data = (retry.data as typeof data) ?? [];
    error = retry.error;
  }

  if (error) {
    return { rows: [], summary: empty, error: error.message };
  }

  const supplierIds = [
    ...new Set(
      (data ?? []).map((r) => r.supplier_id as string | null).filter(Boolean) as string[]
    ),
  ];
  const supplierNameById = new Map<string, string>();
  if (supplierIds.length) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", supplierIds);
    for (const s of suppliers ?? []) {
      supplierNameById.set(s.id as string, s.name as string);
    }
  }

  const rows: CompanyLedgerRow[] = [];
  let totalRevenue = 0;
  let totalExpense = 0;
  const byAccount: Record<string, number> = {};

  for (const item of data ?? []) {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) continue;
    const type = item.transaction_type as CompanyLedgerRow["transaction_type"];
    const accountName = (item.chart_of_account as { name?: string } | null)?.name ?? "—";

    if (type === "Receita") totalRevenue += amount;
    if (type === "Despesa") totalExpense += amount;

    const signed = type === "Receita" ? amount : type === "Despesa" ? -amount : 0;
    byAccount[accountName] = (byAccount[accountName] ?? 0) + signed;

    const supplierId = (item.supplier_id as string | null) ?? null;
    rows.push({
      id: item.id as string,
      transaction_date: item.transaction_date as string,
      amount,
      transaction_type: type,
      dre_account_name: accountName,
      classification: (item.classification as string) || "",
      description: (item.description as string | null) ?? null,
      supplier_id: supplierId,
      supplier_name: supplierId ? supplierNameById.get(supplierId) ?? null : null,
      entry_source: (item.entry_source as string | null) ?? COMPANY_LEDGER_ENTRY_SOURCE,
    });
  }

  return {
    rows,
    summary: {
      totalRevenue,
      totalExpense,
      balance: totalRevenue - totalExpense,
      byAccount,
    },
    error: null,
  };
}

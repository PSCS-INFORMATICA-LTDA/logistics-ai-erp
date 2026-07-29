import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcNetAmount,
  splitInstallments,
  type AccountsPayableAllocation,
  type AccountsPayableInstallment,
  type AccountsPayablePayment,
  type AccountsPayableRow,
  type CompanyFinancialAccount,
  type CreateApInput,
  type FinancialAccountType,
  round2,
} from "@/lib/accounts-payable";
import { recordDeletion, summarizeDeletedRow } from "@/lib/deletion-audit";

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v || 0);
}

function mapAccount(row: Record<string, unknown>): CompanyFinancialAccount {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    branch_id: (row.branch_id as string) || null,
    name: String(row.name),
    account_type: row.account_type as FinancialAccountType,
    bank_code: (row.bank_code as string) || null,
    bank_name: (row.bank_name as string) || null,
    agency: (row.agency as string) || null,
    account_number: (row.account_number as string) || null,
    pix_key: (row.pix_key as string) || null,
    opening_balance: num(row.opening_balance),
    opening_balance_date: (row.opening_balance_date as string) || null,
    currency: String(row.currency || "BRL"),
    is_active: Boolean(row.is_active),
    deleted_at: (row.deleted_at as string) || null,
  };
}

function mapPayable(row: Record<string, unknown>): AccountsPayableRow {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    branch_id: (row.branch_id as string) || null,
    internal_number: String(row.internal_number),
    description: String(row.description),
    competence_date: String(row.competence_date),
    entry_date: String(row.entry_date),
    issue_date: (row.issue_date as string) || null,
    supplier_id: (row.supplier_id as string) || null,
    driver_id: (row.driver_id as string) || null,
    partner_id: (row.partner_id as string) || null,
    client_id: (row.client_id as string) || null,
    company_payee_id: (row.company_payee_id as string) || null,
    payee_name: (row.payee_name as string) || null,
    chart_of_account_id: String(row.chart_of_account_id),
    original_amount: num(row.original_amount),
    discount_amount: num(row.discount_amount),
    addition_amount: num(row.addition_amount),
    interest_amount: num(row.interest_amount),
    penalty_amount: num(row.penalty_amount),
    net_amount: num(row.net_amount),
    paid_amount: num(row.paid_amount),
    open_balance: num(row.open_balance),
    installment_count: Number(row.installment_count || 1),
    status: row.status as AccountsPayableRow["status"],
    approval_status: row.approval_status as AccountsPayableRow["approval_status"],
    notes: (row.notes as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    cancellation_reason: (row.cancellation_reason as string) || null,
    created_at: String(row.created_at),
  };
}

export async function listFinancialAccounts(
  supabase: SupabaseClient,
  companyId: string,
  opts?: { activeOnly?: boolean }
): Promise<{ rows: CompanyFinancialAccount[]; error: string | null }> {
  let q = supabase
    .from("company_financial_accounts")
    .select("*")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("name");
  if (opts?.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  return { rows: (data || []).map((r) => mapAccount(r as Record<string, unknown>)), error: null };
}

export async function createFinancialAccount(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    name: string;
    accountType: FinancialAccountType;
    openingBalance?: number;
    openingBalanceDate?: string | null;
    branchId?: string | null;
    bankCode?: string | null;
    bankName?: string | null;
    agency?: string | null;
    accountNumber?: string | null;
    pixKey?: string | null;
  }
): Promise<{ row: CompanyFinancialAccount | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("company_financial_accounts")
    .insert({
      company_id: input.companyId,
      name: input.name.trim(),
      account_type: input.accountType,
      opening_balance: input.openingBalance ?? 0,
      opening_balance_date: input.openingBalanceDate || null,
      branch_id: input.branchId || null,
      bank_code: input.bankCode || null,
      bank_name: input.bankName || null,
      agency: input.agency || null,
      account_number: input.accountNumber || null,
      pix_key: input.pixKey || null,
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) return { row: null, error: error.message };
  return { row: mapAccount(data as Record<string, unknown>), error: null };
}

export async function updateFinancialAccountActive(
  supabase: SupabaseClient,
  companyId: string,
  accountId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("company_financial_accounts")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("company_id", companyId)
    .is("deleted_at", null);
  return { error: error?.message || null };
}

export async function softDeleteFinancialAccount(
  supabase: SupabaseClient,
  companyId: string,
  accountId: string,
  reason: { code: string; detail: string },
  screenKey = "financeiro.contas"
): Promise<{ error: string | null }> {
  const { count, error: payErr } = await supabase
    .from("accounts_payable_payments")
    .select("id", { count: "exact", head: true })
    .eq("financial_account_id", accountId);
  if (payErr) return { error: payErr.message };
  if ((count || 0) > 0) {
    return {
      error:
        "Conta já utilizada em pagamento. Não é possível excluir — inative a conta.",
    };
  }

  const { data: row, error: fetchErr } = await supabase
    .from("company_financial_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (fetchErr || !row) return { error: fetchErr?.message || "Conta não encontrada." };

  const { entityCode, summary } = summarizeDeletedRow(row, "company_financial_accounts");
  const { error: updErr } = await supabase.rpc("soft_delete_company_financial_account", {
    p_account_id: accountId,
  });
  if (updErr) return { error: updErr.message };

  await recordDeletion({
    supabase,
    companyId,
    entityType: "company_financial_accounts",
    entityId: accountId,
    entityCode,
    summary,
    deleteMode: "soft",
    reasonCode: reason.code as never,
    reason: reason.detail,
    screenKey,
    payload: row as Record<string, unknown>,
  });
  return { error: null };
}

export async function listAccountsPayable(
  supabase: SupabaseClient,
  companyId: string,
  opts?: {
    status?: string;
    approvalStatus?: string;
    fromCompetence?: string;
    toCompetence?: string;
  }
): Promise<{
  rows: Array<
    AccountsPayableRow & {
      chart_name?: string | null;
      supplier_name?: string | null;
      driver_name?: string | null;
      next_due_date?: string | null;
    }
  >;
  error: string | null;
}> {
  let q = supabase
    .from("accounts_payable")
    .select(
      `
      *,
      chart_of_accounts ( name ),
      suppliers ( name ),
      drivers ( name ),
      accounts_payable_installments ( due_date, open_balance, status )
    `
    )
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("competence_date", { ascending: false });

  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.approvalStatus) q = q.eq("approval_status", opts.approvalStatus);
  if (opts?.fromCompetence) q = q.gte("competence_date", opts.fromCompetence);
  if (opts?.toCompetence) q = q.lte("competence_date", opts.toCompetence);

  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };

  const rows = (data || []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const inst = (r.accounts_payable_installments as Array<Record<string, unknown>>) || [];
    const openInst = inst.filter(
      (i) => String(i.status) !== "cancelled" && num(i.open_balance) > 0
    );
    const nextDue =
      openInst.length > 0
        ? openInst.map((i) => String(i.due_date)).sort()[0]
        : null;
    const chart = r.chart_of_accounts as { name?: string } | null;
    const supplier = r.suppliers as { name?: string } | null;
    const driver = r.drivers as { name?: string } | null;
    return {
      ...mapPayable(r),
      chart_name: chart?.name || null,
      supplier_name: supplier?.name || null,
      driver_name: driver?.name || null,
      next_due_date: nextDue,
    };
  });
  return { rows, error: null };
}

export async function fetchAccountsPayableDetail(
  supabase: SupabaseClient,
  companyId: string,
  payableId: string
): Promise<{
  payable: AccountsPayableRow | null;
  installments: AccountsPayableInstallment[];
  allocations: AccountsPayableAllocation[];
  payments: AccountsPayablePayment[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("accounts_payable")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", payableId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) {
    return {
      payable: null,
      installments: [],
      allocations: [],
      payments: [],
      error: error?.message || "Título não encontrado",
    };
  }

  const [inst, alloc, pays] = await Promise.all([
    supabase
      .from("accounts_payable_installments")
      .select("*")
      .eq("accounts_payable_id", payableId)
      .order("installment_no"),
    supabase
      .from("accounts_payable_allocations")
      .select("*")
      .eq("accounts_payable_id", payableId)
      .order("line_no"),
    supabase
      .from("accounts_payable_payments")
      .select("*")
      .eq("accounts_payable_id", payableId)
      .order("paid_at", { ascending: false }),
  ]);

  return {
    payable: mapPayable(data as Record<string, unknown>),
    installments: (inst.data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        company_id: String(r.company_id),
        accounts_payable_id: String(r.accounts_payable_id),
        installment_no: Number(r.installment_no),
        due_date: String(r.due_date),
        amount: num(r.amount),
        paid_amount: num(r.paid_amount),
        open_balance: num(r.open_balance),
        status: r.status as AccountsPayableInstallment["status"],
      };
    }),
    allocations: (alloc.data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        company_id: String(r.company_id),
        accounts_payable_id: String(r.accounts_payable_id),
        line_no: Number(r.line_no),
        amount: num(r.amount),
        branch_id: (r.branch_id as string) || null,
        vehicle_id: (r.vehicle_id as string) || null,
        driver_id: (r.driver_id as string) || null,
        service_order_id: (r.service_order_id as string) || null,
        chart_of_account_id: (r.chart_of_account_id as string) || null,
        notes: (r.notes as string) || null,
      };
    }),
    payments: (pays.data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        company_id: String(r.company_id),
        accounts_payable_id: String(r.accounts_payable_id),
        installment_id: String(r.installment_id),
        paid_at: String(r.paid_at),
        principal_amount: num(r.principal_amount),
        interest_amount: num(r.interest_amount),
        penalty_amount: num(r.penalty_amount),
        discount_amount: num(r.discount_amount),
        total_paid_amount: num(r.total_paid_amount),
        financial_account_id: String(r.financial_account_id),
        payment_method: String(r.payment_method),
        bank_ref: (r.bank_ref as string) || null,
        notes: (r.notes as string) || null,
        reversed_at: (r.reversed_at as string) || null,
        reversal_reason: (r.reversal_reason as string) || null,
      };
    }),
    error: null,
  };
}

function countPayees(input: CreateApInput): number {
  return (
    (input.supplierId ? 1 : 0) +
    (input.driverId ? 1 : 0) +
    (input.partnerId ? 1 : 0) +
    (input.clientId ? 1 : 0) +
    (input.companyPayeeId ? 1 : 0) +
    (input.payeeName?.trim() ? 1 : 0)
  );
}

export async function createAccountsPayableDraft(
  supabase: SupabaseClient,
  input: CreateApInput
): Promise<{ id: string | null; internalNumber: string | null; error: string | null }> {
  if (!input.description?.trim()) {
    return { id: null, internalNumber: null, error: "Informe a descrição do título." };
  }
  if (countPayees(input) !== 1) {
    return { id: null, internalNumber: null, error: "Informe exatamente um favorecido." };
  }
  if (!Number.isFinite(input.originalAmount) || input.originalAmount <= 0) {
    return {
      id: null,
      internalNumber: null,
      error: "Informe um valor original maior que zero.",
    };
  }
  if (
    input.installmentCount != null &&
    (!Number.isInteger(input.installmentCount) || input.installmentCount < 1)
  ) {
    return {
      id: null,
      internalNumber: null,
      error: "A quantidade de parcelas deve ser um inteiro maior que zero.",
    };
  }

  if (input.supplierId) {
    const { data: sup } = await supabase
      .from("suppliers")
      .select("id")
      .eq("id", input.supplierId)
      .eq("company_id", input.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!sup) {
      return { id: null, internalNumber: null, error: "Fornecedor inválido para a empresa." };
    }
  }
  if (input.driverId) {
    const { data: drv } = await supabase
      .from("drivers")
      .select("id")
      .eq("id", input.driverId)
      .eq("company_id", input.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!drv) {
      return { id: null, internalNumber: null, error: "Motorista inválido para a empresa." };
    }
  }
  {
    const { data: coa } = await supabase
      .from("chart_of_accounts")
      .select("id")
      .eq("id", input.chartOfAccountId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (!coa) {
      return { id: null, internalNumber: null, error: "Conta DRE inválida para a empresa." };
    }
  }

  const net = calcNetAmount({
    originalAmount: input.originalAmount,
    discountAmount: input.discountAmount,
    additionAmount: input.additionAmount,
    interestAmount: input.interestAmount,
    penaltyAmount: input.penaltyAmount,
  });
  if (net <= 0) {
    return { id: null, internalNumber: null, error: "Valor líquido deve ser maior que zero." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: numberData, error: numberErr } = await supabase.rpc(
    "next_company_document_number",
    {
      p_company_id: input.companyId,
      p_document_type: "accounts_payable",
      p_prefix: "AP",
      p_padding: 8,
    }
  );
  if (numberErr || !numberData) {
    return {
      id: null,
      internalNumber: null,
      error: numberErr?.message || "Falha ao gerar número interno.",
    };
  }
  const internalNumber = String(numberData);

  const installmentCount = Math.max(1, input.installmentCount ?? 1);
  const installments = splitInstallments(net, installmentCount, input.firstDueDate);
  const allocations =
    input.allocations && input.allocations.length > 0
      ? input.allocations
      : [{ amount: net }];

  const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocSum !== net) {
    return {
      id: null,
      internalNumber: null,
      error: `Soma dos rateios (${allocSum}) difere do líquido (${net}).`,
    };
  }

  const { data: ap, error: apErr } = await supabase
    .from("accounts_payable")
    .insert({
      company_id: input.companyId,
      branch_id: input.branchId || null,
      internal_number: internalNumber,
      description: input.description.trim(),
      notes: input.notes || null,
      issue_date: input.issueDate || null,
      competence_date: input.competenceDate,
      entry_date: input.entryDate || input.competenceDate,
      supplier_id: input.supplierId || null,
      driver_id: input.driverId || null,
      partner_id: input.partnerId || null,
      client_id: input.clientId || null,
      company_payee_id: input.companyPayeeId || null,
      payee_name: input.payeeName?.trim() || null,
      chart_of_account_id: input.chartOfAccountId,
      original_amount: input.originalAmount,
      discount_amount: input.discountAmount ?? 0,
      addition_amount: input.additionAmount ?? 0,
      interest_amount: input.interestAmount ?? 0,
      penalty_amount: input.penaltyAmount ?? 0,
      net_amount: net,
      paid_amount: 0,
      open_balance: net,
      installment_count: installmentCount,
      status: "open",
      approval_status: "draft",
      source: "manual",
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (apErr || !ap) {
    return { id: null, internalNumber: null, error: apErr?.message || "Erro ao criar título." };
  }

  const payableId = String(ap.id);

  const { error: instErr } = await supabase.from("accounts_payable_installments").insert(
    installments.map((i) => ({
      company_id: input.companyId,
      accounts_payable_id: payableId,
      installment_no: i.installment_no,
      due_date: i.due_date,
      amount: i.amount,
      paid_amount: 0,
      open_balance: i.amount,
      status: "open",
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
    }))
  );
  if (instErr) {
    await supabase.from("accounts_payable").update({ deleted_at: new Date().toISOString() }).eq("id", payableId);
    return { id: null, internalNumber: null, error: instErr.message };
  }

  const { error: allocErr } = await supabase.from("accounts_payable_allocations").insert(
    allocations.map((a, idx) => ({
      company_id: input.companyId,
      accounts_payable_id: payableId,
      line_no: idx + 1,
      amount: a.amount,
      branch_id: a.branchId || null,
      vehicle_id: a.vehicleId || null,
      driver_id: a.driverId || null,
      service_order_id: a.serviceOrderId || null,
      chart_of_account_id: a.chartOfAccountId || null,
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
    }))
  );
  if (allocErr) {
    await supabase.from("accounts_payable").update({ deleted_at: new Date().toISOString() }).eq("id", payableId);
    return { id: null, internalNumber: null, error: allocErr.message };
  }

  return { id: payableId, internalNumber, error: null };
}

export async function submitAccountsPayable(
  supabase: SupabaseClient,
  payableId: string
): Promise<{ error: string | null; data?: unknown }> {
  const { data, error } = await supabase.rpc("submit_accounts_payable", {
    p_payable_id: payableId,
  });
  if (error) return { error: error.message };
  return { error: null, data };
}

export async function approveAccountsPayable(
  supabase: SupabaseClient,
  payableId: string,
  reviewNote?: string
): Promise<{ error: string | null; data?: unknown }> {
  const { data, error } = await supabase.rpc("approve_accounts_payable", {
    p_payable_id: payableId,
    p_review_note: reviewNote || null,
  });
  if (error) return { error: error.message };
  return { error: null, data };
}

export async function rejectAccountsPayable(
  supabase: SupabaseClient,
  payableId: string,
  reviewNote: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("reject_accounts_payable", {
    p_payable_id: payableId,
    p_review_note: reviewNote,
  });
  return { error: error?.message || null };
}

export async function registerApPayment(
  supabase: SupabaseClient,
  input: {
    installmentId: string;
    financialAccountId: string;
    paidAt: string;
    principalAmount: number;
    interestAmount?: number;
    penaltyAmount?: number;
    discountAmount?: number;
    paymentMethod?: string;
    bankRef?: string;
    notes?: string;
  }
): Promise<{ error: string | null; data?: unknown }> {
  const { data, error } = await supabase.rpc("register_accounts_payable_payment", {
    p_installment_id: input.installmentId,
    p_financial_account_id: input.financialAccountId,
    p_paid_at: input.paidAt,
    p_principal_amount: input.principalAmount,
    p_interest_amount: input.interestAmount ?? 0,
    p_penalty_amount: input.penaltyAmount ?? 0,
    p_discount_amount: input.discountAmount ?? 0,
    p_payment_method: input.paymentMethod || "Pix",
    p_bank_ref: input.bankRef || null,
    p_notes: input.notes || null,
  });
  if (error) return { error: error.message };
  return { error: null, data };
}

export async function reverseApPayment(
  supabase: SupabaseClient,
  paymentId: string,
  reason: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("reverse_accounts_payable_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  return { error: error?.message || null };
}

export async function cancelAccountsPayable(
  supabase: SupabaseClient,
  payableId: string,
  reason: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("cancel_accounts_payable", {
    p_payable_id: payableId,
    p_reason: reason,
  });
  return { error: error?.message || null };
}

export async function softDeleteAccountsPayable(
  supabase: SupabaseClient,
  companyId: string,
  payableId: string,
  reason: { code: string; detail: string },
  screenKey = "financeiro.contas-a-pagar"
): Promise<{ error: string | null }> {
  const detail = await fetchAccountsPayableDetail(supabase, companyId, payableId);
  if (detail.error || !detail.payable) return { error: detail.error || "Não encontrado" };

  const ap = detail.payable;
  const hasActivePay = detail.payments.some((p) => !p.reversed_at);

  if (hasActivePay) {
    return { error: "Título com pagamento ativo não pode ser excluído. Estorne antes." };
  }

  const isDraft = ap.approval_status === "draft";
  const isCancelled = ap.status === "cancelled";
  if (!isDraft && !isCancelled) {
    return { error: "Só é possível excluir rascunho ou título cancelado sem pagamento ativo." };
  }

  const { entityCode, summary } = summarizeDeletedRow(
    { ...ap, code: ap.internal_number } as unknown as Record<string, unknown>,
    "accounts_payable"
  );
  const { error: updErr } = await supabase.rpc("soft_delete_accounts_payable", {
    p_payable_id: payableId,
  });
  if (updErr) return { error: updErr.message };

  await recordDeletion({
    supabase,
    companyId,
    entityType: "accounts_payable",
    entityId: payableId,
    entityCode: entityCode || ap.internal_number,
    summary: summary || ap.description,
    deleteMode: "soft",
    reasonCode: reason.code as never,
    reason: reason.detail,
    screenKey,
    payload: {
      ...ap,
      installments: detail.installments,
      allocations: detail.allocations,
    } as unknown as Record<string, unknown>,
  });
  return { error: null };
}

export type ApKpis = {
  openTotal: number;
  overdueTotal: number;
  dueToday: number;
  dueWeek: number;
  dueMonth: number;
  paidMonth: number;
};

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchApKpis(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ kpis: ApKpis; error: string | null }> {
  const today = new Date();
  const isoToday = localIsoDate(today);
  const week = new Date(today);
  week.setDate(week.getDate() + 7);
  const isoWeek = localIsoDate(week);
  const day30 = new Date(today);
  day30.setDate(day30.getDate() + 30);
  const iso30 = localIsoDate(day30);
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const empty: ApKpis = {
    openTotal: 0,
    overdueTotal: 0,
    dueToday: 0,
    dueWeek: 0,
    dueMonth: 0,
    paidMonth: 0,
  };

  const { data: payables, error } = await supabase
    .from("accounts_payable")
    .select("id, open_balance, approval_status, status")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .eq("approval_status", "approved")
    .in("status", ["open", "partially_paid"]);

  if (error) {
    return { kpis: empty, error: error.message };
  }

  const ids = (payables || []).map((p) => String((p as { id: string }).id));
  let openTotal = 0;
  for (const p of payables || []) {
    openTotal += num((p as { open_balance: number }).open_balance);
  }

  let overdueTotal = 0;
  let dueToday = 0;
  let dueWeek = 0;
  let dueMonth = 0;

  if (ids.length > 0) {
    const { data: inst } = await supabase
      .from("accounts_payable_installments")
      .select("due_date, open_balance, status, accounts_payable_id")
      .in("accounts_payable_id", ids)
      .gt("open_balance", 0)
      .neq("status", "cancelled");

    for (const row of inst || []) {
      const r = row as { due_date: string; open_balance: number };
      const bal = num(r.open_balance);
      // Faixas exclusivas entre vencido / hoje / futuros.
      if (r.due_date < isoToday) {
        overdueTotal += bal;
      } else if (r.due_date === isoToday) {
        dueToday += bal;
      } else {
        if (r.due_date <= isoWeek) dueWeek += bal;
        if (r.due_date <= iso30) dueMonth += bal;
      }
    }
  }

  const { data: pays } = await supabase
    .from("accounts_payable_payments")
    .select("total_paid_amount")
    .eq("company_id", companyId)
    .is("reversed_at", null)
    .gte("paid_at", monthStart)
    .lte("paid_at", monthEnd);

  let paidMonth = 0;
  for (const p of pays || []) {
    paidMonth += num((p as { total_paid_amount: number }).total_paid_amount);
  }

  return {
    kpis: {
      openTotal: round2(openTotal),
      overdueTotal: round2(overdueTotal),
      dueToday: round2(dueToday),
      dueWeek: round2(dueWeek),
      dueMonth: round2(dueMonth),
      paidMonth: round2(paidMonth),
    },
    error: null,
  };
}

/** Contas a Pagar — domínio Fase 1 */

export type ApApprovalStatus = "draft" | "submitted" | "approved" | "rejected";
export type ApFinancialStatus =
  | "open"
  | "partially_paid"
  | "paid"
  | "suspended"
  | "cancelled";

export type ApInstallmentStatus = "open" | "partially_paid" | "paid" | "cancelled";

export type FinancialAccountType =
  | "checking"
  | "savings"
  | "cash"
  | "digital_wallet"
  | "payment_account"
  | "other";

export const FINANCIAL_ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Caixa",
  digital_wallet: "Carteira digital",
  payment_account: "Conta pagamento",
  other: "Outro",
};

export const AP_APPROVAL_LABELS: Record<ApApprovalStatus, string> = {
  draft: "Rascunho",
  submitted: "Pendente de aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
};

export const AP_STATUS_LABELS: Record<ApFinancialStatus, string> = {
  open: "Em aberto",
  partially_paid: "Parcialmente pago",
  paid: "Pago",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

export const AP_INSTALLMENT_STATUS_LABELS: Record<ApInstallmentStatus, string> = {
  open: "Em aberto",
  partially_paid: "Parcialmente pago",
  paid: "Pago",
  cancelled: "Cancelado",
};

export type CompanyFinancialAccount = {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  account_type: FinancialAccountType;
  bank_code: string | null;
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  pix_key: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  currency: string;
  is_active: boolean;
  deleted_at: string | null;
};

export type AccountsPayableRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  internal_number: string;
  description: string;
  competence_date: string;
  entry_date: string;
  issue_date: string | null;
  supplier_id: string | null;
  driver_id: string | null;
  partner_id: string | null;
  client_id: string | null;
  company_payee_id: string | null;
  payee_name: string | null;
  chart_of_account_id: string;
  original_amount: number;
  discount_amount: number;
  addition_amount: number;
  interest_amount: number;
  penalty_amount: number;
  net_amount: number;
  paid_amount: number;
  open_balance: number;
  installment_count: number;
  status: ApFinancialStatus;
  approval_status: ApApprovalStatus;
  notes: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
};

export type AccountsPayableInstallment = {
  id: string;
  company_id: string;
  accounts_payable_id: string;
  installment_no: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  open_balance: number;
  status: ApInstallmentStatus;
};

export type AccountsPayableAllocation = {
  id: string;
  company_id: string;
  accounts_payable_id: string;
  line_no: number;
  amount: number;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  service_order_id: string | null;
  chart_of_account_id: string | null;
  notes: string | null;
};

export type AccountsPayablePayment = {
  id: string;
  company_id: string;
  accounts_payable_id: string;
  installment_id: string;
  paid_at: string;
  principal_amount: number;
  interest_amount: number;
  penalty_amount: number;
  discount_amount: number;
  total_paid_amount: number;
  financial_account_id: string;
  payment_method: string;
  bank_ref: string | null;
  notes: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};

export type CreateApInput = {
  companyId: string;
  description: string;
  competenceDate: string;
  entryDate?: string;
  issueDate?: string | null;
  chartOfAccountId: string;
  originalAmount: number;
  discountAmount?: number;
  additionAmount?: number;
  interestAmount?: number;
  penaltyAmount?: number;
  branchId?: string | null;
  supplierId?: string | null;
  driverId?: string | null;
  partnerId?: string | null;
  clientId?: string | null;
  companyPayeeId?: string | null;
  payeeName?: string | null;
  notes?: string | null;
  installmentCount?: number;
  firstDueDate: string;
  /** Se omitido, cria 1 rateio 100% */
  allocations?: Array<{
    amount: number;
    branchId?: string | null;
    vehicleId?: string | null;
    driverId?: string | null;
    serviceOrderId?: string | null;
    chartOfAccountId?: string | null;
  }>;
};

export function calcNetAmount(input: {
  originalAmount: number;
  discountAmount?: number;
  additionAmount?: number;
  interestAmount?: number;
  penaltyAmount?: number;
}): number {
  const d = input.discountAmount ?? 0;
  const a = input.additionAmount ?? 0;
  const i = input.interestAmount ?? 0;
  const p = input.penaltyAmount ?? 0;
  return round2(input.originalAmount - d + a + i + p);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Divide total em N parcelas com ajuste na última. */
export function splitInstallments(
  total: number,
  count: number,
  firstDueDate: string
): Array<{ installment_no: number; due_date: string; amount: number }> {
  const n = Math.max(1, Math.floor(count));
  const base = round2(total / n);
  const parts: Array<{ installment_no: number; due_date: string; amount: number }> = [];
  let sum = 0;
  const start = parseIsoDate(firstDueDate);
  for (let i = 1; i <= n; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + (i - 1));
    const amount = i === n ? round2(total - sum) : base;
    sum = round2(sum + amount);
    parts.push({
      installment_no: i,
      due_date: toIsoDate(due),
      amount,
    });
  }
  return parts;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** overdue calculado — não persistido */
export function isApOverdue(params: {
  approvalStatus: ApApprovalStatus;
  status: ApFinancialStatus;
  installments: Array<{ due_date: string; open_balance: number; status: string }>;
  today?: string;
}): boolean {
  if (params.approvalStatus !== "approved") return false;
  if (params.status === "cancelled" || params.status === "paid" || params.status === "suspended") {
    return false;
  }
  const today = params.today ?? toIsoDate(new Date());
  return params.installments.some(
    (i) => i.status !== "cancelled" && i.open_balance > 0 && i.due_date < today
  );
}

export function payeeLabel(row: {
  payee_name?: string | null;
  supplier_name?: string | null;
  driver_name?: string | null;
  partner_name?: string | null;
  client_name?: string | null;
}): string {
  return (
    row.payee_name ||
    row.supplier_name ||
    row.driver_name ||
    row.partner_name ||
    row.client_name ||
    "—"
  );
}

import { isServiceOrderCompleted, type ServiceOrderStatusRow } from "@/lib/service-order-display-status";

export type ServiceOrderReceivablePaymentView = {
  payment_id: string;
  amount: string;
  currency_code: string;
  status: string;
  reference_code: string | null;
};

export type ServiceOrderReceivableBody = {
  receivable_id: string;
  currency_code: string;
  original_amount: string;
  posted_amount: string;
  balance: string;
  status: string;
  reference_code: string | null;
  due_on?: string | null;
};

export type ServiceOrderReceivableView = {
  receivable: ServiceOrderReceivableBody;
  payments: ServiceOrderReceivablePaymentView[];
};

export const NO_RECEIVABLE_PAYMENTS_LABEL = "Nenhum pagamento registrado.";
export const RECEIVABLE_DUE_ABSENT_LABEL = "sem vencimento";

export function serviceOrderShowsFinanceAction(row: { status: string | null }): boolean {
  return isServiceOrderCompleted(row as ServiceOrderStatusRow);
}

export function formatReceivableAmount(amount: string, currencyCode: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  const currency = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "BRL";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}

export function receivableStatusLabel(status: string): string {
  const key = status.trim().toLowerCase();
  if (key === "paid") return "Pago";
  if (key === "open") return "Em aberto";
  if (key === "partial" || key === "partially_paid") return "Parcial";
  if (!/^[\p{L}\p{N}_. -]{1,40}$/u.test(status.trim())) return "—";
  return status.trim();
}

export function paymentStatusLabel(status: string): string {
  if (status.trim().toLowerCase() === "posted") return "Posted";
  return receivableStatusLabel(status);
}

export function receivableDueLabel(dueOn: string | null | undefined): string {
  if (dueOn == null || dueOn.trim() === "") return RECEIVABLE_DUE_ABSENT_LABEL;
  const datePart = dueOn.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dueOn;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

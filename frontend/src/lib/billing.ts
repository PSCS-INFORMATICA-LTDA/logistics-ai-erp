import type { CompanyBillingSettings } from "@/types/database";

export const DEFAULT_TEST_AMOUNT = 1;
export const DEFAULT_MONTHLY_AMOUNT = 800;

export function resolveChargeAmount(settings: Pick<
  CompanyBillingSettings,
  "charge_mode" | "test_amount" | "monthly_amount"
>): number {
  const raw =
    settings.charge_mode === "production" ? settings.monthly_amount : settings.test_amount;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0.01 ? value : DEFAULT_TEST_AMOUNT;
}

export function nextBillingDueDate(billingDay: number, from = new Date()): string {
  const day = Math.min(Math.max(Math.trunc(billingDay) || 10, 1), 28);
  const year = from.getFullYear();
  const month = from.getMonth();
  let due = new Date(year, month, day);
  // Se o dia do mês já passou (ou é hoje após cobrança), agenda no próximo ciclo
  const today = new Date(year, month, from.getDate());
  if (due <= today) {
    due = new Date(year, month + 1, day);
  }
  const yyyy = due.getFullYear();
  const mm = String(due.getMonth() + 1).padStart(2, "0");
  const dd = String(due.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  inactive: "Inativa",
  pending: "Pendente",
  active: "Ativa",
  overdue: "Em atraso",
  canceled: "Cancelada",
  error: "Erro",
};

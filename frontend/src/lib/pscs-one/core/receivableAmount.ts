/**
 * Valor comercial cobrado do cliente.
 * Frete: freight_agreed_amount (contrato fechado da OS).
 * Transporte: service_amount (valor do serviço nesse tipo).
 * Tipos legados não têm regra nesta wave.
 */

export type ServiceOrderReceivableAmountInput = {
  service_type: string | null | undefined;
  freight_agreed_amount?: number | string | null;
  service_amount?: number | string | null;
};

export type ServiceOrderReceivableAmount =
  | { ok: true; amount: string; source: "freight_agreed_amount" | "service_amount" }
  | { ok: false; code: "COMMERCIAL_AMOUNT_INVALID" | "COMMERCIAL_AMOUNT_UNSUPPORTED" };

const SUPPORTED_FREIGHT = "Frete";
const SUPPORTED_TRANSPORT = "Transporte";

function parsePositiveAmount(value: number | string | null | undefined): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6) return null;
    return (cents / 100).toFixed(2);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric.toFixed(2);
}

export function resolveServiceOrderReceivableAmount(
  order: ServiceOrderReceivableAmountInput,
): ServiceOrderReceivableAmount {
  if (order.service_type === SUPPORTED_FREIGHT) {
    const amount = parsePositiveAmount(order.freight_agreed_amount);
    if (!amount) return { ok: false, code: "COMMERCIAL_AMOUNT_INVALID" };
    return { ok: true, amount, source: "freight_agreed_amount" };
  }
  if (order.service_type === SUPPORTED_TRANSPORT) {
    const amount = parsePositiveAmount(order.service_amount);
    if (!amount) return { ok: false, code: "COMMERCIAL_AMOUNT_INVALID" };
    return { ok: true, amount, source: "service_amount" };
  }
  return { ok: false, code: "COMMERCIAL_AMOUNT_UNSUPPORTED" };
}

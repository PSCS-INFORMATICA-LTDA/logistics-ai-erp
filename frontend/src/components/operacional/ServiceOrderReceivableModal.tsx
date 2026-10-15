"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { glassAction } from "@/lib/liquid-glass-styles";
import {
  NO_RECEIVABLE_PAYMENTS_LABEL,
  formatReceivableAmount,
  paymentStatusLabel,
  receivableDueLabel,
  receivableStatusLabel,
  type ServiceOrderReceivableView,
} from "@/lib/pscs-one/core/receivablePresentation";

type Props = {
  open: boolean;
  serviceOrderId: string;
  serviceOrderCode: string;
  onClose: () => void;
};

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; view: ServiceOrderReceivableView }
  | { phase: "error"; message: string };

const ERROR_BY_CODE: Record<string, string> = {
  core_session_missing: "Sessão do PSCS One ausente. Entre novamente pelo SSO para ver o financeiro.",
  core_session_invalid: "Sessão do PSCS One expirada. Entre novamente pelo SSO.",
  core_unauthenticated: "É preciso estar autenticado no Logistics para ver o financeiro.",
  core_unauthorized: "Você não tem acesso ao financeiro desta empresa.",
  tenant_mapping_missing: "Empresa sem vínculo com o PSCS One. Entre novamente pelo SSO.",
  AR_RECONCILIATION_REQUIRED:
    "Esta OS concluída não tem recebível correspondente no PSCS One. Nada foi criado.",
  core_unavailable: "Não foi possível consultar o PSCS One agora.",
  core_unconfigured: "A consulta ao PSCS One não está configurada neste ambiente.",
};

function messageFor(code: string | undefined): string {
  if (code && ERROR_BY_CODE[code]) return ERROR_BY_CODE[code];
  return "Não foi possível consultar o financeiro.";
}

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export function ServiceOrderReceivableModal({
  open,
  serviceOrderId,
  serviceOrderCode,
  onClose,
}: Props) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/service-orders/${serviceOrderId}/receivable`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          receivable?: ServiceOrderReceivableView["receivable"];
          payments?: ServiceOrderReceivableView["payments"];
          error?: { code?: string };
        };
        if (!response.ok || payload.ok !== true || !payload.receivable || !payload.payments) {
          setState({ phase: "error", message: messageFor(payload.error?.code) });
          return;
        }
        setState({
          phase: "ready",
          view: { receivable: payload.receivable, payments: payload.payments },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ phase: "error", message: messageFor("core_unavailable") });
      }
    })();
    return () => controller.abort();
  }, [open, serviceOrderId]);

  if (!open || typeof document === "undefined") return null;

  const view = state.phase === "ready" ? state.view : null;
  const receivable = view?.receivable;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-order-finance-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h2 id="service-order-finance-title" className="text-base font-semibold text-slate-900">
            PSCS One • Financeiro
          </h2>
          <p className="mt-1 text-xs text-slate-500">OS {serviceOrderCode}</p>
        </div>
        <div className="px-4 py-4 sm:px-5">
          {state.phase === "loading" ? (
            <p className="text-sm text-slate-600">Consultando o PSCS One…</p>
          ) : null}
          {state.phase === "error" ? (
            <p className="text-sm text-slate-700">{state.message}</p>
          ) : null}
          {receivable && view ? (
            <>
              <dl>
                <AmountRow
                  label="Valor do cliente"
                  value={formatReceivableAmount(receivable.original_amount, receivable.currency_code)}
                />
                <AmountRow
                  label="Pago"
                  value={formatReceivableAmount(receivable.posted_amount, receivable.currency_code)}
                />
                <AmountRow
                  label="Saldo"
                  value={formatReceivableAmount(receivable.balance, receivable.currency_code)}
                />
                <AmountRow label="Status" value={receivableStatusLabel(receivable.status)} />
                <AmountRow label="Vencimento" value={receivableDueLabel(receivable.due_on)} />
              </dl>
              {receivable.reference_code ? (
                <p className="mt-3 text-xs text-slate-400">Ref. {receivable.reference_code}</p>
              ) : null}
              <h3 className="mt-4 text-sm font-medium text-slate-800">Pagamentos</h3>
              {view.payments.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">{NO_RECEIVABLE_PAYMENTS_LABEL}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {view.payments.map((payment) => (
                    <li key={payment.payment_id} className="text-sm text-slate-800">
                      <span>
                        {formatReceivableAmount(payment.amount, payment.currency_code)} —{" "}
                        {paymentStatusLabel(payment.status)}
                      </span>
                      {payment.reference_code ? (
                        <span className="mt-0.5 block text-xs text-slate-400">{payment.reference_code}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <button type="button" className={glassAction("neutral", true)} onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

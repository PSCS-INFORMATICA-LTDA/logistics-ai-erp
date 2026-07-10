"use client";

import { useMemo, useState } from "react";
import { DriverPaymentProofUpload } from "@/components/motoristas/DriverPaymentProofUpload";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  driverPaymentTotal,
  filterDriverPaymentRows,
  formatDriverPayAmount,
  markDriverPaymentPaid,
  type DriverPaymentFilter,
  type DriverPaymentRow,
} from "@/lib/driver-payments-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/utils";

function formatDate(value: string): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function BankingCell({ value }: { value: string | null }) {
  return <span className="font-medium text-slate-900">{value?.trim() || "—"}</span>;
}

type Props = {
  companyId: string;
  supabase: SupabaseClient;
  rows: DriverPaymentRow[];
  filter?: DriverPaymentFilter;
  showFilterTabs?: boolean;
  onFilterChange?: (filter: DriverPaymentFilter) => void;
  onRowsChange?: (rows: DriverPaymentRow[]) => void;
  emptyMessage?: string;
  /** Tela de acompanhamento: foco em motorista + dados bancários, sem links externos. */
  layout?: "table" | "banking";
};

export function DriverPaymentsTable({
  companyId,
  supabase,
  rows,
  filter = "all",
  showFilterTabs = false,
  onFilterChange,
  onRowsChange,
  emptyMessage = "Nenhum pagamento encontrado.",
  layout = "table",
}: Props) {
  const [markingId, setMarkingId] = useState<string | null>(null);

  const visibleRows = useMemo(() => filterDriverPaymentRows(rows, filter), [rows, filter]);

  const handleMarkPaid = async (row: DriverPaymentRow) => {
    if (!row.driver_assignment_pay_amount || row.driver_assignment_pay_amount <= 0) {
      window.alert(
        `OS ${row.code} não possui valor de pagamento registrado no sistema. Redesigne o motorista informando os valores.`
      );
      return;
    }

    if (
      !window.confirm(
        `Registrar pagamento de ${formatCurrency(driverPaymentTotal(row))} ao motorista ${row.driver_name} (OS ${row.code})?`
      )
    ) {
      return;
    }

    setMarkingId(row.id);
    const { paidAt, error: markError } = await markDriverPaymentPaid(supabase, row.id);
    setMarkingId(null);

    if (markError) {
      window.alert(markError);
      return;
    }

    onRowsChange?.(
      rows.map((item) =>
        item.id === row.id ? { ...item, driver_payment_paid_at: paidAt ?? new Date().toISOString() } : item
      )
    );
  };

  if (visibleRows.length === 0) {
    return (
      <div className="space-y-4">
        {showFilterTabs && onFilterChange ? (
          <FilterTabs filter={filter} onFilterChange={onFilterChange} />
        ) : null}
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  if (layout === "banking") {
    return (
      <div className="space-y-4">
        {showFilterTabs && onFilterChange ? (
          <FilterTabs filter={filter} onFilterChange={onFilterChange} />
        ) : null}
        <div className="space-y-4">
          {visibleRows.map((row) => {
            const paid = Boolean(row.driver_payment_paid_at);
            const canMarkPaid = !paid && (row.driver_assignment_pay_amount ?? 0) > 0;

            return (
              <article
                key={row.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                      Ordem de serviço
                    </p>
                    <h3 className="text-xl font-bold text-slate-900">{row.code}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {row.driver_code} — <strong>{row.driver_name}</strong>
                    </p>
                    <p className="text-xs text-slate-500">Data: {formatDate(row.service_date)}</p>
                  </div>
                  <div className="text-right">
                    {paid ? <Badge variant="success">Pago</Badge> : <Badge variant="warning">Pendente</Badge>}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Valor motorista</p>
                    <p className="font-semibold text-slate-900">
                      {formatDriverPayAmount(row.driver_assignment_pay_amount)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Valor ajudante</p>
                    <p className="font-semibold text-slate-900">
                      {formatDriverPayAmount(row.driver_assignment_assistant_pay_amount)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-brand-50 p-3">
                    <p className="text-xs text-brand-700">Total a pagar</p>
                    <p className="font-semibold text-brand-900">
                      {driverPaymentTotal(row) > 0 ? formatCurrency(driverPaymentTotal(row)) : "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Dados bancários para pagamento
                  </p>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">Chave Pix</dt>
                      <dd className="font-medium text-slate-900">{row.pix_key?.trim() || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Banco</dt>
                      <dd className="font-medium text-slate-900">{row.bank_code?.trim() || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Agência</dt>
                      <dd className="font-medium text-slate-900">{row.bank_agency?.trim() || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Conta corrente</dt>
                      <dd className="font-medium text-slate-900">{row.bank_account?.trim() || "—"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <DriverPaymentProofUpload
                    companyId={companyId}
                    orderId={row.id}
                    orderCode={row.code}
                    proofCount={row.payment_proof_count}
                    onUploaded={() =>
                      onRowsChange?.(
                        rows.map((item) =>
                          item.id === row.id
                            ? { ...item, payment_proof_count: item.payment_proof_count + 1 }
                            : item
                        )
                      )
                    }
                  />
                  {canMarkPaid ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={markingId === row.id}
                      onClick={() => void handleMarkPaid(row)}
                    >
                      {markingId === row.id ? "Registrando…" : "Marcar pago"}
                    </Button>
                  ) : paid ? (
                    <span className="text-xs text-slate-500">
                      Pago em{" "}
                      {row.driver_payment_paid_at
                        ? new Date(row.driver_payment_paid_at).toLocaleString("pt-BR")
                        : "—"}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilterTabs && onFilterChange ? (
        <FilterTabs filter={filter} onFilterChange={onFilterChange} />
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="px-3 py-2 font-medium">OS</th>
              <th className="px-3 py-2 font-medium">Status OS</th>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Motorista</th>
              <th className="px-3 py-2 font-medium">Motorista (R$)</th>
              <th className="px-3 py-2 font-medium">Ajudante (R$)</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Chave Pix</th>
              <th className="px-3 py-2 font-medium">Banco</th>
              <th className="px-3 py-2 font-medium">Agência</th>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 font-medium">Comprovante</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const paid = Boolean(row.driver_payment_paid_at);
              const canMarkPaid = !paid && (row.driver_assignment_pay_amount ?? 0) > 0;

              return (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{row.code}</td>
                  <td className="px-3 py-2">
                    {row.status === "Concluido" ? (
                      <span className="font-medium text-green-700">Concluído</span>
                    ) : (
                      <span className="text-slate-600">Motorista confirmado</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDate(row.service_date)}</td>
                  <td className="px-3 py-2">
                    {row.driver_code} — {row.driver_name}
                  </td>
                  <td className="px-3 py-2">{formatDriverPayAmount(row.driver_assignment_pay_amount)}</td>
                  <td className="px-3 py-2">
                    {formatDriverPayAmount(row.driver_assignment_assistant_pay_amount)}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {driverPaymentTotal(row) > 0 ? formatCurrency(driverPaymentTotal(row)) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <BankingCell value={row.pix_key} />
                  </td>
                  <td className="px-3 py-2">
                    <BankingCell value={row.bank_code} />
                  </td>
                  <td className="px-3 py-2">
                    <BankingCell value={row.bank_agency} />
                  </td>
                  <td className="px-3 py-2">
                    <BankingCell value={row.bank_account} />
                  </td>
                  <td className="px-3 py-2">
                    <DriverPaymentProofUpload
                      companyId={companyId}
                      orderId={row.id}
                      orderCode={row.code}
                      proofCount={row.payment_proof_count}
                      onUploaded={() =>
                        onRowsChange?.(
                          rows.map((item) =>
                            item.id === row.id
                              ? { ...item, payment_proof_count: item.payment_proof_count + 1 }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    {paid ? <Badge variant="success">Pago</Badge> : <Badge variant="warning">Pendente</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    {canMarkPaid ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={markingId === row.id}
                        onClick={() => void handleMarkPaid(row)}
                      >
                        {markingId === row.id ? "Registrando…" : "Marcar pago"}
                      </Button>
                    ) : paid ? (
                      <span className="text-xs text-slate-500">
                        {row.driver_payment_paid_at
                          ? new Date(row.driver_payment_paid_at).toLocaleString("pt-BR")
                          : "—"}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700">Sem valor</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterTabs({
  filter,
  onFilterChange,
}: {
  filter: DriverPaymentFilter;
  onFilterChange: (filter: DriverPaymentFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["pending", "Pendentes"],
          ["paid", "Pagos"],
          ["all", "Todos"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onFilterChange(value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === value
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

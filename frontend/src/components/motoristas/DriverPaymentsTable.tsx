"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DriverPaymentProofUpload } from "@/components/motoristas/DriverPaymentProofUpload";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  driverPaymentTotal,
  filterDriverPaymentRows,
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

type Props = {
  companyId: string;
  supabase: SupabaseClient;
  rows: DriverPaymentRow[];
  filter?: DriverPaymentFilter;
  showFilterTabs?: boolean;
  onFilterChange?: (filter: DriverPaymentFilter) => void;
  onRowsChange?: (rows: DriverPaymentRow[]) => void;
  emptyMessage?: string;
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
}: Props) {
  const [markingId, setMarkingId] = useState<string | null>(null);

  const visibleRows = useMemo(() => filterDriverPaymentRows(rows, filter), [rows, filter]);

  const handleMarkPaid = async (row: DriverPaymentRow) => {
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

  return (
    <div className="space-y-4">
      {showFilterTabs && onFilterChange ? (
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
      ) : null}

      {visibleRows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : (
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
                    <td className="px-3 py-2">{formatCurrency(row.driver_assignment_pay_amount)}</td>
                    <td className="px-3 py-2">
                      {row.driver_assignment_assistant_pay_amount
                        ? formatCurrency(row.driver_assignment_assistant_pay_amount)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(driverPaymentTotal(row))}</td>
                    <td className="px-3 py-2">
                      {row.pix_key ?? (
                        <Link href="/cadastros/motoristas" className="text-xs text-brand-700 hover:underline">
                          Cadastrar Pix
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.bank_code ?? "—"}</td>
                    <td className="px-3 py-2">{row.bank_agency ?? "—"}</td>
                    <td className="px-3 py-2">{row.bank_account ?? "—"}</td>
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
                      {paid ? (
                        <Badge variant="success">Pago</Badge>
                      ) : (
                        <Badge variant="warning">Pendente</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!paid ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={markingId === row.id}
                          onClick={() => void handleMarkPaid(row)}
                        >
                          {markingId === row.id ? "Registrando…" : "Marcar pago"}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {row.driver_payment_paid_at
                            ? new Date(row.driver_payment_paid_at).toLocaleString("pt-BR")
                            : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

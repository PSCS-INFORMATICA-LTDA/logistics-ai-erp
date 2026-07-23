"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DriverPaymentsTable } from "@/components/motoristas/DriverPaymentsTable";
import { Alert, Loading } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { fetchDreDriverExpenses } from "@/lib/dre-driver-expenses-api";
import {
  fetchDriverPaymentRows,
  filterLegacyManualDriverExpenseRows,
  summarizeDriverPayments,
} from "@/lib/driver-payments-api";
import { companyLedgerDriverExpenseHref } from "@/lib/legacy-driver-expense";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { glassAction, glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";

function formatDate(value: string): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export default function DreDespesasMotoristaPage() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("dre.despesas-motorista");
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchDreDriverExpenses>>["rows"]>([]);
  const [allPayments, setAllPayments] = useState<
    Awaited<ReturnType<typeof fetchDriverPaymentRows>>["rows"]
  >([]);
  const [paymentsWarning, setPaymentsWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    motoristaTotal: 0,
    ajudanteTotal: 0,
    combinedTotal: 0,
  });

  const pendingPayments = useMemo(
    () =>
      allPayments.filter(
        (row) => !row.driver_payment_paid_at && !row.needs_manual_company_expense
      ),
    [allPayments]
  );

  const legacyManualPayments = useMemo(
    () => filterLegacyManualDriverExpenseRows(allPayments),
    [allPayments]
  );

  const pendingSummary = useMemo(() => summarizeDriverPayments(pendingPayments), [pendingPayments]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setPaymentsWarning(null);

    const [dreResult, paymentsResult] = await Promise.all([
      fetchDreDriverExpenses(supabase, companyId, { year, month }),
      fetchDriverPaymentRows(supabase, companyId),
    ]);

    if (dreResult.error) {
      setError(dreResult.error);
      setRows([]);
      setSummary({ motoristaTotal: 0, ajudanteTotal: 0, combinedTotal: 0 });
    } else {
      setRows(dreResult.rows);
      setSummary(dreResult.summary);
    }

    setAllPayments(paymentsResult.rows);
    setPaymentsWarning(paymentsResult.schemaWarning);
    setLoading(false);
  }, [companyId, month, supabase, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [month, year]
  );

  return (
    <Card>
      <CardHeader
        title="Despesas Motorista / Ajudante"
        description="Após concluir o frete, a OS entra aqui com valores e dados bancários do motorista. Anexe o comprovante, marque pago e o lançamento DRE é gerado automaticamente. OS importadas sem valor: lançamento manual no DRE da empresa (conta Motorista/Ajudante)."
      />
      <CardBody className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Mês (lançamentos pagos)</span>
            <input
              type="month"
              className={glassField()}
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={(event) => {
                const [y, m] = event.target.value.split("-");
                if (y && m) {
                  setYear(Number(y));
                  setMonth(Number(m));
                }
              }}
            />
          </label>
          <p className="text-sm text-slate-500">
            Período DRE: <strong className="capitalize text-slate-700">{monthLabel}</strong>
          </p>
          <Link href="/cadastros/contas-dre" className={glassAction("brand", true)}>
            Contas DRE
          </Link>
          <Link href="/dre/lancamentos?legacyPay=1&account=motorista" className={glassAction("amber", true)}>
            Lançamentos da empresa
          </Link>
          <Link href="/cadastros/motoristas/pagamentos" className={glassAction("brand", true)}>
            Acompanhamento de pagamentos
          </Link>
        </div>

        {legacyManualPayments.length > 0 ? (
          <section className={`space-y-3 p-4 ${glassFilterPanel()}`}>
            <Alert variant="info">
              <strong>{legacyManualPayments.length}</strong> OS legado/importada sem valor de
              motorista/ajudante na designação. Autorizado lançar em{" "}
              <strong>DRE → Lançamentos da empresa</strong> (conta Motorista ou Ajudante).{" "}
              <strong>Informe sempre o nº da OS</strong> — sem isso o rateio por sócios (quadro de
              participações) não aloca a despesa.
            </Alert>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-3 py-2 font-medium">OS</th>
                    <th className="px-3 py-2 font-medium">Nº legado</th>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Motorista</th>
                    <th className="px-3 py-2 font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {legacyManualPayments.slice(0, 40).map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-medium">{row.code}</td>
                      <td className="px-3 py-2">{row.legacy_number || "—"}</td>
                      <td className="px-3 py-2">{formatDate(row.service_date)}</td>
                      <td className="px-3 py-2">
                        {row.driver_code} — {row.driver_name}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={companyLedgerDriverExpenseHref({
                            orderId: row.id,
                            code: row.code,
                            legacyNumber: row.legacy_number,
                            serviceDate: row.service_date,
                            driverName: row.driver_name,
                            account: "motorista",
                          })}
                          className={glassAction("amber", true)}
                        >
                          Lançar no DRE empresa
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {legacyManualPayments.length > 40 ? (
              <p className="text-xs text-slate-500">
                Mostrando 40 de {legacyManualPayments.length}. Use o atalho na OS ou filtre em
                Lançamentos da empresa.
              </p>
            ) : null}
          </section>
        ) : null}

        {paymentsWarning ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {paymentsWarning}
          </div>
        ) : null}

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Valores a pagar (pendentes)</h2>
            <p className="text-xs text-slate-600">
              Inclui OS com motorista confirmado ou frete concluído — aguardando pagamento ao motorista/ajudante.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={glassStatCard("amber")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Motorista (a pagar)</p>
              <p className="mt-1 text-2xl font-semibold text-amber-950">
                {formatCurrency(pendingSummary.motoristaTotal)}
              </p>
            </div>
            <div className={glassStatCard("amber")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Ajudante (a pagar)</p>
              <p className="mt-1 text-2xl font-semibold text-amber-950">
                {formatCurrency(pendingSummary.ajudanteTotal)}
              </p>
            </div>
            <div className={glassStatCard("brand")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Total (a pagar)</p>
              <p className="mt-1 text-2xl font-semibold text-brand-950">
                {formatCurrency(pendingSummary.combinedTotal)}
              </p>
            </div>
          </div>
        </section>

        <section className={`space-y-3 p-4 ${glassFilterPanel()}`}>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Pagamentos pendentes — OS e dados bancários</h2>
            <p className="text-xs text-slate-600">
              Rafael: use Pix, banco, agência e conta para pagar. Clique no clipe para anexar o comprovante e depois
              «Marcar pago».
            </p>
          </div>
          {loading ? (
            <Loading />
          ) : (
            <DriverPaymentsTable
              companyId={companyId ?? ""}
              supabase={supabase}
              rows={pendingPayments}
              filter="all"
              canEdit={canEdit}
              onRowsChange={(next) => {
                setAllPayments((current) => {
                  const paidIds = new Set(
                    current.filter((row) => row.driver_payment_paid_at).map((row) => row.id)
                  );
                  const merged = [...current.filter((row) => paidIds.has(row.id)), ...next];
                  return merged;
                });
                void load();
              }}
              emptyMessage="Nenhum pagamento pendente. Conclua o frete na OS e aguarde a designação confirmada com valores informados."
            />
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Lançado no DRE (pagos no período)</h2>
            <p className="text-xs text-slate-600">Despesas já registradas nas contas «Motorista» e «Ajudante».</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={glassStatCard("slate")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motorista</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {formatCurrency(summary.motoristaTotal)}
              </p>
            </div>
            <div className={glassStatCard("slate")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ajudante</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {formatCurrency(summary.ajudanteTotal)}
              </p>
            </div>
            <div className={glassStatCard("green")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-green-800">Total pago</p>
              <p className="mt-1 text-2xl font-semibold text-green-950">
                {formatCurrency(summary.combinedTotal)}
              </p>
            </div>
          </div>

          {loading ? (
            <Loading />
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p>{error}</p>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum lançamento pago neste período. Marque um pagamento como pago na tabela acima.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Conta DRE</th>
                    <th className="px-3 py-2 font-medium">OS</th>
                    <th className="px-3 py-2 font-medium">Motorista</th>
                    <th className="px-3 py-2 font-medium">Pix</th>
                    <th className="px-3 py-2 font-medium">Banco</th>
                    <th className="px-3 py-2 font-medium">Agência</th>
                    <th className="px-3 py-2 font-medium">Conta</th>
                    <th className="px-3 py-2 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{formatDate(row.transaction_date)}</td>
                      <td className="px-3 py-2 font-medium">{row.dre_account_name}</td>
                      <td className="px-3 py-2 font-medium">{row.service_order_code ?? "—"}</td>
                      <td className="px-3 py-2">
                        {row.driver_code && row.driver_name
                          ? `${row.driver_code} — ${row.driver_name}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{row.pix_key ?? "—"}</td>
                      <td className="px-3 py-2">{row.bank_code ?? "—"}</td>
                      <td className="px-3 py-2">{row.bank_agency ?? "—"}</td>
                      <td className="px-3 py-2">{row.bank_account ?? "—"}</td>
                      <td className="px-3 py-2 font-medium">{formatCurrency(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

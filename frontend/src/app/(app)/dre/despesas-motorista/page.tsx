"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DriverPaymentsTable } from "@/components/motoristas/DriverPaymentsTable";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { fetchDreDriverExpenses } from "@/lib/dre-driver-expenses-api";
import {
  fetchDriverPaymentRows,
  filterLegacyManualDriverExpenseRows,
  summarizeDriverPayments,
  type DriverPaymentRow,
} from "@/lib/driver-payments-api";
import {
  fetchExistingDriverAssistantExpenses,
  hasLaunchedKind,
  launchedAmount,
  launchLegacyDriverAssistantInline,
  type ExistingDriverAssistantExpense,
} from "@/lib/legacy-driver-inline-launch";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { groupByKeySorted } from "@/lib/table-row-groups";
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
  const [legacyExistingByOrder, setLegacyExistingByOrder] = useState<
    Map<string, ExistingDriverAssistantExpense[]>
  >(() => new Map());
  const [legacyDrafts, setLegacyDrafts] = useState<
    Record<string, { motorista: string; ajudante: string }>
  >({});
  const [legacyBusyId, setLegacyBusyId] = useState<string | null>(null);
  const [legacyMsg, setLegacyMsg] = useState<string | null>(null);

  const pendingPayments = useMemo(
    () =>
      allPayments.filter(
        (row) => !row.driver_payment_paid_at && !row.needs_manual_company_expense
      ),
    [allPayments]
  );

  const legacyManualPayments = useMemo(() => {
    const base = filterLegacyManualDriverExpenseRows(allPayments);
    // Mantém na lista se ainda falta Motorista ou Ajudante no DRE.
    return base.filter((row) => {
      const existing = legacyExistingByOrder.get(row.id);
      const mot = hasLaunchedKind(existing, "motorista");
      const aj = hasLaunchedKind(existing, "ajudante");
      return !(mot && aj);
    });
  }, [allPayments, legacyExistingByOrder]);

  const pendingSummary = useMemo(() => summarizeDriverPayments(pendingPayments), [pendingPayments]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setPaymentsWarning(null);
    setLegacyMsg(null);

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

    const legacyIds = filterLegacyManualDriverExpenseRows(paymentsResult.rows).map((r) => r.id);
    if (legacyIds.length) {
      const existing = await fetchExistingDriverAssistantExpenses(supabase, companyId, legacyIds);
      if (!existing.error) setLegacyExistingByOrder(existing.byOrder);
      else setLegacyExistingByOrder(new Map());
    } else {
      setLegacyExistingByOrder(new Map());
    }

    setLoading(false);
  }, [companyId, month, supabase, year]);

  const updateLegacyDraft = (orderId: string, field: "motorista" | "ajudante", value: string) => {
    setLegacyDrafts((prev) => ({
      ...prev,
      [orderId]: {
        motorista: field === "motorista" ? value : prev[orderId]?.motorista ?? "",
        ajudante: field === "ajudante" ? value : prev[orderId]?.ajudante ?? "",
      },
    }));
  };

  const launchLegacyRow = async (row: DriverPaymentRow) => {
    if (!companyId || !canEdit) return;
    const draft = legacyDrafts[row.id] ?? { motorista: "", ajudante: "" };
    setLegacyBusyId(row.id);
    setError(null);
    setLegacyMsg(null);

    const result = await launchLegacyDriverAssistantInline({
      supabase,
      companyId,
      orderId: row.id,
      orderCode: row.code,
      legacyNumber: row.legacy_number,
      serviceDate: row.service_date,
      driverName: row.driver_name,
      motoristaAmount: draft.motorista,
      ajudanteAmount: draft.ajudante,
    });

    setLegacyBusyId(null);

    if (result.error && !result.launched.length) {
      setError(result.error);
      return;
    }

    const parts: string[] = [];
    if (result.launched.includes("motorista")) parts.push("Motorista");
    if (result.launched.includes("ajudante")) parts.push("Ajudante");
    const skipNotes = result.skipped.map((s) => s.reason).join(" ");
    setLegacyMsg(
      [
        parts.length ? `OS ${row.code}: lançado ${parts.join(" e ")} no DRE.` : null,
        skipNotes || null,
      ]
        .filter(Boolean)
        .join(" ")
    );

    setLegacyDrafts((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [month, year]
  );

  const paidDreGroups = useMemo(
    () =>
      groupByKeySorted(rows, (row) => row.service_order_code, (a, b) =>
        a.dre_account_name.localeCompare(b.dre_account_name, "pt-BR")
      ),
    [rows]
  );

  return (
    <Card>
      <CardHeader
        title="Despesas Motorista / Ajudante"
        description="OS concluída: anexe o comprovante, marque pago e o DRE é gerado. OS legado: informe os valores no cartão e lance no DRE."
      />
      <CardBody className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
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
          <p className="text-sm text-slate-500 sm:pb-2">
            Período DRE: <strong className="capitalize text-slate-700">{monthLabel}</strong>
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/cadastros/contas-dre" className={`text-center ${glassAction("brand", true)}`}>
            Contas DRE
          </Link>
          <Link
            href="/dre/lancamentos?legacyPay=1&account=motorista"
            className={`text-center ${glassAction("amber", true)}`}
          >
            Lançamentos da empresa
          </Link>
          <Link
            href="/cadastros/motoristas/pagamentos"
            className={`text-center ${glassAction("brand", true)}`}
          >
            Acompanhamento de pagamentos
          </Link>
        </div>

        {legacyMsg ? <Alert variant="info">{legacyMsg}</Alert> : null}

        {legacyManualPayments.length > 0 ? (
          <section className={`space-y-3 p-4 ${glassFilterPanel()}`}>
            <Alert variant="info">
              <strong>{legacyManualPayments.length}</strong> OS legado sem valor na designação.
              Informe os valores e clique em <strong>Lançar no DRE</strong> (duplicata bloqueada).
            </Alert>

            {/* Mobile: cartão por OS legado. */}
            <ul className="space-y-3 md:hidden">
              {legacyManualPayments.slice(0, 40).map((row) => {
                const existing = legacyExistingByOrder.get(row.id);
                const motDone = hasLaunchedKind(existing, "motorista");
                const ajDone = hasLaunchedKind(existing, "ajudante");
                const draft = legacyDrafts[row.id] ?? { motorista: "", ajudante: "" };
                const busy = legacyBusyId === row.id;
                return (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        OS {row.code}
                        {row.legacy_number ? ` · Legado ${row.legacy_number}` : ""}
                      </p>
                      <p className="text-base font-semibold leading-snug break-words text-slate-900">
                        {row.driver_code} — {row.driver_name}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Data: {formatDate(row.service_date)}
                      </p>
                    </div>

                    <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3">
                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-medium text-slate-500">Valor motorista</span>
                        {motDone ? (
                          <p className="font-medium text-emerald-800">
                            Lançado
                            {launchedAmount(existing, "motorista") != null
                              ? ` · ${formatCurrency(launchedAmount(existing, "motorista")!)}`
                              : ""}
                          </p>
                        ) : (
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            className={`${glassField(true)} w-full`}
                            placeholder="R$ 0,00"
                            value={draft.motorista}
                            disabled={!canEdit || busy}
                            onChange={(e) =>
                              updateLegacyDraft(row.id, "motorista", e.target.value)
                            }
                          />
                        )}
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-medium text-slate-500">Valor ajudante</span>
                        {ajDone ? (
                          <p className="font-medium text-emerald-800">
                            Lançado
                            {launchedAmount(existing, "ajudante") != null
                              ? ` · ${formatCurrency(launchedAmount(existing, "ajudante")!)}`
                              : ""}
                          </p>
                        ) : (
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            className={`${glassField(false)} w-full`}
                            placeholder="R$ 0,00"
                            value={draft.ajudante}
                            disabled={!canEdit || busy}
                            onChange={(e) =>
                              updateLegacyDraft(row.id, "ajudante", e.target.value)
                            }
                          />
                        )}
                      </label>
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      {motDone && ajDone ? (
                        <p className="text-center text-sm font-medium text-emerald-800">
                          Já lançado no DRE
                        </p>
                      ) : (
                        <Button
                          type="button"
                          variant="primary"
                          className="w-full"
                          disabled={
                            !canEdit ||
                            busy ||
                            ((!draft.motorista.trim() || motDone) &&
                              (!draft.ajudante.trim() || ajDone))
                          }
                          onClick={() => void launchLegacyRow(row)}
                        >
                          {busy ? "Lançando…" : "Lançar no DRE"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: tabela. */}
            <div className="hidden md:block">
              <DataTableScroll stickyFirst stickyLast>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="px-3 py-2.5 font-medium">OS</th>
                      <th className="px-3 py-2.5 font-medium">Nº legado</th>
                      <th className="px-3 py-2.5 font-medium">Data</th>
                      <th className="px-3 py-2.5 font-medium">Motorista</th>
                      <th className="px-3 py-2.5 font-medium">Valor motorista</th>
                      <th className="px-3 py-2.5 font-medium">Valor ajudante</th>
                      <th className="px-3 py-2.5 font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacyManualPayments.slice(0, 40).map((row) => {
                      const existing = legacyExistingByOrder.get(row.id);
                      const motDone = hasLaunchedKind(existing, "motorista");
                      const ajDone = hasLaunchedKind(existing, "ajudante");
                      const draft = legacyDrafts[row.id] ?? { motorista: "", ajudante: "" };
                      const busy = legacyBusyId === row.id;
                      return (
                        <tr key={row.id} className="border-b border-slate-100 align-top">
                          <td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">
                            {row.code}
                          </td>
                          <td className="px-3 py-3">{row.legacy_number || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            {formatDate(row.service_date)}
                          </td>
                          <td className="px-3 py-3">
                            {row.driver_code} — {row.driver_name}
                          </td>
                          <td className="px-3 py-3">
                            {motDone ? (
                              <span className="font-medium text-emerald-800">
                                Lançado
                                {launchedAmount(existing, "motorista") != null
                                  ? ` · ${formatCurrency(launchedAmount(existing, "motorista")!)}`
                                  : ""}
                              </span>
                            ) : (
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                className={`${glassField(true)} w-28`}
                                placeholder="R$"
                                value={draft.motorista}
                                disabled={!canEdit || busy}
                                onChange={(e) =>
                                  updateLegacyDraft(row.id, "motorista", e.target.value)
                                }
                              />
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {ajDone ? (
                              <span className="font-medium text-emerald-800">
                                Lançado
                                {launchedAmount(existing, "ajudante") != null
                                  ? ` · ${formatCurrency(launchedAmount(existing, "ajudante")!)}`
                                  : ""}
                              </span>
                            ) : (
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                className={`${glassField(false)} w-28`}
                                placeholder="R$"
                                value={draft.ajudante}
                                disabled={!canEdit || busy}
                                onChange={(e) =>
                                  updateLegacyDraft(row.id, "ajudante", e.target.value)
                                }
                              />
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {motDone && ajDone ? (
                              <span className="text-sm text-slate-500">OK</span>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                disabled={
                                  !canEdit ||
                                  busy ||
                                  ((!draft.motorista.trim() || motDone) &&
                                    (!draft.ajudante.trim() || ajDone))
                                }
                                onClick={() => void launchLegacyRow(row)}
                              >
                                {busy ? "…" : "Lançar no DRE"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataTableScroll>
            </div>
            {legacyManualPayments.length > 40 ? (
              <p className="text-xs text-slate-500">
                Mostrando 40 de {legacyManualPayments.length}. Lance os primeiros e a lista atualiza.
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
              Nenhum lançamento pago neste período. Marque um pagamento como pago na lista acima.
            </p>
          ) : (
            <>
              {/* Mobile: cartão por lançamento pago. */}
              <ul className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          OS {row.service_order_code ?? "—"} · {formatDate(row.transaction_date)}
                        </p>
                        <p className="text-base font-semibold leading-snug break-words text-slate-900">
                          {row.driver_code && row.driver_name
                            ? `${row.driver_code} — ${row.driver_name}`
                            : "—"}
                        </p>
                      </div>
                      <p className="w-fit rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {row.dre_account_name || "Conta DRE"}
                      </p>
                    </div>
                    <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Valor</dt>
                        <dd className="font-semibold text-slate-900">
                          {formatCurrency(row.amount)}
                        </dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Pix</dt>
                        <dd className="break-words text-slate-800">{row.pix_key ?? "—"}</dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Banco</dt>
                        <dd className="text-slate-800">{row.bank_code ?? "—"}</dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Agência</dt>
                        <dd className="text-slate-800">{row.bank_agency ?? "—"}</dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Conta</dt>
                        <dd className="text-slate-800">{row.bank_account ?? "—"}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>

              {/* Desktop: tabela agrupada por OS. */}
              <div className="hidden md:block">
                <DataTableScroll stickyFirst>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-600">
                        <th className="px-3 py-2.5 font-medium">Data</th>
                        <th className="px-3 py-2.5 font-medium">Conta DRE</th>
                        <th className="px-3 py-2.5 font-medium">OS</th>
                        <th className="px-3 py-2.5 font-medium">Motorista</th>
                        <th className="px-3 py-2.5 font-medium">Pix</th>
                        <th className="px-3 py-2.5 font-medium">Banco</th>
                        <th className="px-3 py-2.5 font-medium">Agência</th>
                        <th className="px-3 py-2.5 font-medium">Conta</th>
                        <th className="px-3 py-2.5 font-medium">Valor</th>
                      </tr>
                    </thead>
                    <GroupedTableBodies groups={paidDreGroups} colSpan={9}>
                      {(group) =>
                        group.rows.map((row, index) => (
                          <tr
                            key={row.id}
                            className={group.multi ? "align-top" : "border-b border-slate-100"}
                          >
                            <td className="whitespace-nowrap px-3 py-3">
                              {index === 0 || !group.multi
                                ? formatDate(row.transaction_date)
                                : ""}
                            </td>
                            <td className="px-3 py-3 font-medium">{row.dre_account_name}</td>
                            <td className="px-3 py-3 font-medium">
                              {index === 0 ? (
                                row.service_order_code ?? "—"
                              ) : group.multi ? (
                                <span className="text-slate-300" aria-hidden>
                                  ↳
                                </span>
                              ) : (
                                row.service_order_code ?? "—"
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {row.driver_code && row.driver_name
                                ? `${row.driver_code} — ${row.driver_name}`
                                : "—"}
                            </td>
                            <td className="px-3 py-3">{row.pix_key ?? "—"}</td>
                            <td className="px-3 py-3">{row.bank_code ?? "—"}</td>
                            <td className="px-3 py-3">{row.bank_agency ?? "—"}</td>
                            <td className="px-3 py-3">{row.bank_account ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-3 font-medium">
                              {formatCurrency(row.amount)}
                            </td>
                          </tr>
                        ))
                      }
                    </GroupedTableBodies>
                  </table>
                </DataTableScroll>
              </div>
            </>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

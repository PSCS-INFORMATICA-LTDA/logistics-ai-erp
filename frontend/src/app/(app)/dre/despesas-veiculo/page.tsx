"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  createVehicleExpense,
  deleteVehicleExpense,
  fetchDreVehicleExpenses,
  fetchVehicleOrdersForSelect,
  type DreVehicleExpenseRow,
} from "@/lib/dre-vehicle-expenses-api";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import {
  VEHICLE_EXPENSE_CATEGORIES,
  type VehicleExpenseCategoryKey,
} from "@/lib/vehicle-expense-categories";

function formatDate(value: string): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export default function DreDespesasVeiculoPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleOptions, setVehicleOptions] = useState<{ value: string; label: string }[]>([]);
  const [orderOptions, setOrderOptions] = useState<{ value: string; label: string }[]>([]);
  const [dreAccounts, setDreAccounts] = useState<{ value: string; label: string }[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<DreVehicleExpenseRow[]>([]);
  const [summary, setSummary] = useState({
    byAccount: {} as Record<string, number>,
    totalExpense: 0,
    totalRevenue: 0,
    result: 0,
  });

  const [transactionDate, setTransactionDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [amount, setAmount] = useState("");
  const [categoryKey, setCategoryKey] = useState<VehicleExpenseCategoryKey>("combustivel");
  const [chartOfAccountId, setChartOfAccountId] = useState("");
  const [serviceOrderId, setServiceOrderId] = useState("");
  const [description, setDescription] = useState("");

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [month, year]
  );

  const loadVehicles = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("vehicles")
      .select("id, plate, plate_display, status")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("plate");
    setVehicleOptions(
      (data ?? [])
        .filter((v) => v.status !== "Inativo")
        .map((v) => ({
          value: v.id as string,
          label: ((v.plate_display as string) || (v.plate as string) || "").toUpperCase(),
        }))
    );
  }, [companyId, supabase]);

  const loadDreAccounts = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("transaction_type", "Despesa")
      .eq("status", "Ativo")
      .order("name");
    setDreAccounts(
      (data ?? []).map((a) => ({ value: a.id as string, label: a.name as string }))
    );
  }, [companyId, supabase]);

  const loadOrders = useCallback(async () => {
    if (!companyId || !vehicleId) {
      setOrderOptions([]);
      return;
    }
    const options = await fetchVehicleOrdersForSelect(supabase, companyId, vehicleId);
    setOrderOptions([{ value: "", label: "— Sem OS (lançamento avulso) —" }, ...options]);
  }, [companyId, supabase, vehicleId]);

  const loadExpenses = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const result = await fetchDreVehicleExpenses(supabase, companyId, {
      year,
      month,
      vehicleId: vehicleId || null,
    });
    if (result.error) {
      setError(result.error);
      setRows([]);
      setSummary({ byAccount: {}, totalExpense: 0, totalRevenue: 0, result: 0 });
    } else {
      setRows(result.rows);
      setSummary(result.summary);
    }
    setLoading(false);
  }, [companyId, month, supabase, vehicleId, year]);

  useEffect(() => {
    void loadVehicles();
    void loadDreAccounts();
  }, [loadDreAccounts, loadVehicles]);

  useEffect(() => {
    void loadOrders();
    setServiceOrderId("");
  }, [loadOrders]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const submit = async () => {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setMsg(null);

    const result = await createVehicleExpense(supabase, companyId, {
      vehicleId,
      transactionDate,
      amount: Number(amount),
      categoryKey,
      chartOfAccountId: categoryKey === "outros" ? chartOfAccountId : null,
      serviceOrderId: serviceOrderId || null,
      description: description || null,
    });

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setMsg("Despesa do veículo lançada no DRE.");
    setAmount("");
    setDescription("");
    setSaving(false);
    await loadExpenses();
  };

  const remove = async (id: string) => {
    if (!companyId) return;
    if (!window.confirm("Excluir este lançamento do DRE do veículo?")) return;
    const result = await deleteVehicleExpense(supabase, companyId, id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMsg("Lançamento excluído.");
    await loadExpenses();
  };

  const accountBreakdown = Object.entries(summary.byAccount).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader
        title="Despesas do veículo"
        description="Lance pedágio, combustível, pneu, oficina e demais custos por placa. Com OS informada, o sistema bloqueia duplicata da mesma conta na mesma data."
      />
      <CardBody className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Mês</span>
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
          <div className="min-w-[200px]">
            <GlassSelect
              label="Placa"
              value={vehicleId}
              onChange={setVehicleId}
              options={[{ value: "", label: "— Todas as placas —" }, ...vehicleOptions]}
              searchable
            />
          </div>
          <p className="text-sm text-slate-500">
            Período: <strong className="capitalize text-slate-700">{monthLabel}</strong>
          </p>
          <Link href="/cadastros/contas-dre" className="text-sm text-brand-700 hover:underline">
            Contas DRE
          </Link>
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="info">{msg}</Alert> : null}

        {vehicleId ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={glassStatCard("green")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Receita OS (placa)
              </p>
              <p className="mt-1 text-2xl font-semibold text-emerald-950">
                {formatCurrency(summary.totalRevenue)}
              </p>
            </div>
            <div className={glassStatCard("amber")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Despesas (placa)
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-950">
                {formatCurrency(summary.totalExpense)}
              </p>
            </div>
            <div className={glassStatCard(summary.result >= 0 ? "brand" : "amber")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">
                Resultado da placa
              </p>
              <p className="mt-1 text-2xl font-semibold text-brand-950">
                {formatCurrency(summary.result)}
              </p>
            </div>
          </div>
        ) : (
          <div className={glassStatCard("slate")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Total despesas (todas as placas no mês)
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {formatCurrency(summary.totalExpense)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Selecione uma placa para ver receita da OS e resultado do veículo.
            </p>
          </div>
        )}

        {accountBreakdown.length > 0 ? (
          <div className={`space-y-2 p-4 ${glassFilterPanel()}`}>
            <h3 className="text-sm font-semibold text-slate-900">Quebra por conta DRE</h3>
            <ul className="grid gap-1 sm:grid-cols-2">
              {accountBreakdown.map(([name, total]) => (
                <li key={name} className="flex justify-between gap-3 text-sm text-slate-700">
                  <span>{name}</span>
                  <span className="font-medium">{formatCurrency(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className={`space-y-4 p-4 ${glassFilterPanel()}`}>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Novo lançamento</h2>
            <p className="text-xs text-slate-600">
              Se informar a OS, não será permitido outro lançamento da mesma conta DRE na mesma data
              para essa OS (evita duplicar pedágio/combustível já lançado).
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <GlassSelect
                label="Veículo (placa) *"
                value={vehicleId}
                onChange={setVehicleId}
                options={[{ value: "", label: "— Selecione a placa —" }, ...vehicleOptions]}
                searchable
                required
              />
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Data *</span>
              <input
                type="date"
                className={glassField()}
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Valor (R$) *</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={glassField()}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <GlassSelect
              label="Tipo *"
              value={categoryKey}
              onChange={(v) => setCategoryKey(v as VehicleExpenseCategoryKey)}
              options={VEHICLE_EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
            />
            {categoryKey === "outros" ? (
              <GlassSelect
                label="Conta DRE *"
                value={chartOfAccountId}
                onChange={setChartOfAccountId}
                options={[{ value: "", label: "— Selecione —" }, ...dreAccounts]}
                searchable
              />
            ) : (
              <div className="flex items-end pb-2 text-sm text-slate-600">
                Conta:{" "}
                <strong className="ml-1 text-slate-800">
                  {VEHICLE_EXPENSE_CATEGORIES.find((c) => c.key === categoryKey)?.accountName}
                </strong>
              </div>
            )}
            <div className="sm:col-span-2">
              <GlassSelect
                label="OS (opcional — recomendado)"
                value={serviceOrderId}
                onChange={setServiceOrderId}
                options={
                  vehicleId
                    ? orderOptions
                    : [{ value: "", label: "Selecione a placa para listar as OS" }]
                }
                searchable
                disabled={!vehicleId}
              />
            </div>
            <label className="block space-y-1 text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Observação</span>
              <input
                className={glassField()}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: posto Shell km 120 / borracharia Centro"
              />
            </label>
          </div>

          <Button type="button" onClick={() => void submit()} disabled={saving || !vehicleId}>
            {saving ? "Salvando…" : "Lançar despesa no DRE"}
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Lançamentos do período</h2>
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma despesa de veículo neste filtro.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left">
                    <th className="px-3 py-2 font-medium text-slate-600">Data</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Placa</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Conta</th>
                    <th className="px-3 py-2 font-medium text-slate-600">OS</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Obs.</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Valor</th>
                    <th className="px-3 py-2 font-medium text-slate-600" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-slate-700">{formatDate(row.transaction_date)}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.plate ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{row.dre_account_name}</td>
                      <td className="px-3 py-2 text-slate-700">{row.service_order_code ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">
                        {row.description ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="ghost" onClick={() => void remove(row.id)}>
                          Excluir
                        </Button>
                      </td>
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

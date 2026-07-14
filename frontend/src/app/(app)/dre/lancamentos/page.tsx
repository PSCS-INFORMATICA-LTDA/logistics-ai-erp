"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  createCompanyLedgerEntry,
  deleteCompanyLedgerEntry,
  fetchCompanyLedger,
  type CompanyLedgerRow,
} from "@/lib/dre-company-ledger-api";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

function formatDate(value: string): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

type AccountOption = {
  value: string;
  label: string;
  transaction_type: string;
};

export default function DreLancamentosPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [typeFilter, setTypeFilter] = useState<"all" | "Receita" | "Despesa">("all");
  const [filterAccountId, setFilterAccountId] = useState("");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<CompanyLedgerRow[]>([]);
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalExpense: 0,
    balance: 0,
    byAccount: {} as Record<string, number>,
  });

  const [transactionDate, setTransactionDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [amount, setAmount] = useState("");
  const [chartOfAccountId, setChartOfAccountId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [month, year]
  );

  const selectedAccount = accounts.find((a) => a.value === chartOfAccountId);
  const isExpense = selectedAccount?.transaction_type === "Despesa";

  const loadLookups = useCallback(async () => {
    if (!companyId) return;
    const [accRes, supRes] = await Promise.all([
      supabase
        .from("chart_of_accounts")
        .select("id, name, transaction_type")
        .eq("company_id", companyId)
        .eq("status", "Ativo")
        .in("transaction_type", ["Receita", "Despesa"])
        .order("name"),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("status", "Ativo")
        .order("name"),
    ]);

    setAccounts(
      (accRes.data ?? []).map((a) => ({
        value: a.id as string,
        label: `${a.name} (${a.transaction_type})`,
        transaction_type: a.transaction_type as string,
      }))
    );
    setSuppliers([
      { value: "", label: "— Sem fornecedor —" },
      ...(supRes.data ?? []).map((s) => ({
        value: s.id as string,
        label: s.name as string,
      })),
    ]);
  }, [companyId, supabase]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const result = await fetchCompanyLedger(supabase, companyId, {
      year,
      month,
      typeFilter,
      accountId: filterAccountId || null,
    });
    if (result.error) {
      setError(result.error);
      setRows([]);
      setSummary({ totalRevenue: 0, totalExpense: 0, balance: 0, byAccount: {} });
    } else {
      setRows(result.rows);
      setSummary(result.summary);
    }
    setLoading(false);
  }, [companyId, filterAccountId, month, supabase, typeFilter, year]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setMsg(null);

    const result = await createCompanyLedgerEntry(supabase, companyId, {
      transactionDate,
      amount: Number(amount),
      chartOfAccountId,
      description: description || null,
      supplierId: isExpense ? supplierId || null : null,
    });

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setMsg("Lançamento registrado no DRE da empresa.");
    setAmount("");
    setDescription("");
    setSaving(false);
    await load();
  };

  const remove = async (id: string) => {
    if (!companyId) return;
    if (!window.confirm("Excluir este lançamento do DRE da empresa?")) return;
    const result = await deleteCompanyLedgerEntry(supabase, companyId, id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMsg("Lançamento excluído.");
    await load();
  };

  const accountBreakdown = Object.entries(summary.byAccount).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );

  return (
    <Card>
      <CardHeader
        title="Lançamentos da empresa"
        description="Controle mensal da GRX: receitas e despesas gerais (geladeira, material de escritório, aluguel, etc.) — sem vínculo obrigatório com veículo. Use as contas do plano DRE."
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
          <div className="min-w-[160px]">
            <GlassSelect
              label="Tipo"
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as "all" | "Receita" | "Despesa")}
              options={[
                { value: "all", label: "Receitas e despesas" },
                { value: "Receita", label: "Só receitas" },
                { value: "Despesa", label: "Só despesas" },
              ]}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <GlassSelect
              label="Filtrar conta"
              value={filterAccountId}
              onChange={setFilterAccountId}
              options={[{ value: "", label: "— Todas as contas —" }, ...accounts]}
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

        <div className="grid gap-3 sm:grid-cols-3">
          <div className={glassStatCard("green")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Entradas (receitas)
            </p>
            <p className="mt-1 text-2xl font-semibold text-emerald-950">
              {formatCurrency(summary.totalRevenue)}
            </p>
          </div>
          <div className={glassStatCard("amber")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Saídas (despesas)
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-950">
              {formatCurrency(summary.totalExpense)}
            </p>
          </div>
          <div className={glassStatCard(summary.balance >= 0 ? "brand" : "amber")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">
              Saldo do mês
            </p>
            <p className="mt-1 text-2xl font-semibold text-brand-950">
              {formatCurrency(summary.balance)}
            </p>
          </div>
        </div>

        {accountBreakdown.length > 0 ? (
          <div className={`space-y-2 p-4 ${glassFilterPanel()}`}>
            <h3 className="text-sm font-semibold text-slate-900">Quebra por conta (mês)</h3>
            <ul className="grid gap-1 sm:grid-cols-2">
              {accountBreakdown.map(([name, total]) => (
                <li key={name} className="flex justify-between gap-3 text-sm text-slate-700">
                  <span>{name}</span>
                  <span className={total >= 0 ? "font-medium text-emerald-800" : "font-medium text-amber-900"}>
                    {formatCurrency(total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className={`space-y-4 p-4 ${glassFilterPanel()}`}>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Novo lançamento</h2>
            <p className="text-xs text-slate-600">
              Escolha a conta DRE (Receita ou Despesa). O sistema bloqueia duplicata da mesma data +
              conta + valor.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="sm:col-span-2">
              <GlassSelect
                label="Conta DRE *"
                value={chartOfAccountId}
                onChange={(v) => {
                  setChartOfAccountId(v);
                  if (accounts.find((a) => a.value === v)?.transaction_type !== "Despesa") {
                    setSupplierId("");
                  }
                }}
                options={[{ value: "", label: "— Selecione (geladeira, escritório, etc.) —" }, ...accounts]}
                searchable
                required
              />
            </div>
            {isExpense ? (
              <div className="sm:col-span-2">
                <GlassSelect
                  label="Fornecedor (opcional)"
                  value={supplierId}
                  onChange={setSupplierId}
                  options={suppliers}
                  searchable
                />
              </div>
            ) : null}
            <label className="block space-y-1 text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Observação</span>
              <input
                className={glassField()}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: NF 123 · reposição geladeira · papel A4"
              />
            </label>
          </div>

          <Button type="button" onClick={() => void submit()} disabled={saving || !chartOfAccountId}>
            {saving ? "Salvando…" : "Lançar no DRE da empresa"}
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Lançamentos do período</h2>
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum lançamento da empresa neste filtro. Cadastre despesas/receitas gerais acima.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 [-webkit-overflow-scrolling:touch]">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left">
                    <th className="px-3 py-2 font-medium text-slate-600">Data</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Tipo</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Conta</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Fornecedor</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Obs.</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Valor</th>
                    <th className="px-3 py-2 font-medium text-slate-600" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-slate-700">{formatDate(row.transaction_date)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.transaction_type === "Receita"
                              ? "font-medium text-emerald-800"
                              : "font-medium text-amber-900"
                          }
                        >
                          {row.transaction_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.dre_account_name}</td>
                      <td className="px-3 py-2 text-slate-600">{row.supplier_name ?? "—"}</td>
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

        <p className="text-xs text-slate-500">
          Despesas de <strong>placa</strong> e <strong>motorista</strong> continuam nas outras abas do
          DRE. Esta tela é o controle geral da empresa no mês (como na planilha do Rafael).
        </p>
      </CardBody>
    </Card>
  );
}

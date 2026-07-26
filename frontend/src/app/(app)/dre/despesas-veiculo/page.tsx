"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  createVehicleExpense,
  deleteVehicleExpense,
  fetchDreVehicleExpenses,
  fetchVehicleOrdersForSelect,
  type DreVehicleExpenseRow,
} from "@/lib/dre-vehicle-expenses-api";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { createDeletionApprovalRequest } from "@/lib/deletion-approvals";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";
import { assertCriticalDeleteGate } from "@/lib/deletion-gate";
import { summarizeDeletedRow } from "@/lib/deletion-audit";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { glassAction, glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { groupByKeySorted } from "@/lib/table-row-groups";
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
  const { canEditScreen, canDeleteScreen, isAdmin } = useAccess();
  const canEdit = canEditScreen("dre.despesas-veiculo");
  const canDelete = canDeleteScreen("dre.despesas-veiculo");
  const [requireMasterForDelete, setRequireMasterForDelete] = useState(false);
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para lançar.");
      return;
    }
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

  const remove = async (payload: {
    reason: string;
    reasonCode: string;
    masterPassword?: string;
  }) => {
    if (!companyId || !pendingDeleteId) return;
    if (!canDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      setPendingDeleteId(null);
      return;
    }
    setDeleting(true);
    setError(null);
    setMsg(null);

    const gate = await assertCriticalDeleteGate({
      supabase,
      companyId,
      isAdmin,
      masterPassword: payload.masterPassword,
    });
    if (!gate.ok) {
      setDeleting(false);
      setError(gate.error);
      return;
    }

    if (gate.mode === "approval") {
      const { data: existing } = await supabase
        .from("financial_transactions")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", pendingDeleteId)
        .maybeSingle();
      const row = (existing as Record<string, unknown> | null) ?? null;
      const { entityCode, summary } = summarizeDeletedRow(row, "financial_transactions");
      const requested = await createDeletionApprovalRequest({
        supabase,
        companyId,
        entityType: "financial_transactions",
        entityId: pendingDeleteId,
        entityCode,
        summary,
        screenKey: "dre.despesas-veiculo",
        deleteMode: "hard",
        reason: payload.reason,
        reasonCode: payload.reasonCode,
        payload: row,
      });
      setDeleting(false);
      setPendingDeleteId(null);
      if (requested.error) {
        setError(requested.error);
        return;
      }
      await enqueueDeletionAlert({
        supabase,
        companyId,
        alertType: "approval_requested",
        title: "Pedido de exclusão: Lançamento DRE",
        body: `Pedido pendente (${summary || pendingDeleteId}). Motivo: ${payload.reason}`,
        entityType: "financial_transactions",
        entityId: pendingDeleteId,
        meta: { requestId: requested.id },
      });
      setMsg("Pedido enviado para aprovação do administrador.");
      return;
    }

    const deleteId = pendingDeleteId;
    const result = await deleteVehicleExpense(
      supabase,
      companyId,
      deleteId,
      payload.reason,
      payload.reasonCode
    );
    setDeleting(false);
    setPendingDeleteId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    await enqueueDeletionAlert({
      supabase,
      companyId,
      alertType: "critical_deleted",
      title: "Exclusão crítica: Lançamento DRE",
      body: `Despesa do veículo excluída. Motivo: ${payload.reason}`,
      entityType: "financial_transactions",
      entityId: deleteId,
    });
    setMsg("Lançamento excluído.");
    await loadExpenses();
  };

  const accountBreakdown = Object.entries(summary.byAccount).sort((a, b) => b[1] - a[1]);

  const expenseGroups = useMemo(
    () =>
      groupByKeySorted(
        rows,
        (row) => row.service_order_code || `${row.plate}|${row.transaction_date}`,
        (a, b) => a.dre_account_name.localeCompare(b.dre_account_name, "pt-BR")
      ),
    [rows]
  );

  return (
    <Card>
      <CardHeader
        title="Despesas do Veículo"
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
          <Link href="/cadastros/contas-dre" className={glassAction("brand", true)}>
            Contas DRE
          </Link>
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="info">{msg}</Alert> : null}
        {!canEdit ? (
          <Alert variant="info">
            Modo visualização: você pode consultar as despesas, mas não criar nem alterar.
          </Alert>
        ) : null}

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

        {canEdit ? (
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
        ) : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Lançamentos do período</h2>
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma despesa de veículo neste filtro.</p>
          ) : (
            <DataTableScroll stickyFirst stickyLast compact>
              <table className="w-full text-[11px] leading-snug sm:text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left">
                    <th className="px-1.5 py-2 font-medium text-slate-600">Data</th>
                    <th className="px-1.5 py-2 font-medium text-slate-600">Placa</th>
                    <th className="hidden px-1.5 py-2 font-medium text-slate-600 md:table-cell">
                      Conta
                    </th>
                    <th className="hidden px-1.5 py-2 font-medium text-slate-600 lg:table-cell">
                      OS
                    </th>
                    <th className="hidden px-1.5 py-2 font-medium text-slate-600 xl:table-cell">
                      Obs.
                    </th>
                    <th className="px-1.5 py-2 font-medium text-slate-600">Valor</th>
                    <th className="px-1.5 py-2 font-medium text-slate-600">Ação</th>
                  </tr>
                </thead>
                <GroupedTableBodies groups={expenseGroups} colSpan={7}>
                  {(group) =>
                    group.rows.map((row, index) => (
                      <tr
                        key={row.id}
                        className={group.multi ? "align-top" : "border-b border-slate-50"}
                      >
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-slate-700">
                          {index === 0 || !group.multi
                            ? formatDate(row.transaction_date)
                            : ""}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 font-medium text-slate-900">
                          {index === 0 ? (
                            row.plate ?? "—"
                          ) : group.multi ? (
                            <span className="text-slate-300" aria-hidden>
                              ↳
                            </span>
                          ) : (
                            row.plate ?? "—"
                          )}
                        </td>
                        <td
                          className="hidden max-w-[8rem] truncate px-1.5 py-1.5 text-slate-700 md:table-cell"
                          title={row.dre_account_name || undefined}
                        >
                          {row.dre_account_name}
                        </td>
                        <td className="hidden px-1.5 py-1.5 text-slate-700 lg:table-cell">
                          {index === 0 || !group.multi ? row.service_order_code ?? "—" : ""}
                        </td>
                        <td
                          className="hidden max-w-[10rem] truncate px-1.5 py-1.5 text-slate-600 xl:table-cell"
                          title={row.description ?? undefined}
                        >
                          {row.description ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 font-medium text-slate-900">
                          {formatCurrency(row.amount)}
                        </td>
                        <td className="px-1.5 py-1.5 text-right">
                          {canDelete ? (
                            <div className="os-row-actions inline-flex justify-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="action-icon-btn"
                                title="Excluir"
                                aria-label="Excluir"
                                onClick={() => {
                                  setPendingDeleteId(row.id);
                                  void (async () => {
                                    if (!isAdmin || !companyId) {
                                      setRequireMasterForDelete(false);
                                      return;
                                    }
                                    const {
                                      data: { user },
                                    } = await supabase.auth.getUser();
                                    setRequireMasterForDelete(
                                      !(user?.id && isMasterSessionUnlocked(companyId, user.id))
                                    );
                                  })();
                                }}
                              >
                                <span className="sm:hidden">Exc</span>
                                <span className="hidden sm:inline">Excluir</span>
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  }
                </GroupedTableBodies>
              </table>
            </DataTableScroll>
          )}
        </section>
      </CardBody>

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        confirming={deleting}
        critical
        requireMasterPassword={requireMasterForDelete}
        confirmLabel={isAdmin ? "Excluir com registro" : "Enviar para aprovação"}
        title="Excluir despesa do veículo"
        description="Informe o motivo da exclusão deste lançamento do DRE do veículo."
        onCancel={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={remove}
      />
    </Card>
  );
}

"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  createCompanyLedgerEntry,
  deleteCompanyLedgerEntry,
  fetchCompanyLedger,
  type CompanyLedgerRow,
} from "@/lib/dre-company-ledger-api";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { summarizeDeletedRow } from "@/lib/deletion-audit";
import { createDeletionApprovalRequest } from "@/lib/deletion-approvals";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";
import { assertCriticalDeleteGate } from "@/lib/deletion-gate";
import {
  isDriverOrAssistantDreAccount,
  pickDreAccountIdForDriverExpense,
} from "@/lib/legacy-driver-expense";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { glassAction, glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/utils";

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
  return (
    <Suspense fallback={<Loading />}>
      <DreLancamentosPageContent />
    </Suspense>
  );
}

function DreLancamentosPageContent() {
  const { companyId } = useCompany();
  const { canEditScreen, canDeleteScreen, isAdmin } = useAccess();
  const canEdit = canEditScreen("dre.lancamentos");
  const canDelete = canDeleteScreen("dre.lancamentos");
  const searchParams = useSearchParams();
  const legacyPay = searchParams.get("legacyPay") === "1";
  const prefillAppliedRef = useRef(false);
  const [requireMasterForDelete, setRequireMasterForDelete] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [typeFilter, setTypeFilter] = useState<"all" | "Receita" | "Despesa">("all");
  const [filterAccountId, setFilterAccountId] = useState("");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);
  const [orderOptions, setOrderOptions] = useState<{ value: string; label: string; legacy?: string | null }[]>(
    []
  );

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
  const [serviceOrderId, setServiceOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [month, year]
  );

  const selectedAccount = accounts.find((a) => a.value === chartOfAccountId);
  const isExpense = selectedAccount?.transaction_type === "Despesa";
  const requiresServiceOrder =
    Boolean(selectedAccount && isDriverOrAssistantDreAccount(selectedAccount.label)) || legacyPay;

  const loadLookups = useCallback(async () => {
    if (!companyId) return;
    const [accRes, supRes, ordersRes] = await Promise.all([
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
      supabase
        .from("service_orders")
        .select("id, code, legacy_number, service_date, plate, client_name")
        .eq("company_id", companyId)
        .in("service_type", ["Frete", "Transporte"])
        .neq("status", "Cancelado")
        .order("service_date", { ascending: false })
        .limit(500),
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
    setOrderOptions(
      (ordersRes.data ?? []).map((o) => {
        const dateLabel = o.service_date ? formatDateBR(String(o.service_date).slice(0, 10)) : "";
        const legacy = (o.legacy_number as string | null) ?? null;
        return {
          value: o.id as string,
          legacy,
          label: [
            o.code,
            legacy ? `legado ${legacy}` : null,
            o.plate,
            dateLabel,
            o.client_name,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      })
    );
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

  /** Prefill a partir da OS legado (Despesas Motorista / ações da OS). */
  useEffect(() => {
    if (!legacyPay || prefillAppliedRef.current || accounts.length === 0) return;
    prefillAppliedRef.current = true;

    const accountPref =
      searchParams.get("account") === "ajudante" ? "ajudante" : "motorista";
    const accountId = pickDreAccountIdForDriverExpense(accounts, accountPref);
    if (accountId) setChartOfAccountId(accountId);

    const date = searchParams.get("date")?.trim();
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setTransactionDate(date);
      setYear(Number(date.slice(0, 4)));
      setMonth(Number(date.slice(5, 7)));
    }

    const desc = searchParams.get("desc")?.trim();
    if (desc) setDescription(desc);

    setTypeFilter("Despesa");
  }, [accounts, legacyPay, searchParams]);

  /** Vincula a OS do deep-link (obrigatória para rateio). */
  useEffect(() => {
    if (!legacyPay || orderOptions.length === 0 || serviceOrderId) return;
    const orderIdParam = searchParams.get("orderId")?.trim();
    if (orderIdParam && orderOptions.some((o) => o.value === orderIdParam)) {
      setServiceOrderId(orderIdParam);
      return;
    }
    const codeParam = searchParams.get("os")?.trim().toLowerCase();
    if (!codeParam) return;
    const hit = orderOptions.find((o) =>
      o.label.toLowerCase().startsWith(codeParam) || o.label.toLowerCase().includes(` ${codeParam} `)
    );
    // Match by code prefix in label "00000001 · ..."
    const byCode = orderOptions.find((o) => o.label.toLowerCase().startsWith(`${codeParam} ·`))
      ?? orderOptions.find((o) => o.label.toLowerCase().startsWith(codeParam));
    if (byCode) setServiceOrderId(byCode.value);
    else if (hit) setServiceOrderId(hit.value);
  }, [legacyPay, orderOptions, searchParams, serviceOrderId]);

  const submit = async () => {
    if (!companyId) return;
    if (!canEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para lançar.");
      return;
    }
    if (requiresServiceOrder && !serviceOrderId) {
      setError(
        "Informe o nº da OS. Sem a OS vinculada o rateio por sócios (participações do quadro) não consegue alocar esta despesa."
      );
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);

    const selectedOrder = orderOptions.find((o) => o.value === serviceOrderId);
    const result = await createCompanyLedgerEntry(supabase, companyId, {
      transactionDate,
      amount: Number(amount),
      chartOfAccountId,
      description: description || null,
      supplierId: isExpense ? supplierId || null : null,
      serviceOrderId: serviceOrderId || null,
      legacyNumber: selectedOrder?.legacy ?? searchParams.get("legacy"),
    });

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setMsg(
      requiresServiceOrder
        ? "Lançamento registrado com OS vinculada — disponível para rateio por sócios."
        : "Lançamento registrado no DRE da empresa."
    );
    setAmount("");
    setDescription("");
    if (!legacyPay) setServiceOrderId("");
    setSaving(false);
    await load();
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
        screenKey: "dre.lancamentos",
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
    const result = await deleteCompanyLedgerEntry(
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
      body: `Lançamento da empresa excluído. Motivo: ${payload.reason}`,
      entityType: "financial_transactions",
      entityId: deleteId,
    });
    setMsg("Lançamento excluído.");
    await load();
  };

  const accountBreakdown = Object.entries(summary.byAccount).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );

  return (
    <Card>
      <CardHeader
        title="Lançamentos da Empresa"
        description="Controle mensal da GRX: receitas e despesas gerais (geladeira, material de escritório, aluguel, etc.). Contas Motorista/Ajudante exigem o nº da OS para o rateio por sócios (participações do quadro)."
      />
      <CardBody className="space-y-6">
        {legacyPay ? (
          <Alert variant="warning">
            OS legado/importada: escolha a conta <strong>Motorista</strong> ou <strong>Ajudante</strong>,
            informe o valor e <strong>obrigatoriamente o nº da OS</strong>. Sem a OS vinculada o{" "}
            <strong>rateio por sócios</strong> (conforme o quadro de participações) não consegue
            alocar a despesa. Novas OS usam o fluxo com valores na designação.
          </Alert>
        ) : null}
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
          <Link href="/cadastros/contas-dre" className={glassAction("brand", true)}>
            Contas DRE
          </Link>
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="info">{msg}</Alert> : null}
        {!canEdit ? (
          <Alert variant="info">
            Modo visualização: você pode consultar os lançamentos, mas não criar nem alterar.
          </Alert>
        ) : null}

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

        {canEdit ? (
        <section className={`space-y-4 p-4 ${glassFilterPanel()}`}>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Novo lançamento</h2>
            <p className="text-xs text-slate-600">
              Escolha a conta DRE (Receita ou Despesa). Em Motorista/Ajudante, informe o nº da OS
              para o rateio. O sistema bloqueia duplicata da mesma data + conta + valor.
            </p>
          </div>

          {requiresServiceOrder ? (
            <Alert variant="warning">
              Conta Motorista/Ajudante: o <strong>nº da OS é obrigatório</strong> para o rateio por
              sócios (participações do quadro na data da OS).
            </Alert>
          ) : null}

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
            <div className="sm:col-span-2">
              <GlassSelect
                label={
                  requiresServiceOrder
                    ? "Nº da OS * (obrigatório para rateio por sócios)"
                    : "OS (opcional)"
                }
                value={serviceOrderId}
                onChange={setServiceOrderId}
                options={[
                  {
                    value: "",
                    label: requiresServiceOrder
                      ? "— Selecione o nº da OS (rateio) —"
                      : "— Sem OS (lançamento geral) —",
                  },
                  ...orderOptions.map((o) => ({ value: o.value, label: o.label })),
                ]}
                searchable
                required={requiresServiceOrder}
              />
              {requiresServiceOrder ? (
                <p className="mt-1 text-xs text-amber-800">
                  Sem a OS vinculada esta despesa não entra no rateio por membros/sócios.
                </p>
              ) : null}
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
                placeholder="Ex.: NF 123 · OS 00000012 · pagamento motorista"
              />
            </label>
          </div>

          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !chartOfAccountId || (requiresServiceOrder && !serviceOrderId)}
          >
            {saving ? "Salvando…" : "Lançar no DRE da empresa"}
          </Button>
        </section>
        ) : null}

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
                    <th className="px-3 py-2 font-medium text-slate-600">OS</th>
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
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {row.service_order_code ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.supplier_name ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">
                        {row.description ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="ghost"
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
                            Excluir
                          </Button>
                        ) : null}
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

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        confirming={deleting}
        critical
        requireMasterPassword={requireMasterForDelete}
        confirmLabel={isAdmin ? "Excluir com registro" : "Enviar para aprovação"}
        title="Excluir lançamento"
        description="Informe o motivo da exclusão deste lançamento do DRE da empresa."
        onCancel={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={remove}
      />
    </Card>
  );
}

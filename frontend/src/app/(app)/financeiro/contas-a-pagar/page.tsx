"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { Input } from "@/components/ui/Input";
import { useAccess } from "@/lib/access-context";
import {
  AP_APPROVAL_LABELS,
  AP_STATUS_LABELS,
  payeeLabel,
} from "@/lib/accounts-payable";
import {
  createAccountsPayableDraft,
  fetchApKpis,
  listAccountsPayable,
  submitAccountsPayable,
  type ApKpis,
} from "@/lib/accounts-payable-api";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel, glassStatCard } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/utils";

type ListRow = Awaited<ReturnType<typeof listAccountsPayable>>["rows"][number];
type PayeeKind = "supplier" | "driver" | "other";

function approvalBadgeVariant(
  status: ListRow["approval_status"]
): "default" | "success" | "warning" | "danger" {
  if (status === "approved") return "success";
  if (status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  return "default";
}

function statusBadgeVariant(
  status: ListRow["status"]
): "default" | "success" | "warning" | "danger" {
  if (status === "paid") return "success";
  if (status === "partially_paid") return "warning";
  if (status === "cancelled") return "danger";
  return "default";
}

export default function ContasAPagarPage() {
  const { companyId } = useCompany();
  const { canEditScreen, isAdmin } = useAccess();
  const canEdit = canEditScreen("financeiro.contas-a-pagar");
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<ListRow[]>([]);
  const [kpis, setKpis] = useState<ApKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [accounts, setAccounts] = useState<{ value: string; label: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);
  const [drivers, setDrivers] = useState<{ value: string; label: string }[]>([]);

  const [description, setDescription] = useState("");
  const [competenceDate, setCompetenceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [firstDueDate, setFirstDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chartId, setChartId] = useState("");
  const [amount, setAmount] = useState("");
  const [installmentCount, setInstallmentCount] = useState("1");
  const [payeeKind, setPayeeKind] = useState<PayeeKind>("supplier");
  const [supplierId, setSupplierId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setKpis(null);
    const [listRes, kpiRes] = await Promise.all([
      listAccountsPayable(supabase, companyId),
      fetchApKpis(supabase, companyId),
    ]);
    if (listRes.error) setError(listRes.error);
    if (kpiRes.error && !listRes.error) setError(kpiRes.error);
    setRows(listRes.rows);
    setKpis(kpiRes.kpis);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const [coa, sup, drv] = await Promise.all([
        supabase
          .from("chart_of_accounts")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("transaction_type", "Despesa")
          .eq("status", "Ativo")
          .order("name"),
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("drivers")
          .select("id, name")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("name"),
      ]);
      setAccounts((coa.data || []).map((r) => ({ value: String(r.id), label: String(r.name) })));
      setSuppliers((sup.data || []).map((r) => ({ value: String(r.id), label: String(r.name) })));
      setDrivers((drv.data || []).map((r) => ({ value: String(r.id), label: String(r.name) })));
    })();
  }, [companyId, supabase]);

  const changePayeeKind = (kind: PayeeKind) => {
    setPayeeKind(kind);
    setSupplierId("");
    setDriverId("");
    setPayeeName("");
  };

  const validateForm = (): string | null => {
    if (!description.trim()) return "Informe a descrição do título.";
    if (!competenceDate) return "Informe a data de competência.";
    if (!firstDueDate) return "Informe o primeiro vencimento.";
    if (!chartId) return "Selecione a conta DRE.";
    const originalAmount = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return "Informe um valor original maior que zero.";
    }
    const parcels = Number(installmentCount);
    if (!Number.isInteger(parcels) || parcels < 1) {
      return "A quantidade de parcelas deve ser um inteiro maior que zero.";
    }
    if (payeeKind === "supplier" && !supplierId) return "Selecione o fornecedor.";
    if (payeeKind === "driver" && !driverId) return "Selecione o motorista.";
    if (payeeKind === "other" && !payeeName.trim()) return "Informe o nome do favorecido.";
    return null;
  };

  const handleCreate = async (andSubmit: boolean) => {
    if (!companyId || !canEdit || saving) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    const originalAmount = Number(String(amount).replace(",", "."));
    const res = await createAccountsPayableDraft(supabase, {
      companyId,
      description: description.trim(),
      competenceDate,
      firstDueDate,
      chartOfAccountId: chartId,
      originalAmount,
      installmentCount: Number(installmentCount) || 1,
      supplierId: payeeKind === "supplier" ? supplierId || null : null,
      driverId: payeeKind === "driver" ? driverId || null : null,
      payeeName: payeeKind === "other" ? payeeName : null,
    });
    if (res.error || !res.id) {
      setSaving(false);
      setError(res.error || "Falha ao criar o título.");
      return;
    }
    if (andSubmit) {
      const sub = await submitAccountsPayable(supabase, res.id);
      if (sub.error) {
        setSaving(false);
        setError(`Criado ${res.internalNumber}, mas o envio falhou: ${sub.error}`);
        await load();
        return;
      }
      setInfo(`Título ${res.internalNumber} criado e enviado/aprovado.`);
    } else {
      setInfo(`Rascunho ${res.internalNumber} salvo.`);
    }
    setSaving(false);
    setShowForm(false);
    setDescription("");
    setAmount("");
    setInstallmentCount("1");
    changePayeeKind("supplier");
    setChartId("");
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Contas a Pagar</h1>
          <p className="text-sm text-slate-600">
            Obrigações por competência (DRE) e vencimento nas parcelas. Caixa na baixa.
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Fechar formulário" : "Novo lançamento"}
          </Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            ["Em aberto", kpis.openTotal],
            ["Vencido", kpis.overdueTotal],
            ["Vence hoje", kpis.dueToday],
            ["Vence em 7 dias", kpis.dueWeek],
            ["Vence em 30 dias", kpis.dueMonth],
            ["Pago no mês", kpis.paidMonth],
          ].map(([label, value]) => (
            <div key={String(label)} className={glassStatCard()}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-lg font-semibold text-slate-900">
                {formatCurrency(Number(value))}
              </p>
            </div>
          ))}
        </div>
      )}

      {showForm && canEdit && (
        <Card>
          <CardHeader title="Novo título (rascunho)" />
          <CardBody>
            <div className={glassFilterPanel()}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  label="Descrição"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={glassField(true)}
                  placeholder="Ex.: Combustível frota — Posto X"
                />
                <Input
                  label="Competência"
                  type="date"
                  value={competenceDate}
                  onChange={(e) => setCompetenceDate(e.target.value)}
                  className={glassField(true)}
                />
                <Input
                  label="Primeiro vencimento"
                  type="date"
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                  className={glassField(true)}
                />
                <GlassSelect
                  label="Conta DRE"
                  value={chartId}
                  onChange={setChartId}
                  options={accounts}
                  searchable
                  required
                />
                <Input
                  label="Valor original"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={glassField(true)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <Input
                  label="Quantidade de parcelas"
                  type="number"
                  min={1}
                  step={1}
                  value={installmentCount}
                  onChange={(e) => setInstallmentCount(e.target.value)}
                  className={glassField(true)}
                />
                <GlassSelect
                  label="Tipo de favorecido"
                  value={payeeKind}
                  onChange={(v) => changePayeeKind(v as PayeeKind)}
                  options={[
                    { value: "supplier", label: "Fornecedor" },
                    { value: "driver", label: "Motorista" },
                    { value: "other", label: "Eventual (nome)" },
                  ]}
                  required
                />
                {payeeKind === "supplier" && (
                  <GlassSelect
                    label="Favorecido"
                    value={supplierId}
                    onChange={setSupplierId}
                    options={suppliers}
                    searchable
                    required
                  />
                )}
                {payeeKind === "driver" && (
                  <GlassSelect
                    label="Favorecido"
                    value={driverId}
                    onChange={setDriverId}
                    options={drivers}
                    searchable
                    required
                  />
                )}
                {payeeKind === "other" && (
                  <Input
                    label="Favorecido"
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    className={glassField(true)}
                    placeholder="Nome do favorecido eventual"
                  />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void handleCreate(false)}
                >
                  {saving ? "Salvando…" : "Salvar rascunho"}
                </Button>
                <Button type="button" disabled={saving} onClick={() => void handleCreate(true)}>
                  {saving ? "Salvando…" : "Salvar e enviar / aprovar"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Rateio padrão 100% na conta DRE. A aprovação usa a regra da empresa; se estiver
                desligada, o título é finalizado e postado no DRE pela competência.
                {isAdmin ? " Admin pode aprovar na tela de detalhe." : ""}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Títulos" />
        <CardBody className="p-0">
          {loading ? (
            <Loading />
          ) : (
            <DataTableScroll>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="whitespace-nowrap px-3 py-2">Número</th>
                    <th className="min-w-[10rem] px-3 py-2">Descrição</th>
                    <th className="min-w-[8rem] px-3 py-2">Favorecido</th>
                    <th className="whitespace-nowrap px-3 py-2">Competência</th>
                    <th className="whitespace-nowrap px-3 py-2">Próximo vencimento</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Líquido</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Saldo</th>
                    <th className="whitespace-nowrap px-3 py-2">Aprovação</th>
                    <th className="whitespace-nowrap px-3 py-2">Status</th>
                    <th className="whitespace-nowrap px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        {row.internal_number}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2" title={row.description}>
                        {row.description}
                      </td>
                      <td
                        className="max-w-[10rem] truncate px-3 py-2"
                        title={payeeLabel({
                          payee_name: row.payee_name,
                          supplier_name: row.supplier_name,
                          driver_name: row.driver_name,
                        })}
                      >
                        {payeeLabel({
                          payee_name: row.payee_name,
                          supplier_name: row.supplier_name,
                          driver_name: row.driver_name,
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatDateBR(row.competence_date)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatDateBR(row.next_due_date)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {formatCurrency(row.net_amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {formatCurrency(row.open_balance)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={approvalBadgeVariant(row.approval_status)}>
                          {AP_APPROVAL_LABELS[row.approval_status] || row.approval_status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusBadgeVariant(row.status)}>
                          {AP_STATUS_LABELS[row.status] || row.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/financeiro/contas-a-pagar/${row.id}`}
                          className="text-brand-700 underline"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                        Nenhum título. Cadastre uma conta financeira antes de registrar
                        pagamentos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DataTableScroll>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

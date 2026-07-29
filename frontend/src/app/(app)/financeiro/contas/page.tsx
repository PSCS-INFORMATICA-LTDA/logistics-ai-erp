"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { Input } from "@/components/ui/Input";
import { useAccess } from "@/lib/access-context";
import {
  FINANCIAL_ACCOUNT_TYPE_LABELS,
  type FinancialAccountType,
  type CompanyFinancialAccount,
} from "@/lib/accounts-payable";
import {
  createFinancialAccount,
  listFinancialAccounts,
  softDeleteFinancialAccount,
  updateFinancialAccountActive,
} from "@/lib/accounts-payable-api";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/utils";

const TYPE_OPTIONS = (
  Object.keys(FINANCIAL_ACCOUNT_TYPE_LABELS) as FinancialAccountType[]
).map((value) => ({ value, label: FINANCIAL_ACCOUNT_TYPE_LABELS[value] }));

export default function ContasFinanceirasPage() {
  const { companyId } = useCompany();
  const { canEditScreen, canDeleteScreen } = useAccess();
  const canEdit = canEditScreen("financeiro.contas");
  const canDelete = canDeleteScreen("financeiro.contas");
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<CompanyFinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<FinancialAccountType>("cash");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingDate, setOpeningDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const res = await listFinancialAccounts(supabase, companyId);
    if (res.error) setError(res.error);
    setRows(res.rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!companyId || !canEdit || saving) return;
    if (!name.trim()) {
      setError("Informe o nome da conta.");
      return;
    }
    if (!accountType) {
      setError("Selecione o tipo da conta.");
      return;
    }
    const balance = Number(String(openingBalance).replace(",", "."));
    if (!Number.isFinite(balance) || balance < 0) {
      setError("O saldo de abertura não pode ser negativo.");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    const res = await createFinancialAccount(supabase, {
      companyId,
      name: name.trim(),
      accountType,
      openingBalance: balance || 0,
      openingBalanceDate: openingDate || null,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setName("");
    setOpeningBalance("0");
    setOpeningDate("");
    setAccountType("cash");
    setInfo("Conta financeira criada.");
    await load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Contas Financeiras</h1>
        <p className="text-sm text-slate-600">
          Caixa, bancos e carteiras digitais — obrigatórias na baixa do Contas a Pagar.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {canEdit && (
        <Card>
          <CardHeader title="Nova conta" />
          <CardBody>
            <div className={glassFilterPanel()}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="Nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={glassField(true)}
                  placeholder="Ex.: Caixa matriz"
                />
                <GlassSelect
                  label="Tipo"
                  value={accountType}
                  onChange={(v) => setAccountType(v as FinancialAccountType)}
                  options={TYPE_OPTIONS}
                />
                <Input
                  label="Saldo de abertura"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className={glassField()}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <Input
                  label="Data do saldo de abertura"
                  type="date"
                  value={openingDate}
                  onChange={(e) => setOpeningDate(e.target.value)}
                  className={glassField()}
                />
              </div>
              <div className="mt-3">
                <Button
                  type="button"
                  disabled={saving || !name.trim()}
                  onClick={() => void handleCreate()}
                >
                  {saving ? "Salvando…" : "Salvar conta"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Contas cadastradas" />
        <CardBody className="p-0">
          {loading ? (
            <Loading />
          ) : (
            <DataTableScroll>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Saldo de abertura</th>
                    <th className="px-3 py-2">Data do saldo</th>
                    <th className="px-3 py-2">Ativa</th>
                    <th className="px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-medium">{row.name}</td>
                      <td className="px-3 py-2">
                        {FINANCIAL_ACCOUNT_TYPE_LABELS[row.account_type] || row.account_type}
                      </td>
                      <td className="px-3 py-2">{formatCurrency(row.opening_balance)}</td>
                      <td className="px-3 py-2">{formatDateBR(row.opening_balance_date)}</td>
                      <td className="px-3 py-2">{row.is_active ? "Sim" : "Não"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {canEdit && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busyId === row.id}
                              onClick={async () => {
                                setBusyId(row.id);
                                setError(null);
                                const res = await updateFinancialAccountActive(
                                  supabase,
                                  companyId!,
                                  row.id,
                                  !row.is_active
                                );
                                setBusyId(null);
                                if (res.error) setError(res.error);
                                else {
                                  setInfo(
                                    row.is_active
                                      ? "Conta inativada."
                                      : "Conta reativada."
                                  );
                                  await load();
                                }
                              }}
                            >
                              {row.is_active ? "Inativar" : "Reativar"}
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setDeleteId(row.id)}
                            >
                              Excluir
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        Nenhuma conta financeira cadastrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DataTableScroll>
          )}
        </CardBody>
      </Card>

      <DeleteReasonModal
        open={Boolean(deleteId)}
        title="Excluir conta financeira"
        onCancel={() => setDeleteId(null)}
        onConfirm={async ({ reasonCode, reason }) => {
          if (!companyId || !deleteId) return;
          const res = await softDeleteFinancialAccount(supabase, companyId, deleteId, {
            code: reasonCode,
            detail: reason,
          });
          setDeleteId(null);
          if (res.error) setError(res.error);
          else {
            setInfo("Conta excluída.");
            await load();
          }
        }}
      />
    </div>
  );
}

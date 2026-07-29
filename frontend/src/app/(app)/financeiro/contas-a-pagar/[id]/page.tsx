"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { Input } from "@/components/ui/Input";
import { useAccess } from "@/lib/access-context";
import {
  AP_APPROVAL_LABELS,
  AP_INSTALLMENT_STATUS_LABELS,
  AP_STATUS_LABELS,
  type AccountsPayableInstallment,
  type AccountsPayablePayment,
  type AccountsPayableRow,
  type CompanyFinancialAccount,
} from "@/lib/accounts-payable";
import {
  approveAccountsPayable,
  cancelAccountsPayable,
  fetchAccountsPayableDetail,
  listFinancialAccounts,
  registerApPayment,
  rejectAccountsPayable,
  reverseApPayment,
  softDeleteAccountsPayable,
  submitAccountsPayable,
} from "@/lib/accounts-payable-api";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/utils";

export default function ContaAPagarDetailPage() {
  const params = useParams();
  const payableId = String(params.id || "");
  const { companyId } = useCompany();
  const { canEditScreen, canDeleteScreen, isAdmin } = useAccess();
  const canEdit = canEditScreen("financeiro.contas-a-pagar");
  const canDelete = canDeleteScreen("financeiro.contas-a-pagar");
  const supabase = useMemo(() => createClient(), []);

  const [payable, setPayable] = useState<AccountsPayableRow | null>(null);
  const [installments, setInstallments] = useState<AccountsPayableInstallment[]>([]);
  const [payments, setPayments] = useState<AccountsPayablePayment[]>([]);
  const [accounts, setAccounts] = useState<CompanyFinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [payInstallmentId, setPayInstallmentId] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("0");
  const [penalty, setPenalty] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [payMethod, setPayMethod] = useState("Pix");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    if (!companyId || !payableId) return;
    setLoading(true);
    setError(null);
    const [detail, acc] = await Promise.all([
      fetchAccountsPayableDetail(supabase, companyId, payableId),
      listFinancialAccounts(supabase, companyId, { activeOnly: true }),
    ]);
    if (detail.error) setError(detail.error);
    setPayable(detail.payable);
    setInstallments(detail.installments);
    setPayments(detail.payments);
    setAccounts(acc.rows);
    const openInst = detail.installments.find((i) => i.open_balance > 0 && i.status !== "cancelled");
    if (openInst) {
      setPayInstallmentId(openInst.id);
      setPrincipal(String(openInst.open_balance));
    }
    if (acc.rows[0]) setPayAccountId(acc.rows[0].id);
    setLoading(false);
  }, [companyId, payableId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;
  if (!payable) {
    return (
      <div className="space-y-3">
        <Alert variant="error">{error || "Título não encontrado"}</Alert>
        <Link href="/financeiro/contas-a-pagar" className="text-brand-700 underline">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/financeiro/contas-a-pagar" className="text-sm text-brand-700 underline">
            ← Contas a Pagar
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            {payable.internal_number}
          </h1>
          <p className="text-sm text-slate-600">{payable.description}</p>
        </div>
        <div className="text-right text-sm">
          <p>
            Aprovação: <strong>{AP_APPROVAL_LABELS[payable.approval_status]}</strong>
          </p>
          <p>
            Status: <strong>{AP_STATUS_LABELS[payable.status]}</strong>
          </p>
          <p>Competência: {formatDateBR(payable.competence_date)}</p>
          <p>
            Líquido {formatCurrency(payable.net_amount)} · Saldo{" "}
            {formatCurrency(payable.open_balance)}
          </p>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {payable.approval_status === "draft" || payable.approval_status === "rejected" ? (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await submitAccountsPayable(supabase, payable.id);
                setBusy(false);
                if (res.error) setError(res.error);
                else {
                  setInfo("Enviado / processado.");
                  await load();
                }
              }}
            >
              Enviar / finalizar
            </Button>
          ) : null}
          {isAdmin && payable.approval_status === "submitted" ? (
            <>
              <Button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await approveAccountsPayable(supabase, payable.id);
                  setBusy(false);
                  if (res.error) setError(res.error);
                  else {
                    setInfo("Aprovado e postado no DRE (competência).");
                    await load();
                  }
                }}
              >
                Aprovar (RPC)
              </Button>
              <Input
                label="Motivo rejeição"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className={glassField()}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !rejectNote.trim()}
                onClick={async () => {
                  setBusy(true);
                  const res = await rejectAccountsPayable(supabase, payable.id, rejectNote);
                  setBusy(false);
                  if (res.error) setError(res.error);
                  else {
                    setInfo("Rejeitado.");
                    await load();
                  }
                }}
              >
                Rejeitar
              </Button>
            </>
          ) : null}
          {payable.status !== "cancelled" && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                const reason = window.prompt("Motivo do cancelamento:");
                if (!reason?.trim()) return;
                setBusy(true);
                const res = await cancelAccountsPayable(supabase, payable.id, reason.trim());
                setBusy(false);
                if (res.error) setError(res.error);
                else {
                  setInfo("Título cancelado.");
                  await load();
                }
              }}
            >
              Cancelar título
            </Button>
          )}
          {canDelete &&
            (payable.approval_status === "draft" || payable.status === "cancelled") && (
              <Button type="button" variant="secondary" onClick={() => setDeleteOpen(true)}>
                Excluir
              </Button>
            )}
        </div>
      )}

      <Card>
        <CardHeader title="Parcelas (vencimento oficial)" />
        <CardBody className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Vencimento</th>
                <th className="py-1 pr-3">Valor</th>
                <th className="py-1 pr-3">Pago</th>
                <th className="py-1 pr-3">Saldo</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{i.installment_no}</td>
                  <td className="py-1 pr-3">{formatDateBR(i.due_date)}</td>
                  <td className="py-1 pr-3">{formatCurrency(i.amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(i.paid_amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(i.open_balance)}</td>
                  <td className="py-1">
                    {AP_INSTALLMENT_STATUS_LABELS[i.status] || i.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {canEdit &&
        payable.approval_status === "approved" &&
        payable.status !== "cancelled" &&
        payable.open_balance > 0 && (
          <Card>
            <CardHeader title="Registrar pagamento" />
            <CardBody>
              <div className={glassFilterPanel()}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <GlassSelect
                    label="Parcela"
                    value={payInstallmentId}
                    onChange={setPayInstallmentId}
                    options={installments
                      .filter((i) => i.open_balance > 0 && i.status !== "cancelled")
                      .map((i) => ({
                        value: i.id,
                        label: `#${i.installment_no} · ${formatDateBR(i.due_date)} · saldo ${formatCurrency(i.open_balance)}`,
                      }))}
                  />
                  <GlassSelect
                    label="Conta financeira"
                    value={payAccountId}
                    onChange={setPayAccountId}
                    options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                  <Input
                    label="Data pagamento"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className={glassField(true)}
                  />
                  <Input
                    label="Principal (abate saldo)"
                    value={principal}
                    onChange={(e) => setPrincipal(e.target.value)}
                    className={glassField(true)}
                  />
                  <Input
                    label="Juros"
                    value={interest}
                    onChange={(e) => setInterest(e.target.value)}
                    className={glassField()}
                  />
                  <Input
                    label="Multa"
                    value={penalty}
                    onChange={(e) => setPenalty(e.target.value)}
                    className={glassField()}
                  />
                  <Input
                    label="Desconto"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className={glassField()}
                  />
                  <Input
                    label="Forma"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className={glassField()}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Total saída = principal + juros + multa − desconto. Só o principal reduz o
                  saldo. Juros/multa/desconto ficam para relatório (DRE específico na fase
                  futura).
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    disabled={busy || !payInstallmentId || !payAccountId}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      const res = await registerApPayment(supabase, {
                        installmentId: payInstallmentId,
                        financialAccountId: payAccountId,
                        paidAt: payDate,
                        principalAmount: Number(String(principal).replace(",", ".")),
                        interestAmount: Number(String(interest).replace(",", ".")) || 0,
                        penaltyAmount: Number(String(penalty).replace(",", ".")) || 0,
                        discountAmount: Number(String(discount).replace(",", ".")) || 0,
                        paymentMethod: payMethod,
                      });
                      setBusy(false);
                      if (res.error) setError(res.error);
                      else {
                        setInfo("Pagamento registrado.");
                        await load();
                      }
                    }}
                  >
                    Confirmar pagamento
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

      <Card>
        <CardHeader title="Pagamentos" />
        <CardBody className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-1 pr-3">Data</th>
                <th className="py-1 pr-3">Principal</th>
                <th className="py-1 pr-3">Juros</th>
                <th className="py-1 pr-3">Multa</th>
                <th className="py-1 pr-3">Desc.</th>
                <th className="py-1 pr-3">Total saída</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1">Ações</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{formatDateBR(p.paid_at)}</td>
                  <td className="py-1 pr-3">{formatCurrency(p.principal_amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(p.interest_amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(p.penalty_amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(p.discount_amount)}</td>
                  <td className="py-1 pr-3">{formatCurrency(p.total_paid_amount)}</td>
                  <td className="py-1 pr-3">
                    {p.reversed_at ? `Estornado (${p.reversal_reason})` : "Ativo"}
                  </td>
                  <td className="py-1">
                    {canEdit && !p.reversed_at && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          const reason = window.prompt("Motivo do estorno:");
                          if (!reason?.trim()) return;
                          setBusy(true);
                          const res = await reverseApPayment(supabase, p.id, reason.trim());
                          setBusy(false);
                          if (res.error) setError(res.error);
                          else {
                            setInfo("Pagamento estornado.");
                            await load();
                          }
                        }}
                      >
                        Estornar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-slate-500">
                    Nenhum pagamento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <DeleteReasonModal
        open={deleteOpen}
        title="Excluir Contas a Pagar"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async ({ reasonCode, reason }) => {
          if (!companyId) return;
          const res = await softDeleteAccountsPayable(supabase, companyId, payable.id, {
            code: reasonCode,
            detail: reason,
          });
          setDeleteOpen(false);
          if (res.error) setError(res.error);
          else {
            window.location.href = "/financeiro/contas-a-pagar";
          }
        }}
      />
    </div>
  );
}

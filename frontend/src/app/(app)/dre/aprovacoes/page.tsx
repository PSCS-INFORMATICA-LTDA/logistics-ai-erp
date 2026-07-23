"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";
import {
  approveFinancialTransaction,
  deleteSubmittedFinancialTransaction,
  entrySourceLabel,
  listPendingFinancialApprovals,
  loadFinancialApprovalSettings,
  rejectFinancialTransaction,
  saveFinancialApprovalSettings,
  type ApproverMode,
  type PendingApprovalRow,
} from "@/lib/financial-approval";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

function formatDate(value: string): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DreAprovacoesPage() {
  const { companyId } = useCompany();
  const { isAdmin, loading: accessLoading } = useAccess();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<PendingApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [needMaster, setNeedMaster] = useState(false);

  const [approverMode, setApproverMode] = useState<ApproverMode>("admin_or_master");
  const [autoBelow, setAutoBelow] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    setLoading(true);
    setError(null);
    const [pending, settings] = await Promise.all([
      listPendingFinancialApprovals(supabase, companyId),
      loadFinancialApprovalSettings(supabase, companyId),
    ]);
    if (pending.error) setError(pending.error);
    setRows(pending.rows);
    setApproverMode(settings.approver_mode);
    setAutoBelow(
      settings.auto_approve_below_amount == null
        ? ""
        : String(settings.auto_approve_below_amount)
    );
    setLoading(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const unlocked = Boolean(user?.id && isMasterSessionUnlocked(companyId, user.id));
    setNeedMaster(settings.approver_mode === "master_only" && !unlocked);
  }, [companyId, isAdmin, supabase]);

  useEffect(() => {
    if (accessLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
  }, [accessLoading, isAdmin, load]);

  if (accessLoading || !companyId) return <Loading />;

  if (!isAdmin) {
    return (
      <Alert variant="warning">
        Aprovações de lançamentos disponíveis para administradores da empresa (e Senha Máster,
        conforme parâmetro).
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Aprovações de lançamentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Despesas manuais (empresa / veículo) aguardando aprovação. Frete concluído, pagamento ao
          motorista e receitas de OS/pátio entram aprovados automaticamente. Lançamento errado:
          use Excluir (vai para o{" "}
          <Link
            href="/configuracoes/historico-exclusoes"
            className="font-medium text-brand-700 underline"
          >
            Histórico de Exclusões
          </Link>
          ).
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="info">
          {msg}{" "}
          {msg.toLowerCase().includes("exclu") ? (
            <Link
              href="/configuracoes/historico-exclusoes"
              className="font-medium text-brand-700 underline"
            >
              Abrir histórico
            </Link>
          ) : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Parâmetros de alçada"
          description="Default: tudo exige aprovação até configurar um valor de auto-aprovação."
        />
        <CardBody className="space-y-3">
          <div className={`grid gap-3 sm:grid-cols-2 ${glassFilterPanel()}`}>
            <GlassSelect
              label="Quem pode aprovar"
              value={approverMode}
              onChange={(v) => setApproverMode(v as ApproverMode)}
              options={[
                { value: "admin", label: "Somente Admin" },
                { value: "admin_or_master", label: "Admin ou Senha Máster" },
                { value: "master_only", label: "Somente Senha Máster" },
              ]}
            />
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">
                Auto-aprovar até (R$) — vazio = sem auto
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                className={glassField(false)}
                value={autoBelow}
                placeholder="Ex.: 200"
                onChange={(e) => setAutoBelow(e.target.value)}
              />
            </label>
          </div>
          <Button
            type="button"
            disabled={savingSettings}
            onClick={() => {
              void (async () => {
                setSavingSettings(true);
                setError(null);
                setMsg(null);
                const parsed =
                  autoBelow.trim() === "" ? null : Number(autoBelow.replace(",", "."));
                if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
                  setError("Informe um valor de auto-aprovação válido ou deixe vazio.");
                  setSavingSettings(false);
                  return;
                }
                const result = await saveFinancialApprovalSettings(supabase, companyId, {
                  approverMode,
                  autoApproveBelowAmount: parsed,
                });
                setSavingSettings(false);
                if (result.error) {
                  setError(
                    result.error.includes("does not exist") || result.error.includes("não existe")
                      ? "Aplique o SQL apply-056-financial-approval.sql no Supabase."
                      : result.error
                  );
                  return;
                }
                setMsg("Parâmetros salvos.");
                await load();
              })();
            }}
          >
            {savingSettings ? "Salvando…" : "Salvar parâmetros"}
          </Button>
        </CardBody>
      </Card>

      {needMaster ? (
        <label className="block max-w-md space-y-1">
          <span className="text-sm font-medium text-slate-700">Senha Máster (modo atual)</span>
          <input
            type="password"
            className={glassField(true)}
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            placeholder="Necessária para aprovar/rejeitar"
          />
        </label>
      ) : null}

      {loading ? <Loading /> : null}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-2 py-2">Data</th>
              <th className="whitespace-nowrap px-2 py-2">Quem</th>
              <th className="whitespace-nowrap px-2 py-2">Origem</th>
              <th className="min-w-[7.5rem] px-2 py-2">Conta DRE</th>
              <th className="whitespace-nowrap px-2 py-2">Placa</th>
              <th className="px-2 py-2">Descrição</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Valor</th>
              <th className="whitespace-nowrap px-2 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 align-middle">
                <td
                  className="whitespace-nowrap px-2 py-2 font-medium text-slate-900"
                  title={
                    row.submitted_at
                      ? `Enviado ${formatSubmittedAt(row.submitted_at)}`
                      : undefined
                  }
                >
                  {formatDate(row.transaction_date)}
                </td>
                <td
                  className="max-w-[7rem] truncate px-2 py-2 text-slate-700"
                  title={row.submitted_by_name || undefined}
                >
                  {row.submitted_by_name || (
                    <span className="text-slate-400">{row.submitted_by ? "—" : "—"}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-slate-600">
                  {entrySourceLabel(row.entry_source)}
                </td>
                <td className="px-2 py-2">
                  <div
                    className="font-semibold leading-snug text-slate-900"
                    title={
                      [row.dre_account_name, row.classification, row.transaction_type]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  >
                    {row.dre_account_name || (
                      <span className="font-normal text-amber-700">Sem conta</span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                  {row.plate || <span className="text-slate-400">—</span>}
                </td>
                <td
                  className="max-w-[10rem] truncate px-2 py-2 text-slate-700"
                  title={row.description || undefined}
                >
                  {row.description || "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-medium text-slate-900">
                  {formatCurrency(row.amount)}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-nowrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="moss"
                      className="shrink-0 !px-2.5 !py-1 text-xs"
                      disabled={busyId === row.id}
                      onClick={() => {
                        void (async () => {
                          setBusyId(row.id);
                          setError(null);
                          setMsg(null);
                          const result = await approveFinancialTransaction({
                            supabase,
                            companyId,
                            transactionId: row.id,
                            isAdmin,
                            masterPassword: needMaster ? masterPassword : undefined,
                          });
                          setBusyId(null);
                          if (result.error) {
                            setError(result.error);
                            return;
                          }
                          setMsg("Lançamento aprovado. Passa a contar no DRE/dashboard.");
                          await load();
                        })();
                      }}
                    >
                      Aprovar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      className="shrink-0 !px-2.5 !py-1 text-xs"
                      disabled={busyId === row.id || deleting}
                      onClick={() => {
                        setRejectId(row.id);
                        setRejectNote("");
                      }}
                    >
                      Rejeitar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ink"
                      className="shrink-0 !px-2.5 !py-1 text-xs"
                      disabled={busyId === row.id || deleting}
                      onClick={() => {
                        setError(null);
                        setMsg(null);
                        setPendingDeleteId(row.id);
                      }}
                      title="Remove o lançamento e registra no Histórico de Exclusões"
                    >
                      Excluir
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Nenhum lançamento pendente. Se acabou de aplicar o SQL 056, novos manuais
                  aparecerão aqui.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {rejectId ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Rejeitar lançamento</h2>
            <p className="mt-1 text-sm text-slate-600">
              Mantém o registro como rejeitado (não entra no DRE). Para apagar de vez, use Excluir.
            </p>
            <textarea
              className={`${glassField(true)} mt-3 min-h-[6rem] resize-y`}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Ex.: valor incorreto · conta DRE errada · solicitação do sócio"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRejectId(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busyId === rejectId}
                onClick={() => {
                  void (async () => {
                    setBusyId(rejectId);
                    setError(null);
                    const result = await rejectFinancialTransaction({
                      supabase,
                      companyId,
                      transactionId: rejectId,
                      isAdmin,
                      masterPassword: needMaster ? masterPassword : undefined,
                      note: rejectNote,
                    });
                    setBusyId(null);
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    setRejectId(null);
                    setMsg("Lançamento rejeitado. Não entra no resultado.");
                    await load();
                  })();
                }}
              >
                Confirmar rejeição
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        title="Excluir lançamento pendente"
        description="Use quando o lançamento foi criado errado. O registro sai da fila e fica no Histórico de Exclusões (com possibilidade de restauração)."
        critical
        confirming={deleting}
        confirmLabel="Excluir e registrar"
        onCancel={() => {
          if (deleting) return;
          setPendingDeleteId(null);
        }}
        onConfirm={async (payload) => {
          if (!companyId || !pendingDeleteId) return;
          setDeleting(true);
          setError(null);
          setMsg(null);
          const deleteId = pendingDeleteId;
          const result = await deleteSubmittedFinancialTransaction({
            supabase,
            companyId,
            transactionId: deleteId,
            reason: payload.reason,
            reasonCode: payload.reasonCode,
          });
          if (result.error) {
            setDeleting(false);
            setError(result.error);
            return;
          }
          await enqueueDeletionAlert({
            supabase,
            companyId,
            alertType: "critical_deleted",
            title: "Exclusão: lançamento pendente de aprovação",
            body: `Lançamento excluído na fila de aprovações. Motivo: ${payload.reason}`,
            entityType: "financial_transactions",
            entityId: deleteId,
          });
          setDeleting(false);
          setPendingDeleteId(null);
          setMsg("Lançamento excluído e registrado no histórico.");
          await load();
        }}
      />
    </div>
  );
}

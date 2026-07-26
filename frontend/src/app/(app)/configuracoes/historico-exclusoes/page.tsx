"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { APP_SCREENS } from "@/lib/app-screens";
import { useCompany } from "@/lib/company-context";
import {
  canRestoreDeletionEvent,
  DELETION_REASON_OPTIONS,
  detectAbnormalDeletions,
  entityTypeLabel,
  exportDeletionAuditExcel,
  formatSnapshotLines,
  listDeletionAuditEvents,
  restoreDeletedFromAudit,
  type DeletionAuditEvent,
} from "@/lib/deletion-audit";
import {
  approveDeletionApprovalRequest,
  listPendingDeletionApprovals,
  rejectDeletionApprovalRequest,
  type DeletionApprovalRequest,
} from "@/lib/deletion-approvals";
import {
  listDeletionAlerts,
  markDeletionAlertRead,
  type DeletionAlert,
} from "@/lib/deletion-alerts";
import { glassAction, glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { formatDateBR } from "@/lib/utils";

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function screenLabel(screenKey: string | null): string {
  if (!screenKey) return "—";
  return APP_SCREENS.find((s) => s.key === screenKey)?.label ?? screenKey;
}

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "Todos os módulos" },
  { value: "clients", label: "Cliente" },
  { value: "suppliers", label: "Fornecedor" },
  { value: "vehicles", label: "Veículo" },
  { value: "partners", label: "Sócio" },
  { value: "drivers", label: "Motorista" },
  { value: "service_orders", label: "Ordem de serviço" },
  { value: "traffic_infractions", label: "Infração" },
  { value: "financial_transactions", label: "Lançamento DRE" },
  { value: "vehicle_ownership", label: "Participação" },
  { value: "chart_of_accounts", label: "Conta DRE" },
];

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export default function HistoricoExclusoesPage() {
  const { companyId, company } = useCompany();
  const { isAdmin, loading: accessLoading } = useAccess();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<DeletionAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [deleteMode, setDeleteMode] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [recordCode, setRecordCode] = useState("");
  const [reasonQuery, setReasonQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [missingHardening, setMissingHardening] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<DeletionAuditEvent | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<DeletionApprovalRequest[]>([]);
  const [alerts, setAlerts] = useState<DeletionAlert[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    setLoading(true);
    setError(null);
    setMissingHardening(false);
    const [result, approvals, alertRows] = await Promise.all([
      listDeletionAuditEvents(supabase, companyId, {
        entityType: entityType || null,
        fromDate: fromDate || null,
        toDate: toDate || null,
        deleteMode: deleteMode === "soft" || deleteMode === "hard" ? deleteMode : null,
        restored: statusFilter === "restored" ? true : statusFilter === "deleted" ? false : null,
        reasonCode: reasonCode || null,
        actorQuery: actorQuery || null,
        recordCode: recordCode || null,
        reasonQuery: reasonQuery || null,
        limit: 500,
      }),
      listPendingDeletionApprovals(supabase, companyId),
      listDeletionAlerts(supabase, companyId, { limit: 20 }),
    ]);
    if (result.error) setError(result.error);
    if (approvals.error) setError(approvals.error);
    if (alertRows.error) setError(alertRows.error);
    setMissingHardening(Boolean(result.missingHardening));
    setRows(result.rows);
    setPendingApprovals(approvals.rows);
    setAlerts(alertRows.rows);
    setLoading(false);
  }, [
    actorQuery,
    companyId,
    deleteMode,
    entityType,
    fromDate,
    isAdmin,
    reasonCode,
    reasonQuery,
    recordCode,
    statusFilter,
    supabase,
    toDate,
  ]);

  useEffect(() => {
    if (accessLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
  }, [accessLoading, isAdmin, load]);

  const abnormalAlerts = useMemo(() => detectAbnormalDeletions(rows), [rows]);

  if (accessLoading || !companyId) return <Loading />;

  if (!isAdmin) {
    return (
      <Alert variant="warning">
        Histórico de Exclusões disponível apenas para administradores da empresa.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Histórico de Exclusões</h1>
          <p className="mt-1 text-sm text-slate-500">
            Auditoria imutável: aprovação de críticos, snapshot, restauração soft/hard e alertas.
            {company?.trade_name || company?.name
              ? ` Empresa: ${company.trade_name || company.name}.`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={loading || exporting || rows.length === 0}
          onClick={() => {
            void (async () => {
              setExporting(true);
              setError(null);
              try {
                await exportDeletionAuditExcel(rows);
                setMsg("Excel gerado.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Falha ao exportar Excel.");
              } finally {
                setExporting(false);
              }
            })();
          }}
        >
          {exporting ? "Exportando…" : "Exportar Excel"}
        </Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}
      {missingHardening ? (
        <Alert variant="warning">
          Colunas de restauração / motivo padronizado ainda não existem no Supabase. Rode no SQL
          Editor:{" "}
          <code className="text-xs">apply-054-deletion-audit-hardening.sql</code> e{" "}
          <code className="text-xs">apply-055-deletion-approval-hard-restore-alerts.sql</code>.
        </Alert>
      ) : null}

      {abnormalAlerts.length > 0 ? (
        <Alert variant="warning">
          <p className="font-medium">Possíveis exclusões anormais (últimas 24h no filtro atual):</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {abnormalAlerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {pendingApprovals.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="text-sm font-semibold text-amber-950">
            Pedidos de exclusão pendentes ({pendingApprovals.length})
          </h2>
          <div className="space-y-2">
            {pendingApprovals.map((req) => (
              <div
                key={req.id}
                className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">
                    {entityTypeLabel(req.entity_type)} · {req.entity_code || req.summary || req.entity_id}
                  </p>
                  <p className="text-slate-600">
                    Solicitado por {req.requested_by_name || req.requested_by_email || "—"} em{" "}
                    {formatOccurredAt(req.requested_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">{req.reason}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={reviewingId === req.id}
                    onClick={() => {
                      void (async () => {
                        setReviewingId(req.id);
                        setError(null);
                        const result = await approveDeletionApprovalRequest({
                          supabase,
                          companyId,
                          request: req,
                        });
                        setReviewingId(null);
                        if (result.error) {
                          setError(result.error);
                          return;
                        }
                        setMsg("Pedido aprovado e exclusão executada.");
                        await load();
                      })();
                    }}
                  >
                    Aprovar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={reviewingId === req.id}
                    onClick={() => {
                      void (async () => {
                        setReviewingId(req.id);
                        setError(null);
                        const result = await rejectDeletionApprovalRequest({
                          supabase,
                          companyId,
                          requestId: req.id,
                        });
                        setReviewingId(null);
                        if (result.error) {
                          setError(result.error);
                          return;
                        }
                        setMsg("Pedido rejeitado. Registro permanece ativo.");
                        await load();
                      })();
                    }}
                  >
                    Rejeitar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {alerts.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Alertas de auditoria</h2>
          <p className="text-xs text-slate-500">
            In-app sempre. E-mail aos admins quando `RESEND_API_KEY` estiver na Vercel (senão fica
            skipped).
          </p>
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  alert.read_at ? "border-slate-100 bg-slate-50 text-slate-600" : "border-slate-200"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{alert.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{alert.body}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatOccurredAt(alert.created_at)} · e-mail: {alert.email_status}
                    </p>
                  </div>
                  {!alert.read_at ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void (async () => {
                          await markDeletionAlertRead(supabase, companyId, alert.id);
                          await load();
                        })();
                      }}
                    >
                      Marcar lido
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`space-y-3 ${glassFilterPanel()}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GlassSelect
            label="Módulo"
            value={entityType}
            onChange={setEntityType}
            options={ENTITY_TYPE_OPTIONS}
          />
          <GlassSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "", label: "Todos" },
              { value: "deleted", label: "Excluído" },
              { value: "restored", label: "Restaurado" },
            ]}
          />
          <GlassSelect
            label="Modo"
            value={deleteMode}
            onChange={setDeleteMode}
            options={[
              { value: "", label: "Soft e Hard" },
              { value: "soft", label: "Soft" },
              { value: "hard", label: "Hard" },
            ]}
          />
          <GlassSelect
            label="Motivo (código)"
            value={reasonCode}
            onChange={setReasonCode}
            options={[
              { value: "", label: "Todos os motivos" },
              ...DELETION_REASON_OPTIONS.map((o) => ({ value: o.code, label: o.label })),
            ]}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Data inicial</span>
            <input
              type="date"
              className={glassField(false)}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Data final</span>
            <input
              type="date"
              className={glassField(false)}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Usuário</span>
            <input
              type="search"
              className={glassField(false)}
              value={actorQuery}
              placeholder="Nome ou e-mail"
              onChange={(e) => setActorQuery(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Código do registro</span>
            <input
              type="search"
              className={glassField(false)}
              value={recordCode}
              placeholder="Ex.: 00000001"
              onChange={(e) => setRecordCode(e.target.value)}
            />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Texto do motivo</span>
            <input
              type="search"
              className={glassField(false)}
              value={reasonQuery}
              placeholder="Buscar na observação"
              onChange={(e) => setReasonQuery(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button type="button" onClick={() => void load()} disabled={loading}>
              Filtrar
            </Button>
          </div>
        </div>
      </section>

      {loading ? <Loading /> : null}

      <DataTableScroll stickyLast compact>
        <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sm:text-xs">
            <tr>
              <th className="px-1.5 py-2">Data / hora</th>
              <th className="hidden px-1.5 py-2 md:table-cell">Usuário</th>
              <th className="hidden px-1.5 py-2 lg:table-cell">Tela</th>
              <th className="hidden px-1.5 py-2 lg:table-cell">Módulo</th>
              <th className="px-1.5 py-2">Código</th>
              <th className="hidden px-1.5 py-2 xl:table-cell">Resumo</th>
              <th className="hidden px-1.5 py-2 xl:table-cell">Motivo</th>
              <th className="hidden px-1.5 py-2 md:table-cell">Modo</th>
              <th className="px-1.5 py-2">Status</th>
              <th className="px-1.5 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const restorable = canRestoreDeletionEvent(row);
              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-1.5 py-1.5 font-medium text-slate-900">
                      {formatOccurredAt(row.occurred_at)}
                    </td>
                    <td className="hidden px-1.5 py-1.5 md:table-cell">
                      <div className="max-w-[8rem] truncate font-medium text-slate-900 sm:max-w-[12rem]" title={row.actor_name || undefined}>
                        {row.actor_name || "—"}
                      </div>
                      {row.actor_email ? (
                        <div className="truncate text-[10px] text-slate-500 sm:text-xs">{row.actor_email}</div>
                      ) : null}
                    </td>
                    <td className="hidden px-1.5 py-1.5 lg:table-cell">{screenLabel(row.screen_key)}</td>
                    <td className="hidden px-1.5 py-1.5 lg:table-cell">{entityTypeLabel(row.entity_type)}</td>
                    <td className="px-1.5 py-1.5">
                      {row.entity_code ? (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{row.entity_code}</span>
                          <button
                            type="button"
                            className={glassAction("brand", true)}
                            onClick={() => {
                              void copyText(row.entity_code!).then((ok) => {
                                setMsg(ok ? "Código copiado." : "Não foi possível copiar.");
                              });
                            }}
                          >
                            Copiar
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="hidden max-w-xs truncate px-1.5 py-1.5 text-slate-700 xl:table-cell" title={row.summary ?? undefined}>
                      {row.summary || "—"}
                    </td>
                    <td className="hidden max-w-[8rem] truncate px-1.5 py-1.5 xl:table-cell sm:max-w-md">
                      {row.reason ? (
                        <p className="truncate font-medium text-slate-900" title={row.reason}>
                          {row.reason}
                        </p>
                      ) : (
                        <span className="text-slate-400">Sem observação</span>
                      )}
                    </td>
                    <td className="hidden px-1.5 py-1.5 md:table-cell">
                      <Badge variant={row.delete_mode === "soft" ? "warning" : "danger"}>
                        {row.delete_mode === "soft" ? "Soft" : "Hard"}
                      </Badge>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <Badge variant={row.restored ? "success" : "danger"}>
                        {row.restored ? "Restaurado" : "Excluído"}
                      </Badge>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <div className="os-row-actions flex flex-col gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="action-icon-btn"
                          title={expandedId === row.id ? "Ocultar detalhe" : "Ver detalhe"}
                          onClick={() =>
                            setExpandedId((cur) => (cur === row.id ? null : row.id))
                          }
                        >
                          {expandedId === row.id ? (
                            <>
                              <span className="sm:hidden">Ocult.</span>
                              <span className="hidden sm:inline">Ocultar</span>
                            </>
                          ) : (
                            <>
                              <span className="sm:hidden">Det.</span>
                              <span className="hidden sm:inline">Detalhe</span>
                            </>
                          )}
                        </Button>
                        {restorable ? (
                          <Button
                            type="button"
                            size="sm"
                            className="action-icon-btn"
                            title={row.delete_mode === "hard" ? "Restaurar (hard)" : "Restaurar"}
                            onClick={() => {
                              setMsg(null);
                              setPendingRestore(row);
                            }}
                          >
                            <span className="sm:hidden">Rest.</span>
                            <span className="hidden sm:inline">
                              {row.delete_mode === "hard" ? "Restaurar (hard)" : "Restaurar"}
                            </span>
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expandedId === row.id ? (
                    <tr className="border-t border-slate-50 bg-slate-50/80">
                      <td colSpan={10} className="px-3 py-3">
                        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          <p>
                            <span className="font-semibold">Excluído em:</span>{" "}
                            {formatOccurredAt(row.occurred_at)}
                          </p>
                          <p className="mt-1">
                            <span className="font-semibold">Por:</span> {row.actor_name || "—"}
                            {row.actor_email ? ` (${row.actor_email})` : ""}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            <span className="font-semibold">Motivo:</span> {row.reason || "—"}
                          </p>
                          {row.restored ? (
                            <>
                              <p className="mt-2">
                                <span className="font-semibold">Restaurado em:</span>{" "}
                                {row.restored_at ? formatOccurredAt(row.restored_at) : "—"}
                              </p>
                              <p className="mt-1">
                                <span className="font-semibold">Por:</span>{" "}
                                {row.restored_by_name || "—"}
                                {row.restored_by_email ? ` (${row.restored_by_email})` : ""}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap">
                                <span className="font-semibold">Motivo da restauração:</span>{" "}
                                {row.restoration_reason || "—"}
                              </p>
                            </>
                          ) : null}
                          {restorable ? (
                            <p className="mt-2 text-xs text-amber-900">
                              {row.delete_mode === "hard"
                                ? "Exclusão hard: a restauração reinsere o snapshot. Filhos vinculados (ex.: anexos da OS) podem não voltar."
                                : "Registro soft-deleted pode ser restaurado. O histórico permanece."}
                            </p>
                          ) : null}
                        </div>

                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Conteúdo no momento da exclusão
                        </p>
                        {row.payload_json ? (
                          <dl className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                            {formatSnapshotLines(row.payload_json).map((line) => (
                              <div key={`${row.id}-${line.label}`}>
                                <dt className="text-xs font-medium text-slate-500">{line.label}</dt>
                                <dd className="text-sm text-slate-900">{line.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="mb-3 text-sm text-slate-500">
                            Snapshot não disponível neste evento.
                          </p>
                        )}

                        {row.payload_json ? (
                          <details className="text-xs text-slate-600">
                            <summary className="cursor-pointer font-medium text-slate-700">
                              JSON técnico
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(row.payload_json, null, 2)}
                            </pre>
                          </details>
                        ) : null}

                        <p className="mt-2 text-xs text-slate-500">
                          ID: {row.entity_id}
                          {row.payload_json &&
                          typeof (row.payload_json as { created_at?: string }).created_at ===
                            "string"
                            ? ` · Criado em ${formatDateBR(
                                (row.payload_json as { created_at: string }).created_at
                              )}`
                            : ""}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  Nenhuma exclusão registrada com estes filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DataTableScroll>

      <DeleteReasonModal
        open={Boolean(pendingRestore)}
        confirming={restoring}
        useReasonCodes={false}
        title={
          pendingRestore?.delete_mode === "hard"
            ? "Restaurar exclusão hard (snapshot)"
            : "Restaurar registro"
        }
        description={
          pendingRestore?.delete_mode === "hard"
            ? "O sistema reinsere o registro a partir do snapshot. O evento de exclusão permanece com status Restaurado."
            : "O cadastro volta à lista ativa. O evento de exclusão permanece no histórico (imutável), com status Restaurado."
        }
        confirmLabel="Restaurar com registro"
        onCancel={() => {
          if (!restoring) setPendingRestore(null);
        }}
        onConfirm={async (payload) => {
          if (!pendingRestore) return;
          setRestoring(true);
          setError(null);
          setMsg(null);
          const result = await restoreDeletedFromAudit(
            supabase,
            pendingRestore.id,
            payload.reason
          );
          setRestoring(false);
          if (result.error) {
            setError(result.error);
            return;
          }
          setPendingRestore(null);
          setMsg("Registro restaurado. O histórico de exclusão foi mantido.");
          await load();
        }}
      />
    </div>
  );
}

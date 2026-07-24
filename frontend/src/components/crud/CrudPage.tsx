"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import {
  formatDuplicateCodeError,
  isEntityCodeTaken,
  isUniqueConstraintError,
} from "@/lib/codes";
import {
  CRITICAL_DELETE_ENTITY_TYPES,
  entityTypeLabel,
  recordDeletion,
  summarizeDeletedRow,
} from "@/lib/deletion-audit";
import { createDeletionApprovalRequest } from "@/lib/deletion-approvals";
import { enqueueDeletionAlert } from "@/lib/deletion-alerts";
import { assertCriticalDeleteGate } from "@/lib/deletion-gate";
import { isMasterSessionUnlocked } from "@/lib/master-password";
import {
  documentFieldForTable,
  documentLabelForDigits,
  formatDuplicateDocumentError,
  formatDuplicatePlateError,
  isPartyDocumentTaken,
  isVehiclePlateTaken,
} from "@/lib/party-document-uniqueness";
import { dataTableScroll } from "@/lib/liquid-glass-styles";
import { formatDisplayValueBR, normalizePlate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Loading, Alert } from "@/components/ui/Badge";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";

export type Column<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Classes no <th>/<td> (ex.: hidden xl:table-cell para caber em 100%). */
  className?: string;
};

type CrudPageProps<T extends { id: string }> = {
  title: string;
  description?: string;
  table: string;
  columns: Column<T>[];
  renderForm: (props: {
    item: Partial<T> | null;
    onSave: (data: Record<string, unknown>) => Promise<string | null>;
    onCancel: () => void;
    saving: boolean;
  }) => ReactNode;
  orderBy?: string;
  softDelete?: boolean;
  /** Chave de tela para o log de exclusão (ex.: cadastros.clientes). */
  auditScreenKey?: string;
  eqFilters?: Record<string, string>;
  toolbar?: ReactNode;
  filterItem?: (item: T) => boolean;
  transformItems?: (items: T[], companyId: string) => Promise<T[]>;
  renderRowActions?: (row: T) => ReactNode;
  /** When false, the Editar action is disabled for that row. */
  canEditRow?: (row: T) => boolean;
  editBlockedReason?: (row: T) => string | null;
  /** When false, the Excluir action is disabled for that row. */
  canDeleteRow?: (row: T) => boolean;
  deleteBlockedReason?: (row: T) => string | null;
  /** Increment to refetch rows after external mutations (e.g. RPC row actions). */
  refreshKey?: number;
  /** Abre o formulário de edição deste id após carregar (ex.: link da agenda). */
  initialEditId?: string | null;
  /** Fallback se o id não estiver na lista carregada (ex.: `?code=` da agenda). */
  initialEditCode?: string | null;
  /** Abre «Novo» com campos pré-preenchidos (ex.: placa/data da agenda). */
  initialNewDraft?: Partial<T> | null;
  /** Lista mais densa (fonte −1pt, padding menor) — útil na OS com muitas ações. */
  compactTable?: boolean;
};

export function CrudPage<T extends { id: string }>({
  title,
  description,
  table,
  columns,
  renderForm,
  orderBy = "created_at",
  softDelete = true,
  auditScreenKey,
  eqFilters,
  toolbar,
  filterItem,
  transformItems,
  renderRowActions,
  canEditRow,
  editBlockedReason,
  canDeleteRow,
  deleteBlockedReason,
  refreshKey = 0,
  initialEditId = null,
  initialEditCode = null,
  initialNewDraft = null,
  compactTable = false,
}: CrudPageProps<T>) {
  const { companyId, loading: companyLoading } = useCompany();
  const { canEditScreen, canDeleteScreen, isAdmin, loading: accessLoading } = useAccess();
  const screenCanEdit = auditScreenKey ? canEditScreen(auditScreenKey) : true;
  const screenCanDelete = auditScreenKey ? canDeleteScreen(auditScreenKey) : true;
  const isCriticalDelete = CRITICAL_DELETE_ENTITY_TYPES.has(table);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [requireMasterForDelete, setRequireMasterForDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const formPanelRef = useRef<HTMLDivElement>(null);
  const openedEditIdRef = useRef<string | null>(null);
  const openedNewDraftRef = useRef(false);
  const supabase = createClient();

  const formPanelKey = isNew ? "new" : String(editing?.id ?? "edit");

  useEffect(() => {
    if (!isNew && !editing) return;
    requestAnimationFrame(() => {
      formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
    });
  }, [formPanelKey, isNew, editing]);

  const hasLoadedItemsRef = useRef(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    // Recarga silenciosa: não trocar a tabela por <Loading /> — isso desmontava modais
    // abertos (ex.: designação) e cancelava o clique em whatsapp:// no meio do caminho.
    const silentRefresh = hasLoadedItemsRef.current;
    if (!silentRefresh) setLoading(true);
    setError(null);
    let query = supabase.from(table).select("*").eq("company_id", companyId);
    if (softDelete) query = query.is("deleted_at", null);
    if (eqFilters) {
      for (const [key, value] of Object.entries(eqFilters)) {
        query = query.eq(key, value);
      }
    }
    const { data, error: err } = await query.order(orderBy, { ascending: false });

    if (err) {
      setError(err.message);
      setItems([]);
      hasLoadedItemsRef.current = false;
    } else {
      let rows = (data as T[]) ?? [];
      if (transformItems) {
        rows = await transformItems(rows, companyId);
      }
      setItems(rows);
      hasLoadedItemsRef.current = rows.length > 0;
    }
    setLoading(false);
  }, [companyId, table, orderBy, softDelete, eqFilters, supabase, transformItems, refreshKey]);

  useEffect(() => {
    if (companyId) load();
  }, [companyId, load, refreshKey]);

  useEffect(() => {
    if ((!initialEditId && !initialEditCode) || loading || accessLoading) return;
    const openKey = initialEditId || `code:${initialEditCode}`;
    if (openedEditIdRef.current === openKey) return;
    const codeNorm = initialEditCode?.trim().toLowerCase() ?? "";
    const row =
      (initialEditId ? items.find((item) => item.id === initialEditId) : undefined) ??
      (codeNorm
        ? items.find((item) => {
            const code = (item as { code?: string | null }).code;
            return String(code ?? "")
              .trim()
              .toLowerCase() === codeNorm;
          })
        : undefined);
    if (!row) return;
    // Deep link (ex.: Agenda): sempre abre o registro certo para consulta.
    // Bloqueio de edição fica no aviso / ao salvar — não redireciona para outra OS.
    setEditing(row);
    setIsNew(false);
    openedEditIdRef.current = openKey;
    if (!screenCanEdit) {
      setInfoMsg("Seu acesso é só visualização. Peça permissão de Alteração para editar.");
    } else if (canEditRow && !canEditRow(row)) {
      setInfoMsg(editBlockedReason?.(row) ?? "Registro em consulta (edição bloqueada neste status).");
    } else {
      setInfoMsg(null);
    }
  }, [
    initialEditId,
    initialEditCode,
    items,
    loading,
    accessLoading,
    screenCanEdit,
    canEditRow,
    editBlockedReason,
  ]);

  useEffect(() => {
    if (initialEditId || !initialNewDraft || loading || accessLoading) return;
    if (openedNewDraftRef.current) return;
    if (!screenCanEdit) {
      openedNewDraftRef.current = true;
      return;
    }
    setEditing({ ...initialNewDraft });
    setIsNew(true);
    openedNewDraftRef.current = true;
  }, [initialEditId, initialNewDraft, loading, accessLoading, screenCanEdit]);

  const handleSave = async (data: Record<string, unknown>): Promise<string | null> => {
    if (!companyId) return null;
    if (!screenCanEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para salvar.");
      return null;
    }
    if (editing?.id && canEditRow && !canEditRow(editing as T)) {
      setError(editBlockedReason?.(editing as T) ?? "Este registro não pode ser alterado neste status.");
      return null;
    }
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = { ...data, company_id: companyId };
    const code = typeof payload.code === "string" ? payload.code.trim() : "";

    if (code) {
      const check = await isEntityCodeTaken(table, companyId, code, editing?.id ?? null);
      if (check.error) {
        setSaving(false);
        setError(check.error);
        return null;
      }
      if (check.taken) {
        setSaving(false);
        setError(formatDuplicateCodeError(code));
        return null;
      }
    }

    const docField = documentFieldForTable(table);
    const rawDocument =
      docField && typeof payload[docField] === "string" ? String(payload[docField]) : "";
    if (docField && rawDocument.trim()) {
      const docCheck = await isPartyDocumentTaken(
        table,
        companyId,
        rawDocument,
        editing?.id ?? null
      );
      if (docCheck.error) {
        setSaving(false);
        setError(docCheck.error);
        return null;
      }
      if (docCheck.taken) {
        setSaving(false);
        setError(formatDuplicateDocumentError(documentLabelForDigits(docCheck.digits)));
        return null;
      }
    }

    const rawPlate = table === "vehicles" && typeof payload.plate === "string" ? payload.plate : "";
    if (table === "vehicles" && rawPlate.trim()) {
      const plateCheck = await isVehiclePlateTaken(companyId, rawPlate, editing?.id ?? null);
      if (plateCheck.error) {
        setSaving(false);
        setError(plateCheck.error);
        return null;
      }
      if (plateCheck.taken) {
        setSaving(false);
        setError(formatDuplicatePlateError(plateCheck.plate));
        return null;
      }
    }

    let err;
    let savedId: string | null = null;

    if (editing?.id) {
      savedId = editing.id;
      ({ error: err } = await supabase.from(table).update(payload).eq("id", editing.id));
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from(table)
        .insert(payload)
        .select("id")
        .single();
      err = insertError;
      savedId = (inserted as { id: string } | null)?.id ?? null;
    }

    setSaving(false);
    if (err) {
      const msg = err.message;
      if (isUniqueConstraintError(msg)) {
        const lower = msg.toLowerCase();
        if (
          docField &&
          rawDocument.trim() &&
          (lower.includes("document") || lower.includes("cpf") || lower.includes("digits"))
        ) {
          setError(
            formatDuplicateDocumentError(documentLabelForDigits(rawDocument.replace(/\D/g, "")))
          );
        } else if (table === "vehicles" && (lower.includes("plate") || rawPlate.trim())) {
          setError(formatDuplicatePlateError(normalizePlate(rawPlate) || String(rawPlate)));
        } else if (code) {
          setError(formatDuplicateCodeError(code));
        } else {
          setError("Registro duplicado: já existe um cadastro com estes dados nesta empresa.");
        }
      } else {
        setError(msg);
      }
      return null;
    }
    setEditing(null);
    setIsNew(false);
    await load();
    return savedId;
  };

  const requestDelete = (id: string) => {
    if (!screenCanDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      return;
    }
    setPendingDeleteId(id);
    void (async () => {
      if (!(isCriticalDelete && isAdmin && companyId)) {
        setRequireMasterForDelete(false);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const unlocked = Boolean(
        user?.id && isMasterSessionUnlocked(companyId, user.id)
      );
      setRequireMasterForDelete(!unlocked);
    })();
  };

  const confirmDelete = async (payload: {
    reason: string;
    reasonCode: string;
    masterPassword?: string;
  }) => {
    if (!companyId || !pendingDeleteId) return;
    if (!screenCanDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      setPendingDeleteId(null);
      return;
    }

    const id = pendingDeleteId;
    setDeleting(true);
    setError(null);
    setInfoMsg(null);

    const existing = items.find((row) => row.id === id) as Record<string, unknown> | undefined;
    const { entityCode, summary } = summarizeDeletedRow(existing, table);
    const deleteMode = softDelete ? ("soft" as const) : ("hard" as const);

    if (isCriticalDelete) {
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
        const requested = await createDeletionApprovalRequest({
          supabase,
          companyId,
          entityType: table,
          entityId: id,
          entityCode,
          summary,
          screenKey: auditScreenKey ?? null,
          deleteMode,
          reason: payload.reason,
          reasonCode: payload.reasonCode,
          payload: existing ?? null,
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
          title: `Pedido de exclusão: ${entityTypeLabel(table)}`,
          body: `Há um pedido pendente de exclusão (${entityCode || summary || id}). Motivo: ${payload.reason}`,
          entityType: table,
          entityId: id,
          meta: { requestId: requested.id },
        });
        setInfoMsg(
          "Pedido enviado para aprovação do administrador. O registro permanece ativo até a aprovação."
        );
        return;
      }
    }

    const logged = await recordDeletion({
      supabase,
      companyId,
      entityType: table,
      entityId: id,
      entityCode,
      summary,
      reason: payload.reason,
      reasonCode: payload.reasonCode,
      screenKey: auditScreenKey ?? null,
      deleteMode,
      payload: existing ?? null,
    });
    if (logged.error) {
      setDeleting(false);
      setError(logged.error);
      return;
    }

    const { error: err } = softDelete
      ? await supabase
          .from(table)
          .update(
            table === "partners"
              ? { deleted_at: new Date().toISOString(), status: "Inativo" }
              : { deleted_at: new Date().toISOString() }
          )
          .eq("id", id)
      : await supabase.from(table).delete().eq("id", id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (err) {
      setError(err.message);
      return;
    }

    if (isCriticalDelete) {
      await enqueueDeletionAlert({
        supabase,
        companyId,
        alertType: "critical_deleted",
        title: `Exclusão crítica: ${entityTypeLabel(table)}`,
        body: `${entityCode || summary || id} foi excluído. Motivo: ${payload.reason}`,
        entityType: table,
        entityId: id,
      });
    }

    await load();
  };

  if (companyLoading) return <Loading />;

  const visibleItems = filterItem ? items.filter(filterItem) : items;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {!isNew && !editing && screenCanEdit ? (
          <Button className="w-full sm:w-auto" onClick={() => { setIsNew(true); setEditing({}); }}>
            + Novo
          </Button>
        ) : null}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {infoMsg ? <Alert variant="info">{infoMsg}</Alert> : null}
      {!accessLoading && auditScreenKey && !screenCanEdit ? (
        <Alert variant="info">
          Modo visualização: você pode consultar os registros, mas não criar nem alterar.
        </Alert>
      ) : null}

      {toolbar}

      {(isNew || editing) && screenCanEdit && (
        <div ref={formPanelRef} id="crud-form-panel" className="relative scroll-mt-20">
          <Card key={formPanelKey} className="overflow-visible">
            <CardHeader
              title={
                editing?.id
                  ? canEditRow && !canEditRow(editing as T)
                    ? "Consultar OS"
                    : "Editar"
                  : "Novo registro"
              }
            />
            <CardBody>
              {renderForm({
                item: editing,
                onSave: handleSave,
                onCancel: () => {
                  setEditing(null);
                  setIsNew(false);
                  setInfoMsg(null);
                },
                saving,
              })}
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardBody className="min-w-0 p-0">
          {loading ? (
            <Loading />
          ) : visibleItems.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">
              Nenhum registro encontrado.
            </p>
          ) : (
            <div
              className={dataTableScroll({
                stickyFirst: true,
                stickyLast: true,
                fitWidth: true,
                className: compactTable ? "data-table-scroll--compact" : undefined,
              })}
            >
            <table className={compactTable ? "w-full text-[11px] leading-snug sm:text-xs" : "w-full text-sm"}>
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  {columns.map((col) => (
                    <th
                      key={String(col.key)}
                      className={
                        compactTable
                          ? `truncate px-1.5 py-2 font-medium text-slate-600 sm:px-2 ${col.className ?? ""}`
                          : `whitespace-nowrap px-3 py-3 font-medium text-slate-600 sm:px-4 ${col.className ?? ""}`
                      }
                      title={col.label}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th
                    className={
                      compactTable
                        ? "px-1.5 py-2 font-medium text-slate-600 sm:px-2"
                        : "whitespace-nowrap px-3 py-3 font-medium text-slate-600 sm:px-4"
                    }
                  >
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((row) => {
                  const canEdit = screenCanEdit && (canEditRow?.(row) ?? true);
                  const editTitle = !screenCanEdit
                    ? "Somente visualização"
                    : canEdit
                      ? undefined
                      : (editBlockedReason?.(row) ?? "Edição indisponível para este registro.");
                  const canDelete = screenCanDelete && (canDeleteRow?.(row) ?? true);
                  const deleteTitle = !screenCanDelete
                    ? "Sem permissão de exclusão"
                    : canDelete
                      ? undefined
                      : (deleteBlockedReason?.(row) ?? "Exclusão indisponível para este registro.");
                  const showActions =
                    screenCanEdit || screenCanDelete || Boolean(renderRowActions);

                  return (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    {columns.map((col) => (
                      <td
                        key={String(col.key)}
                        className={
                          compactTable
                            ? `truncate px-1.5 py-1.5 text-slate-700 sm:px-2 ${col.className ?? ""}`
                            : `px-3 py-3 text-slate-700 sm:px-4 ${col.className ?? ""}`
                        }
                      >
                        {col.render
                          ? col.render(row)
                          : formatDisplayValueBR(
                              (row as Record<string, unknown>)[col.key as string]
                            )}
                      </td>
                    ))}
                    <td className={compactTable ? "px-1.5 py-1.5 sm:px-2" : "px-3 py-3 sm:px-4"}>
                      {showActions ? (
                      <div className={compactTable ? "os-row-actions flex flex-wrap gap-1" : "flex flex-wrap gap-2"}>
                        {screenCanEdit ? renderRowActions?.(row) : null}
                        {screenCanEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit}
                          title={editTitle}
                          onClick={() => {
                            if (!canEdit) return;
                            setEditing(row);
                            setIsNew(false);
                          }}
                        >
                          Editar
                        </Button>
                        ) : null}
                        {screenCanDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canDelete}
                          title={deleteTitle}
                          onClick={() => {
                            if (!canDelete) return;
                            requestDelete(row.id);
                          }}
                        >
                          Excluir
                        </Button>
                        ) : null}
                      </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </CardBody>
      </Card>

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        confirming={deleting}
        critical={isCriticalDelete}
        requireMasterPassword={requireMasterForDelete}
        confirmLabel={
          isCriticalDelete && !isAdmin
            ? "Enviar para aprovação"
            : "Excluir com registro"
        }
        title="Excluir registro"
        description={
          isCriticalDelete && !isAdmin
            ? "Este registro é crítico. O pedido ficará pendente até um administrador aprovar em Configurações → Histórico de Exclusões."
            : "Informe o motivo da exclusão. O registro sai da lista e o motivo fica no Histórico de Exclusões."
        }
        onCancel={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

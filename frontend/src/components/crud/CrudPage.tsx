"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { recordDeletion, summarizeDeletedRow } from "@/lib/deletion-audit";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Loading, Alert } from "@/components/ui/Badge";
import { DeleteReasonModal } from "@/components/ui/DeleteReasonModal";

export type Column<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => ReactNode;
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
  /** Abre «Novo» com campos pré-preenchidos (ex.: placa/data da agenda). */
  initialNewDraft?: Partial<T> | null;
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
  initialNewDraft = null,
}: CrudPageProps<T>) {
  const { companyId, loading: companyLoading } = useCompany();
  const { canEditScreen, canDeleteScreen, loading: accessLoading } = useAccess();
  const screenCanEdit = auditScreenKey ? canEditScreen(auditScreenKey) : true;
  const screenCanDelete = auditScreenKey ? canDeleteScreen(auditScreenKey) : true;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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
    if (!initialEditId || loading || accessLoading) return;
    if (openedEditIdRef.current === initialEditId) return;
    const row = items.find((item) => item.id === initialEditId);
    if (!row) return;
    if (!screenCanEdit) {
      setError("Seu acesso é só visualização. Peça permissão de Alteração para editar.");
      openedEditIdRef.current = initialEditId;
      return;
    }
    if (canEditRow && !canEditRow(row)) {
      setError(editBlockedReason?.(row) ?? "Esta OS não pode ser editada no momento.");
      openedEditIdRef.current = initialEditId;
      return;
    }
    setEditing(row);
    setIsNew(false);
    openedEditIdRef.current = initialEditId;
  }, [
    initialEditId,
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
    setSaving(true);
    setError(null);

    const payload = { ...data, company_id: companyId };

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
      setError(err.message);
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
  };

  const confirmDelete = async (reason: string) => {
    if (!companyId || !pendingDeleteId) return;
    if (!screenCanDelete) {
      setError("Seu acesso não inclui Exclusão nesta tela.");
      setPendingDeleteId(null);
      return;
    }

    const id = pendingDeleteId;
    setDeleting(true);
    setError(null);

    const existing = items.find((row) => row.id === id) as Record<string, unknown> | undefined;
    const { entityCode, summary } = summarizeDeletedRow(existing, table);
    const logged = await recordDeletion({
      supabase,
      companyId,
      entityType: table,
      entityId: id,
      entityCode,
      summary,
      reason,
      screenKey: auditScreenKey ?? null,
      deleteMode: softDelete ? "soft" : "hard",
      payload: existing ?? null,
    });
    if (logged.error) {
      setDeleting(false);
      setError(logged.error);
      return;
    }

    const { error: err } = softDelete
      ? await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id)
      : await supabase.from(table).delete().eq("id", id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (err) setError(err.message);
    else await load();
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
      {!accessLoading && auditScreenKey && !screenCanEdit ? (
        <Alert variant="info">
          Modo visualização: você pode consultar os registros, mas não criar nem alterar.
        </Alert>
      ) : null}

      {toolbar}

      {(isNew || editing) && screenCanEdit && (
        <div ref={formPanelRef} id="crud-form-panel" className="relative z-20 scroll-mt-20">
          <Card key={formPanelKey} className="overflow-visible">
            <CardHeader title={editing?.id ? "Editar" : "Novo registro"} />
            <CardBody>
              {renderForm({
                item: editing,
                onSave: handleSave,
                onCancel: () => { setEditing(null); setIsNew(false); },
                saving,
              })}
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardBody className="overflow-x-auto p-0 [-webkit-overflow-scrolling:touch]">
          {loading ? (
            <Loading />
          ) : visibleItems.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">
              Nenhum registro encontrado.
            </p>
          ) : (
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left">
                  {columns.map((col) => (
                    <th key={String(col.key)} className="whitespace-nowrap px-3 py-3 font-medium text-slate-600 sm:px-4">
                      {col.label}
                    </th>
                  ))}
                  <th className="sticky right-0 bg-slate-50 px-3 py-3 font-medium text-slate-600 sm:static sm:px-4">
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
                      <td key={String(col.key)} className="px-3 py-3 text-slate-700 sm:px-4">
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key as string] ?? "—")}
                      </td>
                    ))}
                    <td className="sticky right-0 bg-white/95 px-3 py-3 backdrop-blur-sm sm:static sm:bg-transparent sm:px-4 sm:backdrop-blur-none">
                      {showActions ? (
                      <div className="flex flex-wrap gap-2">
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
          )}
        </CardBody>
      </Card>

      <DeleteReasonModal
        open={Boolean(pendingDeleteId)}
        confirming={deleting}
        title="Excluir registro"
        description="Informe o motivo da exclusão. O registro sai da lista e o motivo fica no Histórico de Exclusões."
        onCancel={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

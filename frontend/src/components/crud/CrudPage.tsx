"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCompany } from "@/lib/company-context";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Loading, Alert } from "@/components/ui/Badge";

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
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
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
    } else {
      let rows = (data as T[]) ?? [];
      if (transformItems) {
        rows = await transformItems(rows, companyId);
      }
      setItems(rows);
    }
    setLoading(false);
  }, [companyId, table, orderBy, softDelete, eqFilters, supabase, transformItems, refreshKey]);

  useEffect(() => {
    if (companyId) load();
  }, [companyId, load, refreshKey]);

  useEffect(() => {
    if (!initialEditId || loading) return;
    if (openedEditIdRef.current === initialEditId) return;
    const row = items.find((item) => item.id === initialEditId);
    if (!row) return;
    if (canEditRow && !canEditRow(row)) {
      setError(editBlockedReason?.(row) ?? "Esta OS não pode ser editada no momento.");
      openedEditIdRef.current = initialEditId;
      return;
    }
    setEditing(row);
    setIsNew(false);
    openedEditIdRef.current = initialEditId;
  }, [initialEditId, items, loading, canEditRow, editBlockedReason]);

  useEffect(() => {
    if (initialEditId || !initialNewDraft || loading) return;
    if (openedNewDraftRef.current) return;
    setEditing({ ...initialNewDraft });
    setIsNew(true);
    openedNewDraftRef.current = true;
  }, [initialEditId, initialNewDraft, loading]);

  const handleSave = async (data: Record<string, unknown>): Promise<string | null> => {
    if (!companyId) return null;
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

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja excluir este registro?")) return;
    const { error: err } = softDelete
      ? await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id)
      : await supabase.from(table).delete().eq("id", id);
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
        {!isNew && !editing && (
          <Button className="w-full sm:w-auto" onClick={() => { setIsNew(true); setEditing({}); }}>
            + Novo
          </Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {toolbar}

      {(isNew || editing) && (
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
                  const canEdit = canEditRow?.(row) ?? true;
                  const editTitle = canEdit
                    ? undefined
                    : (editBlockedReason?.(row) ?? "Edição indisponível para este registro.");
                  const canDelete = canDeleteRow?.(row) ?? true;
                  const deleteTitle = canDelete
                    ? undefined
                    : (deleteBlockedReason?.(row) ?? "Exclusão indisponível para este registro.");

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
                      <div className="flex flex-wrap gap-2">
                        {renderRowActions?.(row)}
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
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canDelete}
                          title={deleteTitle}
                          onClick={() => {
                            if (!canDelete) return;
                            void handleDelete(row.id);
                          }}
                        >
                          Excluir
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComplianceDocumentClip } from "@/components/compliance/ComplianceDocumentClip";
import {
  attachComplianceFile,
  ComplianceDocumentEditor,
} from "@/components/compliance/ComplianceDocumentEditor";
import { ComplianceDocumentHistory } from "@/components/compliance/ComplianceDocumentHistory";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  documentDisplayName,
  resolveComplianceSituation,
  type ComplianceDocument,
  type DocumentType,
} from "@/lib/compliance-documents";
import {
  createComplianceDocument,
  listDocumentVersions,
  listVehicleFleetDocuments,
  renewComplianceDocument,
  syncComplianceAlerts,
  updateComplianceDocument,
  type ComplianceDocInput,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
import { GroupedTableBodies } from "@/components/ui/GroupedTableBodies";
import { groupByKeySorted } from "@/lib/table-row-groups";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type VehicleOption = {
  id: string;
  plate: string;
  code: string | null;
  /** Cadastro do veículo — campo “Marca / modelo”. */
  brandModel: string | null;
};

type Props = {
  companyId: string;
  vehicleTypes: DocumentType[];
  canEdit?: boolean;
};

export function FleetComplianceDocumentsPanel({
  companyId,
  vehicleTypes,
  canEdit = true,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [docs, setDocs] = useState<ComplianceDocument[]>([]);
  const [plateFilter, setPlateFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [clipRefresh, setClipRefresh] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit" | "renew";
    doc?: ComplianceDocument | null;
    vehicleId: string;
  } | null>(null);
  const [historyVersions, setHistoryVersions] = useState<ComplianceDocument[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRootId, setHistoryRootId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [vehRes, docsRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id, plate, code, model, deleted_at")
        .eq("company_id", companyId)
        .order("plate", { ascending: true }),
      listVehicleFleetDocuments(supabase, companyId),
    ]);
    if (vehRes.error) setError(vehRes.error.message);
    if (docsRes.error) setError(docsRes.error);
    setVehicles(
      (vehRes.data ?? [])
        .filter((v) => v.deleted_at == null)
        .map((v) => ({
          id: String(v.id),
          plate: String(v.plate ?? ""),
          code: v.code == null ? null : String(v.code),
          brandModel: v.model == null || String(v.model).trim() === "" ? null : String(v.model).trim(),
        }))
    );
    setDocs(docsRes.rows);
    await syncComplianceAlerts(supabase, companyId, docsRes.rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [load, supabase.auth]);

  const vehicleById = useMemo(() => {
    const map = new Map<string, VehicleOption>();
    for (const v of vehicles) map.set(v.id, v);
    return map;
  }, [vehicles]);

  const formatVehicleLabel = (v: VehicleOption) => {
    const parts = [v.plate || "Sem placa"];
    if (v.brandModel) parts.push(v.brandModel);
    if (v.code) parts.push(v.code);
    return parts.join(" · ");
  };

  const vehicleOptions = useMemo(() => {
    const labelOf = (v: VehicleOption) => {
      const parts = [v.plate || "Sem placa"];
      if (v.brandModel) parts.push(v.brandModel);
      if (v.code) parts.push(v.code);
      return parts.join(" · ");
    };
    return [
      { value: "", label: "Selecione a placa (marca / modelo)" },
      ...vehicles.map((v) => ({
        value: v.id,
        label: labelOf(v),
      })),
    ];
  }, [vehicles]);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (plateFilter && d.owner_id !== plateFilter) return false;
      if (typeFilter && d.document_type_id !== typeFilter) return false;
      return d.document_type?.is_active !== false;
    });
  }, [docs, plateFilter, typeFilter]);

  const docGroups = useMemo(
    () =>
      groupByKeySorted(
        filtered,
        (doc) => doc.owner_id,
        (a, b) => documentDisplayName(a.document_type).localeCompare(
          documentDisplayName(b.document_type),
          "pt-BR"
        )
      ),
    [filtered]
  );

  const openHistory = async (doc: ComplianceDocument) => {
    const root = doc.root_id ?? doc.id;
    setHistoryRootId(root);
    setHistoryLoading(true);
    const res = await listDocumentVersions(supabase, companyId, root);
    setHistoryVersions(res.rows);
    setHistoryLoading(false);
    if (res.error) setError(res.error);
  };

  const saveEditor = async (
    input: ComplianceDocInput,
    file?: File | null,
    opts?: { andNew?: boolean }
  ) => {
    if (!editor) return "Editor indisponível.";
    if (!editor.vehicleId) return "Selecione a placa do veículo.";
    const keepPlate = editor.vehicleId;

    if (editor.mode === "create") {
      const { id, error: err } = await createComplianceDocument(
        supabase,
        companyId,
        "vehicle",
        editor.vehicleId,
        input,
        userId
      );
      if (err || !id) return err ?? "Falha ao criar";
      if (file) {
        const up = await attachComplianceFile(companyId, id, file);
        if (up) return up;
      }
    } else if (editor.mode === "edit" && editor.doc) {
      const err = await updateComplianceDocument(
        supabase,
        companyId,
        editor.doc.id,
        input,
        userId
      );
      if (err) return err;
      if (file) {
        const up = await attachComplianceFile(companyId, editor.doc.id, file);
        if (up) return up;
      }
    } else if (editor.mode === "renew" && editor.doc) {
      const { id, error: err } = await renewComplianceDocument(
        supabase,
        companyId,
        editor.doc,
        input,
        userId
      );
      if (err || !id) return err ?? "Falha ao renovar";
      if (file) {
        const up = await attachComplianceFile(companyId, id, file);
        if (up) return up;
      }
    }

    setClipRefresh((k) => k + 1);
    await load();
    if (opts?.andNew && editor.mode === "create") {
      setEditor({ mode: "create", doc: null, vehicleId: keepPlate });
      setPlateFilter(keepPlate);
      return null;
    }
    setEditor(null);
    return null;
  };

  if (loading) return <Loading />;

  const activeTypes = vehicleTypes.filter((t) => t.is_active);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        Fluxo: escolha a placa → tipo (Prefixo, CVS, ANTT…) → vencimento → clipe → Salvar.
        Para vários tipos na mesma placa use &quot;Salvar e próximo tipo&quot;. Depois confira em
        Operacional → Documentos a vencer.
      </Alert>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={`grid gap-3 sm:grid-cols-3 ${glassFilterPanel()}`}>
        <GlassSelect
          label="Filtrar por placa / veículo"
          value={plateFilter}
          onChange={setPlateFilter}
          options={[
            { value: "", label: "Todas as placas" },
            ...vehicles.map((v) => ({ value: v.id, label: formatVehicleLabel(v) })),
          ]}
        />
        <GlassSelect
          label="Filtrar tipo"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "", label: "Todos os tipos" },
            ...activeTypes.map((t) => ({
              value: t.id,
              label: t.acronym ? `${t.acronym} — ${t.name}` : t.name,
            })),
          ]}
        />
        <div className="flex items-end justify-end">
          {canEdit ? (
            <Button
              type="button"
              onClick={() =>
                setEditor({
                  mode: "create",
                  doc: null,
                  vehicleId: plateFilter || "",
                })
              }
            >
              Novo documento por placa
            </Button>
          ) : null}
        </div>
      </div>

      {editor ? (
        <ComplianceDocumentEditor
          companyId={companyId}
          types={activeTypes}
          initial={editor.doc}
          mode={editor.mode}
          allowSaveAndNew
          leadingSlot={
            <div className="space-y-2">
              <GlassSelect
                label="Placa do veículo (marca / modelo)"
                value={editor.vehicleId}
                onChange={(v) => setEditor((e) => (e ? { ...e, vehicleId: v } : e))}
                disabled={editor.mode !== "create"}
                options={vehicleOptions}
              />
              {!editor.vehicleId && editor.mode === "create" ? (
                <Alert variant="warning">
                  Selecione a placa do veículo (com marca / modelo) antes de salvar.
                </Alert>
              ) : null}
            </div>
          }
          onCancel={() => setEditor(null)}
          onSave={saveEditor}
        />
      ) : null}

      <div className={glassFilterPanel()}>
        {filtered.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">
            Nenhum documento ainda. Clique em &quot;Novo documento por placa&quot;,
            selecione a placa (marca / modelo) e anexe a digitalização no formulário.
            O ícone de clipe aparece na coluna Anexo depois que o documento for salvo.
          </p>
        ) : (
          <>
            {/* Mobile: cartão legível por documento. */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((doc) => {
                const view = resolveComplianceSituation(doc, doc.document_type);
                const veh = vehicleById.get(doc.owner_id);
                return (
                  <li
                    key={doc.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {veh?.plate || "—"}
                        </p>
                        {veh?.brandModel ? (
                          <p className="text-sm text-slate-600">{veh.brandModel}</p>
                        ) : null}
                        <p className="mt-1 text-base font-semibold leading-snug break-words text-slate-900">
                          {documentDisplayName(doc.document_type)}
                        </p>
                      </div>
                      <Badge variant={view.badge}>{view.label}</Badge>
                    </div>

                    <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Nº</dt>
                        <dd className="break-words text-slate-800">{doc.document_number || "—"}</dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Vencimento</dt>
                        <dd className="text-slate-800">
                          {doc.no_expiry ? "Sem vencimento" : formatExpiryDateBR(doc.expires_at)}
                        </dd>
                      </div>
                      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                        <dt className="text-xs font-medium text-slate-500">Anexo</dt>
                        <dd>
                          <ComplianceDocumentClip
                            companyId={companyId}
                            documentId={doc.id}
                            canUpload={canEdit}
                            refreshKey={clipRefresh}
                            onUploaded={() => setClipRefresh((k) => k + 1)}
                          />
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {canEdit ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            onClick={() =>
                              setEditor({
                                mode: "edit",
                                doc,
                                vehicleId: doc.owner_id,
                              })
                            }
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            onClick={() =>
                              setEditor({
                                mode: "renew",
                                doc,
                                vehicleId: doc.owner_id,
                              })
                            }
                          >
                            Renovar
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className={canEdit ? "flex-1" : "w-full"}
                        onClick={() => void openHistory(doc)}
                      >
                        Histórico
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: tabela agrupada por placa. */}
            <div className="hidden md:block">
              <DataTableScroll stickyFirst stickyLast>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Placa</th>
                      <th className="px-3 py-2.5">Marca / modelo</th>
                      <th className="px-3 py-2.5">Tipo de documento</th>
                      <th className="px-3 py-2.5">Nº</th>
                      <th className="px-3 py-2.5">Data de vencimento</th>
                      <th className="px-3 py-2.5">Situação</th>
                      <th className="px-3 py-2.5" title="Anexo da digitalização (por linha)">
                        Anexo
                      </th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <GroupedTableBodies groups={docGroups} colSpan={8}>
                    {(group) =>
                      group.rows.map((doc, index) => {
                        const view = resolveComplianceSituation(doc, doc.document_type);
                        const veh = vehicleById.get(doc.owner_id);
                        return (
                          <tr
                            key={doc.id}
                            className={group.multi ? "align-top" : "border-t border-slate-100"}
                          >
                            <td className="whitespace-nowrap px-3 py-3 font-medium">
                              {index === 0 ? (
                                veh?.plate || "—"
                              ) : group.multi ? (
                                <span className="text-slate-300" aria-hidden>
                                  ↳
                                </span>
                              ) : (
                                veh?.plate || "—"
                              )}
                            </td>
                            <td className="px-3 py-3 text-slate-700">
                              {index === 0 || !group.multi ? veh?.brandModel || "—" : ""}
                            </td>
                            <td className="px-3 py-3">
                              {documentDisplayName(doc.document_type)}
                            </td>
                            <td className="px-3 py-3">{doc.document_number || "—"}</td>
                            <td className="whitespace-nowrap px-3 py-3">
                              {doc.no_expiry
                                ? "Sem vencimento"
                                : formatExpiryDateBR(doc.expires_at)}
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant={view.badge}>{view.label}</Badge>
                            </td>
                            <td className="px-3 py-3">
                              <ComplianceDocumentClip
                                companyId={companyId}
                                documentId={doc.id}
                                canUpload={canEdit}
                                refreshKey={clipRefresh}
                                onUploaded={() => setClipRefresh((k) => k + 1)}
                              />
                            </td>
                            <td className="px-3 py-3">
                              {canEdit ? (
                                <div className="os-row-actions flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="action-icon-btn"
                                    title="Editar"
                                    onClick={() =>
                                      setEditor({
                                        mode: "edit",
                                        doc,
                                        vehicleId: doc.owner_id,
                                      })
                                    }
                                  >
                                    Editar
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="action-icon-btn"
                                    title="Renovar"
                                    onClick={() =>
                                      setEditor({
                                        mode: "renew",
                                        doc,
                                        vehicleId: doc.owner_id,
                                      })
                                    }
                                  >
                                    Renovar
                                  </Button>
                                </div>
                              ) : null}
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="action-icon-btn"
                                title="Histórico"
                                onClick={() => void openHistory(doc)}
                              >
                                Histórico
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </GroupedTableBodies>
                </table>
              </DataTableScroll>
            </div>
          </>
        )}
      </div>

      <ComplianceDocumentHistory
        companyId={companyId}
        versions={historyVersions}
        loading={historyLoading}
        emptyHint={
          historyRootId
            ? "Sem versões neste documento."
            : "Clique em Histórico em um documento para ver versões (atual e anteriores)."
        }
      />
    </div>
  );
}

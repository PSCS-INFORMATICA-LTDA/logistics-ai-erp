"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComplianceDocumentClip } from "@/components/compliance/ComplianceDocumentClip";
import {
  attachComplianceFile,
  ComplianceDocumentEditor,
} from "@/components/compliance/ComplianceDocumentEditor";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  documentDisplayName,
  resolveComplianceSituation,
  type ComplianceDocument,
  type DocumentType,
} from "@/lib/compliance-documents";
import {
  createComplianceDocument,
  listVehicleFleetDocuments,
  renewComplianceDocument,
  syncComplianceAlerts,
  updateComplianceDocument,
  type ComplianceDocInput,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
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

      <div className={`overflow-x-auto ${glassFilterPanel()}`}>
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Placa</th>
              <th className="px-2 py-2">Marca / modelo</th>
              <th className="px-2 py-2">Tipo de documento</th>
              <th className="px-2 py-2">Nº</th>
              <th className="px-2 py-2">Data de vencimento</th>
              <th className="px-2 py-2">Situação</th>
              <th className="px-2 py-2" title="Anexo da digitalização (por linha)">
                Anexo
              </th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-slate-500">
                  Nenhum documento ainda. Clique em &quot;Novo documento por placa&quot;,
                  selecione a placa (marca / modelo) e anexe a digitalização no formulário.
                  O ícone de clipe aparece na coluna Anexo depois que o documento for salvo.
                </td>
              </tr>
            ) : (
              filtered.map((doc) => {
                const view = resolveComplianceSituation(doc, doc.document_type);
                const veh = vehicleById.get(doc.owner_id);
                return (
                  <tr key={doc.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-medium">
                      {veh?.plate || "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {veh?.brandModel || "—"}
                    </td>
                    <td className="px-2 py-2">
                      {documentDisplayName(doc.document_type)}
                    </td>
                    <td className="px-2 py-2">{doc.document_number || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {doc.no_expiry
                        ? "Sem vencimento"
                        : formatExpiryDateBR(doc.expires_at)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={view.badge}>{view.label}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <ComplianceDocumentClip
                        companyId={companyId}
                        documentId={doc.id}
                        canUpload={canEdit}
                        refreshKey={clipRefresh}
                        onUploaded={() => setClipRefresh((k) => k + 1)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {canEdit ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            variant="secondary"
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
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

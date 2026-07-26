"use client";

import Link from "next/link";
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
import {
  buildIndicators,
  documentDisplayName,
  resolveComplianceSituation,
  type ComplianceDocument,
  type DocumentType,
} from "@/lib/compliance-documents";
import {
  createComplianceDocument,
  listCompanyDocumentsForVehicleView,
  listComplianceDocuments,
  listDocumentTypes,
  listDocumentVersions,
  renewComplianceDocument,
  seedDefaultDocumentTypes,
  syncComplianceAlerts,
  updateComplianceDocument,
  type ComplianceDocInput,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
import { glassAction, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type Props = {
  companyId: string;
  vehicleId: string | null;
  vehicleCategory?: string | null;
  canEdit?: boolean;
};

export function VehicleComplianceDocumentsPanel({
  companyId,
  vehicleId,
  vehicleCategory,
  canEdit = true,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicleTypes, setVehicleTypes] = useState<DocumentType[]>([]);
  const [vehicleDocs, setVehicleDocs] = useState<ComplianceDocument[]>([]);
  const [companyDocs, setCompanyDocs] = useState<ComplianceDocument[]>([]);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit" | "renew";
    doc?: ComplianceDocument | null;
  } | null>(null);
  const [historyRootId, setHistoryRootId] = useState<string | null>(null);
  const [history, setHistory] = useState<ComplianceDocument[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [clipRefresh, setClipRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    await seedDefaultDocumentTypes(supabase, companyId);
    const [typesRes, companyRes] = await Promise.all([
      listDocumentTypes(supabase, companyId, "vehicle"),
      listCompanyDocumentsForVehicleView(supabase, companyId),
    ]);
    if (typesRes.error) setError(typesRes.error);
    setVehicleTypes(typesRes.rows.filter((t) => t.is_active));
    setCompanyDocs(companyRes.rows);

    if (vehicleId) {
      const docsRes = await listComplianceDocuments(supabase, companyId, {
        ownerType: "vehicle",
        ownerId: vehicleId,
        currentOnly: true,
      });
      if (docsRes.error) setError(docsRes.error);
      setVehicleDocs(docsRes.rows);
      await syncComplianceAlerts(supabase, companyId, [
        ...docsRes.rows,
        ...companyRes.rows,
      ]);
    } else {
      setVehicleDocs([]);
    }
    setLoading(false);
  }, [companyId, vehicleId, supabase]);

  useEffect(() => {
    void load();
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [load, supabase.auth]);

  const indicators = useMemo(
    () => buildIndicators(vehicleTypes, vehicleDocs, vehicleCategory),
    [vehicleTypes, vehicleDocs, vehicleCategory]
  );

  const openHistory = async (doc: ComplianceDocument) => {
    const root = doc.root_id ?? doc.id;
    setHistoryRootId(root);
    setHistoryLoading(true);
    const res = await listDocumentVersions(supabase, companyId, root);
    setHistory(res.rows);
    setHistoryLoading(false);
  };

  const saveEditor = async (input: ComplianceDocInput, file?: File | null) => {
    if (!vehicleId) return "Salve o veículo antes de cadastrar documentos.";
    if (!editor) return "Editor indisponível.";

    if (editor.mode === "create") {
      const { id, error: err } = await createComplianceDocument(
        supabase,
        companyId,
        "vehicle",
        vehicleId,
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

    setEditor(null);
    setClipRefresh((k) => k + 1);
    await load();
    return null;
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-5">
      {error ? <Alert variant="error">{error}</Alert> : null}

      {!vehicleId ? (
        <Alert variant="info">
          Salve o veículo primeiro para cadastrar documentos com validade e histórico.
        </Alert>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-5">
        {[
          { label: "Válidos", value: indicators.valid, tone: "text-emerald-700" },
          { label: "A vencer", value: indicators.expiring, tone: "text-amber-700" },
          { label: "Vencidos", value: indicators.expired, tone: "text-red-700" },
          { label: "Em renovação", value: indicators.inRenewal, tone: "text-sky-700" },
          { label: "Não cadastrados", value: indicators.missing, tone: "text-slate-700" },
        ].map((k) => (
          <div key={k.label} className={`rounded-xl px-3 py-2 ${glassFilterPanel()}`}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {k.label}
            </p>
            <p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* A — Documentos do veículo */}
      <section className={`space-y-3 ${glassFilterPanel()}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">A. Documentos do veículo</h3>
          {canEdit && vehicleId ? (
            <Button type="button" onClick={() => setEditor({ mode: "create", doc: null })}>
              Novo documento
            </Button>
          ) : null}
        </div>

        {editor ? (
          <ComplianceDocumentEditor
            companyId={companyId}
            types={vehicleTypes}
            initial={editor.doc}
            mode={editor.mode}
            onCancel={() => setEditor(null)}
            onSave={saveEditor}
          />
        ) : null}

        {vehicleDocs.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum documento cadastrado neste veículo.</p>
          ) : (
            <DataTableScroll stickyFirst stickyLast compact>
              <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
              <thead className="text-[10px] uppercase text-slate-500 sm:text-xs">
                <tr>
                  <th className="px-1.5 py-2">Documento</th>
                  <th className="hidden px-1.5 py-2 md:table-cell">Nº</th>
                  <th className="hidden px-1.5 py-2 lg:table-cell">Data de vencimento</th>
                  <th className="px-1.5 py-2">Situação</th>
                  <th className="hidden px-1.5 py-2 xl:table-cell" title="Digitalização">
                    Clipe
                  </th>
                  <th className="px-1.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {vehicleDocs.map((doc) => {
                  const view = resolveComplianceSituation(doc, doc.document_type);
                  return (
                    <tr key={doc.id} className="border-t border-slate-100 align-top">
                      <td className="px-1.5 py-2">
                        <p className="max-w-[8rem] truncate font-medium text-slate-900 sm:max-w-none">
                          {documentDisplayName(doc.document_type)}
                        </p>
                        <p className="hidden truncate text-[10px] text-slate-500 sm:block sm:text-xs">
                          {doc.issuing_body || doc.document_type?.issuing_body || "—"}
                        </p>
                      </td>
                      <td className="hidden px-1.5 py-2 md:table-cell">{doc.document_number || "—"}</td>
                      <td className="hidden whitespace-nowrap px-1.5 py-2 lg:table-cell">
                        {doc.no_expiry
                          ? "Sem vencimento"
                          : formatExpiryDateBR(doc.expires_at)}
                        {view.daysLeft != null ? (
                          <span className="block text-[10px] text-slate-500 sm:text-xs">
                            {view.daysLeft} dia(s)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-1.5 py-2">
                        <Badge variant={view.badge}>{view.label}</Badge>
                      </td>
                      <td className="hidden px-1.5 py-2 xl:table-cell">
                        <ComplianceDocumentClip
                          companyId={companyId}
                          documentId={doc.id}
                          canUpload={canEdit}
                          refreshKey={clipRefresh}
                          onUploaded={() => setClipRefresh((k) => k + 1)}
                        />
                      </td>
                      <td className="px-1.5 py-2">
                        <div className="os-row-actions flex flex-wrap gap-1">
                          {canEdit ? (
                            <>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="action-icon-btn"
                                title="Editar"
                                onClick={() => setEditor({ mode: "edit", doc })}
                              >
                                <span className="sm:hidden">Edit</span>
                                <span className="hidden sm:inline">Editar</span>
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="action-icon-btn"
                                title="Renovar"
                                onClick={() => setEditor({ mode: "renew", doc })}
                              >
                                <span className="sm:hidden">Ren.</span>
                                <span className="hidden sm:inline">Renovar</span>
                              </Button>
                            </>
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="action-icon-btn"
                            title="Histórico"
                            onClick={() => void openHistory(doc)}
                          >
                            <span className="sm:hidden">Hist.</span>
                            <span className="hidden sm:inline">Histórico</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </DataTableScroll>
          )}
      </section>

      {/* B — Empresa (consulta) */}
      <section className={`space-y-3 ${glassFilterPanel()}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            B. Documento da empresa — TA (consulta)
          </h3>
          <Link
            href="/configuracoes/documentos-licencas"
            className={glassAction("sky", true)}
          >
            Gerenciar em Parâmetros → Documentos e licenças
          </Link>
        </div>
        <p className="text-xs text-slate-500">
          Só o Termo de Autorização (TA) é da empresa — não se cadastra por placa. Prefixo e
          demais documentos ficam na seção A, por veículo.
        </p>
        {companyDocs.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum documento da empresa cadastrado.</p>
        ) : (
          <DataTableScroll stickyFirst compact>
            <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
              <thead className="text-[10px] uppercase text-slate-500 sm:text-xs">
                <tr>
                  <th className="px-1.5 py-2">Documento</th>
                  <th className="hidden px-1.5 py-2 md:table-cell">Data de vencimento</th>
                  <th className="px-1.5 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {companyDocs.map((doc) => {
                  const view = resolveComplianceSituation(doc, doc.document_type);
                  return (
                    <tr key={doc.id} className="border-t border-slate-100">
                      <td className="max-w-[8rem] truncate px-1.5 py-2 font-medium sm:max-w-none">
                        {documentDisplayName(doc.document_type)}
                      </td>
                      <td className="hidden whitespace-nowrap px-1.5 py-2 md:table-cell">
                        {doc.no_expiry
                          ? "Sem vencimento"
                          : formatExpiryDateBR(doc.expires_at)}
                      </td>
                      <td className="px-1.5 py-2">
                        <Badge variant={view.badge}>{view.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableScroll>
        )}
      </section>

      <ComplianceDocumentHistory
        companyId={companyId}
        versions={history}
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

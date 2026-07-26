"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ComplianceDocumentClip } from "@/components/compliance/ComplianceDocumentClip";
import {
  attachComplianceFile,
  ComplianceDocumentEditor,
} from "@/components/compliance/ComplianceDocumentEditor";
import { ComplianceDocumentHistory } from "@/components/compliance/ComplianceDocumentHistory";
import { FleetComplianceDocumentsPanel } from "@/components/compliance/FleetComplianceDocumentsPanel";
import { AttachmentGallery } from "@/components/drivers/AttachmentGallery";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import {
  documentDisplayName,
  resolveComplianceSituation,
  type ComplianceDocument,
  type DocumentAppliesTo,
  type DocumentType,
} from "@/lib/compliance-documents";
import {
  createComplianceDocument,
  listComplianceDocuments,
  listDocumentTypes,
  listDocumentVersions,
  renewComplianceDocument,
  seedDefaultDocumentTypes,
  syncComplianceAlerts,
  updateComplianceDocument,
  upsertDocumentType,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
import {
  glassAction,
  glassField,
  glassFilterPanel,
  glassTabLink,
  glassTabsNav,
} from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type Tab = "frota" | "empresa" | "tipos";

export default function DocumentosLicencasPage() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("configuracoes.documentos-licencas");
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("tipos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [companyDocs, setCompanyDocs] = useState<ComplianceDocument[]>([]);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit" | "renew";
    doc?: ComplianceDocument | null;
  } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [clipRefresh, setClipRefresh] = useState(0);
  const [historyVersions, setHistoryVersions] = useState<ComplianceDocument[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRootId, setHistoryRootId] = useState<string | null>(null);
  const [typeForm, setTypeForm] = useState({
    id: "" as string,
    name: "",
    acronym: "",
    issuing_body: "",
    applies_to: "vehicle" as DocumentAppliesTo,
    requires_expiry: true,
    is_required: false,
    alert_days_first: "60",
    sort_order: "100",
    is_active: true,
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    await seedDefaultDocumentTypes(supabase, companyId);
    const [tRes, dRes] = await Promise.all([
      listDocumentTypes(supabase, companyId, "all"),
      listComplianceDocuments(supabase, companyId, {
        ownerType: "company",
        ownerId: companyId,
        currentOnly: true,
      }),
    ]);
    if (tRes.error) setError(tRes.error);
    if (dRes.error) setError(dRes.error);
    setTypes(tRes.rows);
    setCompanyDocs(dRes.rows);
    await syncComplianceAlerts(supabase, companyId, dRes.rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [load, supabase.auth]);

  const companyTypes = types.filter((t) => t.applies_to === "company" && t.is_active);
  const vehicleTypes = types.filter((t) => t.applies_to === "vehicle");
  const companyDocsVisible = companyDocs.filter(
    (d) => d.document_type?.is_active !== false
  );

  const openCompanyHistory = async (doc: ComplianceDocument) => {
    const root = doc.root_id ?? doc.id;
    setHistoryRootId(root);
    setHistoryLoading(true);
    const res = await listDocumentVersions(supabase, companyId!, root);
    setHistoryVersions(res.rows);
    setHistoryLoading(false);
    if (res.error) setError(res.error);
  };

  const saveType = async () => {
    if (!companyId || !canEdit) return;
    if (!typeForm.name.trim()) {
      setError("Informe o nome do tipo.");
      return;
    }
    const err = await upsertDocumentType(
      supabase,
      companyId,
      {
        name: typeForm.name.trim(),
        acronym: typeForm.acronym || null,
        issuing_body: typeForm.issuing_body || null,
        applies_to: typeForm.applies_to,
        requires_expiry: typeForm.requires_expiry,
        is_required: typeForm.is_required,
        alert_days_first: Number(typeForm.alert_days_first) || 60,
        sort_order: Number(typeForm.sort_order) || 100,
        is_active: typeForm.is_active,
      },
      typeForm.id || undefined
    );
    if (err) setError(err);
    else {
      setMsg("Tipo salvo.");
      setTypeForm({
        id: "",
        name: "",
        acronym: "",
        issuing_body: "",
        applies_to: "vehicle",
        requires_expiry: true,
        is_required: false,
        alert_days_first: "60",
        sort_order: "100",
        is_active: true,
      });
      await load();
    }
  };

  if (!companyId) return <Loading />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documentos e licenças</h1>
        <p className="text-sm text-slate-600">
          Controle de licenças: vincule documentos às placas, informe a data de vencimento e
          anexe a digitalização (clipe). Só o TA é da empresa. Relatório:{" "}
          <Link href="/operacional/documentos-a-vencer" className={glassAction("sky", true)}>
            Operacional → Documentos a vencer
          </Link>
          .
        </p>
      </div>

      <nav className={glassTabsNav()} aria-label="Documentos e licenças">
        {(
          [
            ["tipos", "Tipos de documento"],
            ["frota", "Documentos por placa"],
            ["empresa", "Documento da empresa (TA)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={glassTabLink(tab === key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="success">{msg}</Alert> : null}
      {loading ? <Loading /> : null}

      {tab === "frota" && !loading ? (
        <FleetComplianceDocumentsPanel
          companyId={companyId}
          vehicleTypes={vehicleTypes}
          canEdit={canEdit}
        />
      ) : null}

      {tab === "tipos" && !loading ? (
        <div className="space-y-4">
          <Alert variant="info">
            Tipos só definem o catálogo (nome, Prefixo/CRLV…, se exige vencimento). Placa,
            data de vencimento e clipe ficam na aba Documentos por placa (ou no TA da
            empresa).
          </Alert>
          <div className={`space-y-3 ${glassFilterPanel()}`}>
            <h2 className="text-sm font-semibold">
              {typeForm.id ? "Editar tipo" : "Novo tipo"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Nome</span>
                <input
                  className={glassField()}
                  value={typeForm.name}
                  onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Sigla</span>
                <input
                  className={glassField()}
                  value={typeForm.acronym}
                  onChange={(e) => setTypeForm((f) => ({ ...f, acronym: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Órgão</span>
                <input
                  className={glassField()}
                  value={typeForm.issuing_body}
                  onChange={(e) => setTypeForm((f) => ({ ...f, issuing_body: e.target.value }))}
                />
              </label>
              <div className="space-y-1">
                <GlassSelect
                  label="Aplicação"
                  value={typeForm.applies_to}
                  onChange={(v) =>
                    setTypeForm((f) => ({ ...f, applies_to: v as DocumentAppliesTo }))
                  }
                  options={[
                    { value: "vehicle", label: "Veículo (por placa)" },
                    { value: "company", label: "Empresa (único)" },
                  ]}
                />
                <p className="text-xs text-slate-500">
                  Veículo: cada placa cadastra o seu (Prefixo, CRLV, seguro…). Empresa: só o
                  TA — um registro da empresa, sem repetir por placa.
                </p>
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-medium">1º alerta (dias)</span>
                <input
                  className={glassField()}
                  type="number"
                  value={typeForm.alert_days_first}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, alert_days_first: e.target.value }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Ordem</span>
                <input
                  className={glassField()}
                  type="number"
                  value={typeForm.sort_order}
                  onChange={(e) => setTypeForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={typeForm.requires_expiry}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, requires_expiry: e.target.checked }))
                  }
                />
                Exige vencimento
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={typeForm.is_required}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, is_required: e.target.checked }))
                  }
                />
                Obrigatório
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={typeForm.is_active}
                  onChange={(e) => setTypeForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Ativo
              </label>
            </div>
            {canEdit ? (
              <Button type="button" onClick={() => void saveType()}>
                Salvar tipo
              </Button>
            ) : null}
          </div>

          <div className={glassFilterPanel()}>
            <DataTableScroll stickyFirst stickyLast compact>
              <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
              <thead className="text-[10px] uppercase text-slate-500 sm:text-xs">
                <tr>
                  <th className="px-1.5 py-2">Sigla</th>
                  <th className="px-1.5 py-2">Nome</th>
                  <th className="hidden px-1.5 py-2 md:table-cell">Aplicação</th>
                  <th className="hidden px-1.5 py-2 lg:table-cell">Alerta</th>
                  <th className="px-1.5 py-2">Ativo</th>
                  <th className="px-1.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-1.5 py-2 font-medium">{t.acronym || "—"}</td>
                    <td className="max-w-[8rem] truncate px-1.5 py-2 sm:max-w-none">{t.name}</td>
                    <td className="hidden px-1.5 py-2 md:table-cell">{t.applies_to === "company" ? "Empresa" : "Veículo"}</td>
                    <td className="hidden px-1.5 py-2 lg:table-cell">{t.alert_days_first}d</td>
                    <td className="px-1.5 py-2">
                      <Badge variant={t.is_active ? "success" : "default"}>
                        {t.is_active ? "Sim" : "Não"}
                      </Badge>
                    </td>
                    <td className="px-1.5 py-2">
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="action-icon-btn"
                          title="Editar"
                          onClick={() =>
                            setTypeForm({
                              id: t.id,
                              name: t.name,
                              acronym: t.acronym ?? "",
                              issuing_body: t.issuing_body ?? "",
                              applies_to: t.applies_to,
                              requires_expiry: t.requires_expiry,
                              is_required: t.is_required,
                              alert_days_first: String(t.alert_days_first),
                              sort_order: String(t.sort_order),
                              is_active: t.is_active,
                            })
                          }
                        >
                          <span className="sm:hidden">Edit</span>
                          <span className="hidden sm:inline">Editar</span>
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </DataTableScroll>
          </div>
        </div>
      ) : null}

      {tab === "empresa" && !loading ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canEdit ? (
              <Button type="button" onClick={() => setEditor({ mode: "create", doc: null })}>
                Novo documento da empresa
              </Button>
            ) : null}
          </div>

          {editor ? (
            <ComplianceDocumentEditor
              companyId={companyId}
              types={companyTypes}
              initial={editor.doc}
              mode={editor.mode}
              onCancel={() => setEditor(null)}
              onSave={async (input, file) => {
                if (editor.mode === "create") {
                  const { id, error: err } = await createComplianceDocument(
                    supabase,
                    companyId,
                    "company",
                    companyId,
                    input,
                    userId
                  );
                  if (err || !id) return err ?? "Falha";
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
                  if (err || !id) return err ?? "Falha";
                  if (file) {
                    const up = await attachComplianceFile(companyId, id, file);
                    if (up) return up;
                  }
                }
                setEditor(null);
                await load();
                return null;
              }}
            />
          ) : null}

          {companyDocsVisible.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum documento da empresa. Cadastre o TA (Termo de Autorização).
            </p>
          ) : (
            <div className={glassFilterPanel()}>
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
                  {companyDocsVisible.map((doc) => {
                    const view = resolveComplianceSituation(doc, doc.document_type);
                    return (
                      <tr key={doc.id} className="border-t border-slate-100">
                        <td className="px-1.5 py-2 font-medium">
                          <p className="max-w-[8rem] truncate sm:max-w-none">
                            {documentDisplayName(doc.document_type)}
                          </p>
                          <div className="mt-2 hidden max-w-sm sm:block">
                            <AttachmentGallery
                              companyId={companyId}
                              entityType="compliance_document"
                              entityId={doc.id}
                              title="Arquivos anexados"
                              refreshKey={clipRefresh}
                            />
                          </div>
                        </td>
                        <td className="hidden px-1.5 py-2 md:table-cell">{doc.document_number || "—"}</td>
                        <td className="hidden whitespace-nowrap px-1.5 py-2 lg:table-cell">
                          {doc.no_expiry
                            ? "Sem vencimento"
                            : formatExpiryDateBR(doc.expires_at)}
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
                          {canEdit ? (
                            <div className="os-row-actions flex flex-wrap gap-1">
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
                            </div>
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="action-icon-btn"
                            title="Histórico"
                            onClick={() => void openCompanyHistory(doc)}
                          >
                            <span className="sm:hidden">Hist.</span>
                            <span className="hidden sm:inline">Histórico</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </DataTableScroll>
            </div>
          )}

          <ComplianceDocumentHistory
            companyId={companyId}
            versions={historyVersions}
            loading={historyLoading}
            emptyHint={
              historyRootId
                ? "Sem versões neste documento."
                : "Clique em Histórico no TA para ver versões (atual e anteriores)."
            }
          />
        </div>
      ) : null}
    </div>
  );
}

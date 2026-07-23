"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attachComplianceFile,
  ComplianceDocumentEditor,
} from "@/components/compliance/ComplianceDocumentEditor";
import { AttachmentGallery } from "@/components/drivers/AttachmentGallery";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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
  renewComplianceDocument,
  seedDefaultDocumentTypes,
  syncComplianceAlerts,
  updateComplianceDocument,
  upsertDocumentType,
} from "@/lib/compliance-documents-api";
import { formatExpiryDateBR } from "@/lib/expiry-status";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type Tab = "tipos" | "empresa";

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
          Aqui você parametriza os tipos e cadastra documentos da empresa.           Tipos com aplicação Veículo são preenchidos por placa em Cadastros → Veículos →
          Documentos. Tipos com aplicação Empresa ficam só nesta tela (um por empresa, não por
          placa). Acompanhar vencimentos:{" "}
          <Link href="/operacional/documentos-a-vencer" className="text-sky-700 underline">
            Operacional → Documentos a vencer
          </Link>
          .
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            ["tipos", "Tipos de documento"],
            ["empresa", "Documentos da empresa"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="success">{msg}</Alert> : null}
      {loading ? <Loading /> : null}

      {tab === "tipos" && !loading ? (
        <div className="space-y-4">
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
                  Veículo: cada placa cadastra o seu (CRLV, seguro…). Empresa: um registro
                  para a empresa inteira (TA, CADASTUR…) — não se repete por placa.
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

          <div className={`overflow-x-auto ${glassFilterPanel()}`}>
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Sigla</th>
                  <th className="px-2 py-2">Nome</th>
                  <th className="px-2 py-2">Aplicação</th>
                  <th className="px-2 py-2">Alerta</th>
                  <th className="px-2 py-2">Ativo</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-medium">{t.acronym || "—"}</td>
                    <td className="px-2 py-2">{t.name}</td>
                    <td className="px-2 py-2">{t.applies_to === "company" ? "Empresa" : "Veículo"}</td>
                    <td className="px-2 py-2">{t.alert_days_first}d</td>
                    <td className="px-2 py-2">
                      <Badge variant={t.is_active ? "success" : "default"}>
                        {t.is_active ? "Sim" : "Não"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
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
                          Editar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

          {companyDocs.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum documento da empresa.</p>
          ) : (
            companyDocs.map((doc) => {
              const view = resolveComplianceSituation(doc, doc.document_type);
              return (
                <div key={doc.id} className={`space-y-2 ${glassFilterPanel()}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{documentDisplayName(doc.document_type)}</p>
                      <p className="text-xs text-slate-500">
                        Nº {doc.document_number || "—"} · Validade{" "}
                        {doc.no_expiry ? "sem vencimento" : formatExpiryDateBR(doc.expires_at)}
                      </p>
                    </div>
                    <Badge variant={view.badge}>{view.label}</Badge>
                  </div>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditor({ mode: "edit", doc })}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditor({ mode: "renew", doc })}
                      >
                        Renovar
                      </Button>
                    </div>
                  ) : null}
                  <AttachmentGallery
                    companyId={companyId}
                    entityType="compliance_document"
                    entityId={doc.id}
                    title="Anexo"
                  />
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

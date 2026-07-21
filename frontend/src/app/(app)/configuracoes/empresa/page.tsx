"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { CnpjLookupSection } from "@/components/cadastros/CnpjLookupSection";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatCpfCnpj } from "@/lib/br-documents";
import { useCompany } from "@/lib/company-context";
import {
  adoptDefaultCompanyLogo,
  DEFAULT_COMPANY_LOGO_SRC,
  getCompanyLogoUrl,
  removeCompanyLogo,
  uploadCompanyLogo,
  validateCompanyLogoFile,
} from "@/lib/company-logo";
import { createClient } from "@/lib/supabase/client";

type EmpresaForm = {
  document: string;
  name: string;
  trade_name: string;
  state_registration: string;
  postal_code: string;
  street: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
  address: string;
  cnpj_status: string;
  cnpj_checked_at: string;
  status: string;
};

export default function EmpresaConfigPage() {
  const { company, companyId, loading: companyLoading, refresh } = useCompany();
  const supabase = createClient();

  const [form, setForm] = useState<EmpresaForm>({
    document: "",
    name: "",
    trade_name: "",
    state_registration: "",
    postal_code: "",
    street: "",
    address_number: "",
    address_complement: "",
    neighborhood: "",
    city: "",
    state: "",
    address: "",
    cnpj_status: "",
    cnpj_checked_at: "",
    status: "Ativo",
  });
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!company) return;
    setForm({
      document: company.document ?? "",
      name: company.name ?? "",
      trade_name: company.trade_name ?? "",
      state_registration: company.state_registration ?? "",
      postal_code: company.postal_code ?? "",
      street: company.street ?? "",
      address_number: company.address_number ?? "",
      address_complement: company.address_complement ?? "",
      neighborhood: company.neighborhood ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      address: company.address ?? "",
      cnpj_status: company.cnpj_status ?? "",
      cnpj_checked_at: company.cnpj_checked_at ?? "",
      status: company.status ?? "Ativo",
    });
    setLogoPath(company.logo_storage_path ?? null);
  }, [company]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await getCompanyLogoUrl(logoPath);
      if (!cancelled) setLogoUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [logoPath]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const trimOrNull = (v: string) => {
      const t = v.trim();
      return t ? t : null;
    };

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        name: form.name.trim(),
        trade_name: trimOrNull(form.trade_name),
        document: trimOrNull(form.document),
        state_registration: trimOrNull(form.state_registration),
        postal_code: trimOrNull(form.postal_code),
        street: trimOrNull(form.street),
        address_number: trimOrNull(form.address_number),
        address_complement: trimOrNull(form.address_complement),
        neighborhood: trimOrNull(form.neighborhood),
        city: trimOrNull(form.city),
        state: trimOrNull(form.state),
        address: trimOrNull(form.address),
        cnpj_status: trimOrNull(form.cnpj_status),
        cnpj_checked_at: form.cnpj_checked_at || null,
        status: form.status === "Inativo" ? "Inativo" : "Ativo",
      })
      .eq("id", companyId);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Dados da empresa salvos no banco.");
    await refresh();
  };

  const handleLogoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !companyId) return;

    const validation = validateCompanyLogoFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);
    const { path, error: uploadError } = await uploadCompanyLogo({
      companyId,
      file,
      previousPath: logoPath,
    });
    setUploading(false);

    if (uploadError || !path) {
      setError(uploadError ?? "Falha ao enviar o logo.");
      return;
    }

    setLogoPath(path);
    setMessage("Logo atualizado. Será usado no voucher, proposta e e-mails.");
    await refresh();
  };

  const handleRemoveLogo = async () => {
    if (!companyId || !logoPath) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    const removeError = await removeCompanyLogo({ companyId, storagePath: logoPath });
    setUploading(false);
    if (removeError) {
      setError(removeError);
      return;
    }
    setLogoPath(null);
    setLogoUrl(null);
    setMessage("Logo removido. Documentos voltam ao logo padrão até novo envio.");
    await refresh();
  };

  const handleAdoptVoucherLogo = async () => {
    if (!companyId) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    const { path, error: adoptError } = await adoptDefaultCompanyLogo({
      companyId,
      previousPath: logoPath,
    });
    setUploading(false);
    if (adoptError || !path) {
      setError(adoptError ?? "Falha ao gravar o logo do voucher.");
      return;
    }
    setLogoPath(path);
    setMessage("Logo do voucher (GRX) gravado na empresa. Já vale para voucher e proposta.");
    await refresh();
  };

  const previewSrc = logoUrl || DEFAULT_COMPANY_LOGO_SRC;

  if (companyLoading) {
    return <Loading />;
  }

  if (!companyId) {
    return <Alert variant="error">Empresa não encontrada. Conclua o cadastro em /setup.</Alert>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="border-b border-slate-100 px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Empresa</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nome, CNPJ e logo do cliente (ex.: GRX). Aparecem no header, voucher e proposta.
          </p>
        </div>
        <CardHeader
          title="Dados cadastrais"
          description="Consulta CNPJ preenche razão social, endereço e situação — salve para gravar"
        />
        <CardBody>
          <form onSubmit={handleSave} className="space-y-4">
            {error ? <Alert variant="error">{error}</Alert> : null}
            {message ? <Alert variant="info">{message}</Alert> : null}
            <Input
              label="Razão social"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              required
            />
            <Input
              label="Nome fantasia (exibido no header e documentos)"
              value={form.trade_name}
              onChange={(e) => setField("trade_name", e.target.value)}
            />
            <Input
              label="CNPJ"
              value={form.document}
              onChange={(e) => setField("document", formatCpfCnpj(e.target.value))}
            />

            <CnpjLookupSection
              form={form as unknown as Record<string, unknown>}
              set={setField}
              fillName
              fillPhone={false}
              mapStatusToCadastro
              showDocumentInput={false}
            />

            <Input
              label="Inscrição estadual (IE)"
              value={form.state_registration}
              onChange={(e) => setField("state_registration", e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="CEP"
                value={form.postal_code}
                onChange={(e) => setField("postal_code", e.target.value)}
              />
              <Input
                label="UF"
                value={form.state}
                onChange={(e) => setField("state", e.target.value)}
              />
            </div>
            <Input
              label="Logradouro"
              value={form.street}
              onChange={(e) => setField("street", e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Número"
                value={form.address_number}
                onChange={(e) => setField("address_number", e.target.value)}
              />
              <Input
                label="Complemento"
                value={form.address_complement}
                onChange={(e) => setField("address_complement", e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Bairro"
                value={form.neighborhood}
                onChange={(e) => setField("neighborhood", e.target.value)}
              />
              <Input
                label="Cidade"
                value={form.city}
                onChange={(e) => setField("city", e.target.value)}
              />
            </div>
            <Input
              label="Endereço completo"
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
            />

            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar dados"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Logo da empresa"
          description="O logo atual do voucher (GRX) já aparece abaixo. Você pode gravá-lo na empresa ou enviar outro arquivo."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-28 w-44 items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt="Logo da empresa"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-2">
              {!logoPath ? (
                <Button
                  type="button"
                  disabled={uploading}
                  onClick={() => void handleAdoptVoucherLogo()}
                >
                  {uploading ? "Gravando..." : "Usar logo do voucher (GRX)"}
                </Button>
              ) : null}
              <label className="liquid-glass-btn liquid-glass-btn--secondary inline-flex cursor-pointer items-center justify-center px-4 py-2 text-sm font-semibold">
                {uploading ? "Enviando..." : "Enviar outro logo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleLogoChange}
                />
              </label>
              {logoPath ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading}
                  onClick={() => void handleRemoveLogo()}
                >
                  Remover logo
                </Button>
              ) : (
                <p className="text-xs text-slate-500">
                  Pré-visualização = logo atual do voucher. Clique em gravar para registrar na
                  empresa.
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            JPG, PNG ou WEBP · máx. 5 MB · bucket company-attachments
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

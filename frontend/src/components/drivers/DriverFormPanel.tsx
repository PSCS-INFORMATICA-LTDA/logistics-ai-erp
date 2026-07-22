"use client";

import { useEffect, useState } from "react";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { AttachmentGallery } from "@/components/drivers/AttachmentGallery";
import { CnhScanner, type CnhScanPayload } from "@/components/drivers/CnhScanner";
import { DriverPhotoUpload } from "@/components/drivers/DriverPhotoUpload";
import { Alert } from "@/components/ui/Badge";
import { uploadEntityAttachment } from "@/lib/attachments";
import { uploadDriverPhoto } from "@/lib/driver-photo";
import { applyCnhOcrToForm } from "@/lib/cnh-ocr";
import type { CnhScanAsset } from "@/lib/cnh-document";
import {
  CNH_CATEGORIES,
  formatCnh,
  formatCnhCategories,
  getCnhExpiryMessage,
  getCnhExpiryStatus,
  isCnhExpiryDanger,
  normalizeCnh,
  sortCnhCategories,
  toggleCnhCategory,
  validateCnh,
} from "@/lib/cnh";
import { NumericCodeField } from "@/components/cadastros/NumericCodeField";
import { resolveEntityNumericCode } from "@/lib/codes";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import { isSimilarName, normalizeText } from "@/lib/utils";
import type { Driver } from "@/types/database";
import { DRIVER_TYPES, STATUS_OPTIONS } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

type Props = {
  item: Partial<Driver> | null;
  companyId: string | null;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
};

export function DriverFormPanel({ item, companyId, saving, onSave, onCancel }: Props) {
  const supabase = createClient();
  const { seedCode, codeReady } = useSeedNumericCode("drivers", companyId, item);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [cnhError, setCnhError] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [pendingCnhAssets, setPendingCnhAssets] = useState<CnhScanAsset[]>([]);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [photoStoragePath, setPhotoStoragePath] = useState<string | null>(
    item?.photo_storage_path ?? null
  );
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);

  useEffect(() => {
    setPendingCnhAssets([]);
    setPendingPhotoFile(null);
    setPhotoStoragePath(item?.photo_storage_path ?? null);
    setUploadMsg(null);
    setCnhError(null);
    setDuplicateWarning(null);
  }, [item?.id, item?.photo_storage_path]);

  const checkDuplicate = async (name: string) => {
    if (!companyId || !name) {
      setDuplicateWarning(null);
      return;
    }
    const { data } = await supabase
      .from("drivers")
      .select("name")
      .eq("company_id", companyId)
      .is("deleted_at", null);
    const similar = (data ?? []).find((d) => isSimilarName(d.name, name) && d.name !== item?.name);
    setDuplicateWarning(
      similar ? `Possível duplicidade: "${similar.name}" já cadastrado.` : null
    );
  };

  if (!codeReady) {
    return <p className="text-sm text-slate-500">Gerando próximo código...</p>;
  }

  return (
    <>
      {duplicateWarning && <Alert variant="warning">{duplicateWarning}</Alert>}
      {cnhError && <Alert variant="error">{cnhError}</Alert>}
      {uploadMsg && <Alert variant="info">{uploadMsg}</Alert>}

      <EntityForm
        key={item?.id ?? `new-${seedCode}`}
        saving={saving}
        onCancel={onCancel}
        initial={{
          code: seedCode,
          name: item?.name ?? "",
          driver_type: item?.driver_type ?? "Motorista",
          status: item?.status ?? "Ativo",
          phone: item?.phone ?? "",
          email: item?.email ?? "",
          address: item?.address ?? "",
          document: item?.document ?? "",
          cnh_number: item?.cnh_number ? formatCnh(item.cnh_number) : "",
          cnh_expiry_date: item?.cnh_expiry_date ?? "",
          cnh_categories: item?.cnh_categories ?? [],
          active_for_operations: item?.active_for_operations ?? true,
          notes: item?.notes ?? "",
          pix_key: item?.pix_key ?? "",
          bank_code: item?.bank_code ?? "",
          bank_agency: item?.bank_agency ?? "",
          bank_account: item?.bank_account ?? "",
        }}
        onSubmit={async (data) => {
          const cnhValidation = validateCnh(String(data.cnh_number ?? ""));
          if (cnhValidation) {
            setCnhError(cnhValidation);
            return;
          }
          setCnhError(null);

          const resolved = resolveEntityNumericCode(data.code, { existingCode: item?.code });
          if (!resolved.ok) {
            window.alert("Informe um código numérico com até 8 dígitos (ex.: 00000001).");
            return;
          }
          data.code = resolved.code;
          data.name_normalized = normalizeText(String(data.name));
          if (data.cnh_number === "") data.cnh_number = null;
          else data.cnh_number = normalizeCnh(String(data.cnh_number));
          if (data.cnh_expiry_date === "") data.cnh_expiry_date = null;
          if (data.email === "") data.email = null;
          if (data.address === "") data.address = null;
          if (data.phone === "") data.phone = null;
          if (data.pix_key === "") data.pix_key = null;
          if (data.bank_code === "") data.bank_code = null;
          if (data.bank_agency === "") data.bank_agency = null;
          if (data.bank_account === "") data.bank_account = null;
          data.cnh_categories = sortCnhCategories(
            Array.isArray(data.cnh_categories) ? (data.cnh_categories as string[]) : []
          );

          const driverId = await onSave(data);
          if (!driverId || !companyId) return;

          if (pendingPhotoFile) {
            const { error: photoError } = await uploadDriverPhoto({
              companyId,
              driverId,
              file: pendingPhotoFile,
              previousPath: photoStoragePath,
            });
            if (photoError) {
              window.alert(`Motorista salvo, mas a foto não foi enviada: ${photoError}`);
            }
          }

          if (pendingCnhAssets.length > 0) {
            let uploaded = 0;
            for (const asset of pendingCnhAssets) {
              const { error } = await uploadEntityAttachment({
                companyId,
                entityType: "driver",
                entityId: driverId,
                file: asset.file,
                description: `CNH — ${asset.label}`,
              });
              if (!error) uploaded += 1;
            }
            if (uploaded < pendingCnhAssets.length) {
              setUploadMsg(
                `Motorista salvo. ${uploaded}/${pendingCnhAssets.length} imagem(ns) enviada(s) à galeria.`
              );
            } else {
              setPendingCnhAssets([]);
              setUploadMsg("Motorista salvo e imagens da CNH adicionadas à galeria.");
              setAttachmentRefreshKey((key) => key + 1);
            }
          }
        }}
      >
        {({ form, set }) => {
          const selectedCategories = Array.isArray(form.cnh_categories)
            ? (form.cnh_categories as string[])
            : [];
          const expiryDate = String(form.cnh_expiry_date ?? "");
          const expiryMessage = getCnhExpiryMessage(expiryDate);
          const expiryVariant = isCnhExpiryDanger(getCnhExpiryStatus(expiryDate))
            ? "error"
            : "warning";

          return (
            <>
              <CnhScanner
                disabled={saving}
                onScanned={async ({ result, assets, engine }: CnhScanPayload) => {
                  const next = applyCnhOcrToForm(form, result);
                  for (const [key, value] of Object.entries(next)) {
                    set(key, value);
                  }

                  if (item?.id && companyId) {
                    let uploaded = 0;
                    for (const asset of assets) {
                      const { error } = await uploadEntityAttachment({
                        companyId,
                        entityType: "driver",
                        entityId: item.id,
                        file: asset.file,
                        description: `CNH — ${asset.label}`,
                      });
                      if (!error) uploaded += 1;
                    }
                    if (uploaded < assets.length) {
                      setUploadMsg(`Dados preenchidos, mas nem todas as imagens foram enviadas.`);
                    } else {
                      setUploadMsg(
                        `CNH digitalizada (${engine === "google-vision" ? "Google Vision" : "Tesseract"}) e ${uploaded} imagem(ns) na galeria.`
                      );
                      setAttachmentRefreshKey((key) => key + 1);
                    }
                  } else {
                    setPendingCnhAssets(assets);
                    setUploadMsg(
                      "Dados preenchidos. As imagens serão enviadas à galeria ao salvar o cadastro."
                    );
                  }
                }}
              />

              <NumericCodeField
                value={String(form.code ?? "")}
                onChange={(v) => set("code", v)}
              />

              <FormFields
                form={form}
                set={(key, value) => {
                  if (key === "name") checkDuplicate(String(value));
                  set(key, value);
                }}
                fields={[
                  { name: "name", label: "Nome", required: true },
                  {
                    name: "driver_type",
                    label: "Tipo",
                    type: "select",
                    options: DRIVER_TYPES.map((t) => ({ value: t, label: t })),
                  },
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
                  },
                ]}
              />

              <DriverPhotoUpload
                companyId={companyId}
                driverId={item?.id ?? null}
                photoStoragePath={photoStoragePath}
                disabled={saving}
                pendingFile={pendingPhotoFile}
                onPendingFileChange={setPendingPhotoFile}
                onPhotoPathChange={setPhotoStoragePath}
              />

              <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">Contato</legend>
                <FormFields
                  form={form}
                  set={set}
                  fields={[
                    { name: "phone", label: "Telefone", colSpan: 2, placeholder: "11999998888" },
                    { name: "email", label: "E-mail", type: "email", colSpan: 2, placeholder: "motorista@exemplo.com" },
                    { name: "address", label: "Endereço", colSpan: 2 },
                  ]}
                />
              </fieldset>

              <FormFields
                form={form}
                set={set}
                fields={[{ name: "document", label: "CPF/CNPJ" }]}
              />

              <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">
                  Dados bancários / Pix
                </legend>
                <p className="text-xs text-slate-500">
                  Usados no acompanhamento de pagamentos aos motoristas após a designação da OS.
                </p>
                <FormFields
                  form={form}
                  set={set}
                  fields={[
                    {
                      name: "pix_key",
                      label: "Chave Pix",
                      colSpan: 2,
                      placeholder: "CPF, e-mail, telefone ou aleatória",
                    },
                    { name: "bank_code", label: "Código do banco", placeholder: "Ex.: 341" },
                    { name: "bank_agency", label: "Agência", placeholder: "Ex.: 1234" },
                    {
                      name: "bank_account",
                      label: "Conta corrente",
                      colSpan: 2,
                      placeholder: "Ex.: 12345-6",
                    },
                  ]}
                />
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Número da CNH</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={String(form.cnh_number ?? "")}
                    onChange={(e) => {
                      const formatted = formatCnh(e.target.value);
                      set("cnh_number", formatted);
                      setCnhError(validateCnh(formatted));
                    }}
                  />
                  <span className="text-xs text-slate-500">11 dígitos — validação automática do DETRAN</span>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Vencimento da CNH</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={expiryDate}
                    onChange={(e) => set("cnh_expiry_date", e.target.value)}
                  />
                  {expiryMessage && <Alert variant={expiryVariant}>{expiryMessage}</Alert>}
                </label>
              </div>

              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">Categorias da CNH</legend>
                <p className="text-xs text-slate-500">
                  Selecione uma ou mais categorias habilitadas (conforme a CNH do motorista).
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CNH_CATEGORIES.map((category) => (
                    <label
                      key={category.value}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category.value)}
                        onChange={() =>
                          set(
                            "cnh_categories",
                            toggleCnhCategory(selectedCategories, category.value)
                          )
                        }
                      />
                      <span>{category.label}</span>
                    </label>
                  ))}
                </div>
                {selectedCategories.length > 0 && (
                  <p className="text-xs text-slate-600">
                    Selecionadas: {formatCnhCategories(selectedCategories)}
                  </p>
                )}
              </fieldset>

              <FormFields
                form={form}
                set={set}
                fields={[
                  { name: "active_for_operations", label: "Usar em operação?", type: "checkbox" },
                  { name: "notes", label: "Observações", type: "textarea" },
                ]}
              />

              {companyId && (
                <AttachmentGallery
                  companyId={companyId}
                  entityType="driver"
                  entityId={item?.id ?? null}
                  refreshKey={attachmentRefreshKey}
                  pendingPreviews={pendingCnhAssets.map((asset) => ({
                    url: asset.previewUrl,
                    name: asset.label,
                  }))}
                />
              )}
            </>
          );
        }}
      </EntityForm>
    </>
  );
}

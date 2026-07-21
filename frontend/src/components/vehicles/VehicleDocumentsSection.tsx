"use client";

import { useRef, useState } from "react";
import { AttachmentGallery } from "@/components/drivers/AttachmentGallery";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { uploadEntityAttachment } from "@/lib/attachments";
import { glassField } from "@/lib/liquid-glass-styles";

export const VEHICLE_DOCUMENT_TYPES = [
  { value: "CRLV", label: "CRLV (documento do veículo)" },
  { value: "ANTT_NTT", label: "Atualização ANTT / NTT" },
  { value: "AUTORIZACAO", label: "Autorização / alvará" },
  { value: "SEGURO", label: "Seguro / apólice" },
  { value: "OUTROS", label: "Outros documentos" },
] as const;

export type PendingVehicleDocument = {
  file: File;
  label: string;
  previewUrl: string;
};

type Props = {
  companyId: string | null;
  vehicleId: string | null;
  disabled?: boolean;
  pendingDocs: PendingVehicleDocument[];
  onPendingDocsChange: (docs: PendingVehicleDocument[]) => void;
  refreshKey?: number;
  onUploaded?: () => void;
};

export function VehicleDocumentsSection({
  companyId,
  vehicleId,
  disabled = false,
  pendingDocs,
  onPendingDocsChange,
  refreshKey = 0,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>("CRLV");
  const [customLabel, setCustomLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const typeLabel =
    VEHICLE_DOCUMENT_TYPES.find((t) => t.value === docType)?.label ?? "Documento";

  const descriptionForUpload = () => {
    if (docType === "OUTROS" && customLabel.trim()) {
      return `Documento — ${customLabel.trim()}`;
    }
    return typeLabel;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !companyId) return;
    setError(null);

    const list = Array.from(files);
    const label = descriptionForUpload();

    if (!vehicleId) {
      const next = [
        ...pendingDocs,
        ...list.map((file) => ({
          file,
          label,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
      onPendingDocsChange(next);
      return;
    }

    setUploading(true);
    let ok = 0;
    for (const file of list) {
      const { error: uploadError } = await uploadEntityAttachment({
        companyId,
        entityType: "vehicle",
        entityId: vehicleId,
        file,
        description: label,
      });
      if (!uploadError) ok += 1;
      else setError(uploadError);
    }
    setUploading(false);

    if (ok > 0) {
      setLocalRefresh((k) => k + 1);
      onUploaded?.();
    }
    if (ok < list.length && !error) {
      setError(`Enviados ${ok}/${list.length}. Verifique o restante.`);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Documentos do veículo</p>
        <p className="text-xs text-slate-500">
          Envie imagens ou PDF do CRLV, atualização ANTT/NTT e demais autorizações. Os arquivos
          ficam gravados no banco (Storage + anexos) vinculados a este veículo.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Tipo do documento</span>
          <select
            className={glassField(false)}
            value={docType}
            disabled={disabled || uploading}
            onChange={(e) => setDocType(e.target.value)}
          >
            {VEHICLE_DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {docType === "OUTROS" ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Descrição</span>
            <input
              className={glassField(false)}
              value={customLabel}
              disabled={disabled || uploading}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Ex.: Licença ambiental"
            />
          </label>
        ) : (
          <div className="flex items-end">
            <p className="text-xs text-slate-500">
              {vehicleId
                ? "O upload grava imediatamente no banco."
                : "Salve o veículo primeiro; os arquivos selecionados sobem ao salvar."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          disabled={disabled || uploading || !companyId}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || uploading || !companyId}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Enviando..." : "Selecionar arquivo(s)"}
        </Button>
        {!vehicleId && pendingDocs.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              pendingDocs.forEach((d) => URL.revokeObjectURL(d.previewUrl));
              onPendingDocsChange([]);
            }}
          >
            Limpar pendentes
          </Button>
        ) : null}
      </div>

      {companyId ? (
        <AttachmentGallery
          companyId={companyId}
          entityType="vehicle"
          entityId={vehicleId}
          refreshKey={refreshKey + localRefresh}
          title="Galeria de documentos"
          hint="CRLV, ANTT/NTT e demais documentos vinculados ao veículo."
          pendingPreviews={pendingDocs.map((d) => ({
            url: d.previewUrl,
            name: d.label,
          }))}
        />
      ) : null}
    </div>
  );
}

/** Envia documentos pendentes após criar o veículo. */
export async function uploadPendingVehicleDocuments(params: {
  companyId: string;
  vehicleId: string;
  docs: PendingVehicleDocument[];
}): Promise<{ uploaded: number; errors: number }> {
  let uploaded = 0;
  let errors = 0;
  for (const doc of params.docs) {
    const { error } = await uploadEntityAttachment({
      companyId: params.companyId,
      entityType: "vehicle",
      entityId: params.vehicleId,
      file: doc.file,
      description: doc.label,
    });
    if (error) errors += 1;
    else uploaded += 1;
  }
  return { uploaded, errors };
}

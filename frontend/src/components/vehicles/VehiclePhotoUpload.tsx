"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import {
  getVehiclePhotoUrl,
  removeVehiclePhoto,
  uploadVehiclePhoto,
  validateVehiclePhotoFile,
} from "@/lib/vehicle-photo";

type Props = {
  companyId: string | null;
  vehicleId: string | null;
  photoStoragePath: string | null;
  disabled?: boolean;
  pendingFile?: File | null;
  onPendingFileChange?: (file: File | null) => void;
  onPhotoPathChange: (path: string | null) => void;
};

export function VehiclePhotoUpload({
  companyId,
  vehicleId,
  photoStoragePath,
  disabled,
  pendingFile = null,
  onPendingFileChange,
  onPhotoPathChange,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      setError(null);
      if (pendingFile) {
        objectUrl = URL.createObjectURL(pendingFile);
        if (!cancelled) setPreviewUrl(objectUrl);
        return;
      }
      const signed = await getVehiclePhotoUrl(photoStoragePath);
      if (!cancelled) setPreviewUrl(signed);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pendingFile, photoStoragePath]);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setInfo(null);
    const validation = validateVehiclePhotoFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    if (!vehicleId || !companyId) {
      onPendingFileChange?.(file);
      setInfo(
        onPendingFileChange
          ? "Foto selecionada. Ela será enviada ao salvar o cadastro do veículo."
          : "Salve o veículo antes de enviar a foto."
      );
      return;
    }

    setBusy(true);
    const { path, error: uploadError } = await uploadVehiclePhoto({
      companyId,
      vehicleId,
      file,
      previousPath: photoStoragePath,
    });
    setBusy(false);

    if (uploadError || !path) {
      setError(uploadError ?? "Não foi possível enviar a foto.");
      return;
    }

    onPendingFileChange?.(null);
    onPhotoPathChange(path);
    setInfo("Foto atualizada. Ela aparece na OS e no voucher (somente leitura).");
  };

  const handleRemove = async () => {
    setError(null);
    setInfo(null);

    if (pendingFile) {
      onPendingFileChange?.(null);
      return;
    }

    if (!vehicleId || !photoStoragePath) {
      onPhotoPathChange(null);
      return;
    }

    if (!confirm("Remover a foto deste veículo?")) return;
    setBusy(true);
    const removeError = await removeVehiclePhoto({
      vehicleId,
      storagePath: photoStoragePath,
    });
    setBusy(false);
    if (removeError) {
      setError(removeError);
      return;
    }
    onPhotoPathChange(null);
    setInfo("Foto removida.");
  };

  return (
    <div className={`space-y-3 sm:col-span-2 ${glassFilterPanel()}`}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Foto do veículo (obrigatória na frota)</h3>
        <p className="mt-1 text-xs text-slate-600">
          Envie a foto mestre aqui no cadastro. Na OS e no voucher ela aparece só para
          visualização — sem upload na ordem.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {info ? <Alert variant="info">{info}</Alert> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Foto do veículo" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-xs text-slate-500">Sem foto</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              void handleFile(file);
            }}
          />
          <label htmlFor={inputId} className="sr-only">
            Selecionar foto do veículo
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={disabled || busy} onClick={pickFile}>
              {busy ? "Enviando…" : previewUrl ? "Trocar foto" : "Enviar foto"}
            </Button>
            {previewUrl ? (
              <Button
                type="button"
                variant="secondary"
                disabled={disabled || busy}
                onClick={() => void handleRemove()}
              >
                Remover
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            JPG, PNG ou WEBP · máx. 5 MB. Bucket company-attachments.
          </p>
        </div>
      </div>
    </div>
  );
}

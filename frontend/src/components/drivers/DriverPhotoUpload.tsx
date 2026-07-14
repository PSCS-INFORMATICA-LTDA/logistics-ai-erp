"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import {
  getDriverPhotoUrl,
  removeDriverPhoto,
  uploadDriverPhoto,
  validateDriverPhotoFile,
} from "@/lib/driver-photo";

type Props = {
  companyId: string | null;
  driverId: string | null;
  photoStoragePath: string | null;
  disabled?: boolean;
  /** Arquivo pendente (cadastro novo — envia ao salvar). */
  pendingFile: File | null;
  onPendingFileChange: (file: File | null) => void;
  onPhotoPathChange: (path: string | null) => void;
};

export function DriverPhotoUpload({
  companyId,
  driverId,
  photoStoragePath,
  disabled,
  pendingFile,
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
      const signed = await getDriverPhotoUrl(photoStoragePath);
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
    const validation = validateDriverPhotoFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    if (!driverId || !companyId) {
      onPendingFileChange(file);
      setInfo("Foto selecionada. Ela será enviada ao salvar o cadastro do motorista.");
      return;
    }

    setBusy(true);
    const { path, error: uploadError } = await uploadDriverPhoto({
      companyId,
      driverId,
      file,
      previousPath: photoStoragePath,
    });
    setBusy(false);

    if (uploadError || !path) {
      setError(uploadError ?? "Não foi possível enviar a foto.");
      return;
    }

    onPendingFileChange(null);
    onPhotoPathChange(path);
    setInfo("Foto atualizada. Ela aparece no voucher de Transporte e Frete.");
  };

  const handleRemove = async () => {
    setError(null);
    setInfo(null);

    if (pendingFile) {
      onPendingFileChange(null);
      return;
    }

    if (!driverId || !photoStoragePath) {
      onPhotoPathChange(null);
      return;
    }

    if (!confirm("Remover a foto deste motorista?")) return;
    setBusy(true);
    const removeError = await removeDriverPhoto({
      driverId,
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
        <h3 className="text-sm font-semibold text-slate-900">Foto do motorista (voucher)</h3>
        <p className="mt-1 text-xs text-slate-600">
          Rafael: envie a foto de rosto do motorista. Ela sai no voucher final de{" "}
          <strong>Transporte</strong> e <strong>Frete</strong>.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {info ? <Alert variant="info">{info}</Alert> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Foto do motorista" className="h-full w-full object-cover" />
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
            Selecionar foto do motorista
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
            JPG, PNG ou WEBP · máx. 5 MB. Use o botão para escolher o arquivo no celular ou no PC.
          </p>
        </div>
      </div>
    </div>
  );
}

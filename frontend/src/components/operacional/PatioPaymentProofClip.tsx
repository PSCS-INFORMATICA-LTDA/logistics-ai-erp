"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAttachmentSignedUrl,
  listEntityAttachments,
  uploadEntityAttachment,
  type AttachmentEntityType,
} from "@/lib/attachments";
import { glassIconBtn } from "@/lib/liquid-glass-styles";

export const PATIO_PAYMENT_PROOF_DESCRIPTION = "Comprovante pagamento pátio";

type Props = {
  companyId: string;
  entityType: Extract<AttachmentEntityType, "parking_entry" | "car_wash_service">;
  entityId: string;
  code: string;
};

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function PatioPaymentProofClip({ companyId, entityType, entityId, code }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [proofCount, setProofCount] = useState(0);

  const refreshCount = useCallback(async () => {
    const { attachments } = await listEntityAttachments({
      companyId,
      entityType,
      entityId,
    });
    const count = attachments.filter(
      (item) => item.description === PATIO_PAYMENT_PROOF_DESCRIPTION
    ).length;
    setProofCount(count);
  }, [companyId, entityType, entityId]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const { error } = await uploadEntityAttachment({
      companyId,
      entityType,
      entityId,
      file,
      description: PATIO_PAYMENT_PROOF_DESCRIPTION,
    });
    setUploading(false);
    if (error) {
      window.alert(error);
      return;
    }
    await refreshCount();
  };

  const handleViewLatest = async () => {
    setOpening(true);
    const { attachments, error } = await listEntityAttachments({
      companyId,
      entityType,
      entityId,
    });
    setOpening(false);
    if (error) {
      window.alert(error);
      return;
    }
    const proof = [...attachments]
      .reverse()
      .find((item) => item.description === PATIO_PAYMENT_PROOF_DESCRIPTION);
    if (!proof) {
      window.alert("Nenhum comprovante anexado nesta ordem.");
      return;
    }
    const url = await getAttachmentSignedUrl(proof.storage_path);
    if (!url) {
      window.alert("Não foi possível abrir o comprovante.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        aria-label={`Anexar comprovante ${code}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        title="Anexar comprovante (Pix, cartão ou dinheiro) — opcional"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className={glassIconBtn()}
      >
        <PaperclipIcon className="h-4 w-4" />
      </button>
      {proofCount > 0 ? (
        <button
          type="button"
          disabled={opening}
          onClick={() => void handleViewLatest()}
          className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
        >
          {opening ? "Abrindo…" : `${proofCount}`}
        </button>
      ) : (
        <span className="text-xs text-slate-400">{uploading ? "…" : ""}</span>
      )}
    </div>
  );
}

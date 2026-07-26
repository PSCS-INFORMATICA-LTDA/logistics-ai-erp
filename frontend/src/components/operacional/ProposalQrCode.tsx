"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Props = {
  url: string;
  title?: string;
  hint?: string;
  compact?: boolean;
};

export function ProposalQrCode({
  url,
  title = "QR Code da proposta",
  hint = "O cliente pode escanear com a câmera do celular para abrir o link.",
  compact = false,
}: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const generate = () => {
      void import("qrcode")
        .then(({ default: QRCode }) =>
          QRCode.toDataURL(url, {
            width: compact ? 160 : 220,
            margin: 2,
            errorCorrectionLevel: "M",
            color: { dark: "#0f172a", light: "#ffffff" },
          })
        )
        .then((value) => {
          if (!cancelled) setDataUrl(value);
        })
        .catch(() => {
          if (!cancelled) setError("Não foi possível gerar o QR Code.");
        });
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(generate, { timeout: 800 });
    } else {
      timeoutId = setTimeout(generate, 0);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [url, compact]);

  const download = () => {
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = url.includes("/ticket/")
      ? "comprovante-patio-qrcode.png"
      : "proposta-grx-qrcode.png";
    anchor.click();
  };

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  if (!dataUrl) {
    return <p className="text-xs text-slate-500">Gerando QR Code...</p>;
  }

  return (
    <div className={compact ? "inline-flex flex-col items-center gap-2" : "space-y-3"}>
      {!compact && (
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
      )}
      <img
        src={dataUrl}
        alt="QR Code para abrir a proposta GRX"
        className={compact ? "h-40 w-40 rounded-lg border border-slate-200 bg-white p-2" : "h-[220px] w-[220px] rounded-lg border border-slate-200 bg-white p-2"}
      />
      {!compact && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={download}>
            Baixar QR Code (PNG)
          </Button>
        </div>
      )}
      {!compact && (
        <p className="break-all text-xs text-slate-400">{url}</p>
      )}
    </div>
  );
}

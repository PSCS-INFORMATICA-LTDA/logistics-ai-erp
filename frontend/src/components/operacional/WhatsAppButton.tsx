"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WhatsAppIcon } from "@/components/icons/ShareIcons";
import { Button } from "@/components/ui/Button";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { glassAction } from "@/lib/liquid-glass-styles";
import { formatWhatsAppPhoneDisplay } from "@/lib/service-order-proposal";
import {
  logWhatsAppOpenRequested,
  type WhatsAppReferenceType,
} from "@/lib/whatsapp-open-log";
import {
  copyWhatsAppMessageSync,
  normalizeWhatsAppPhone,
  openWhatsApp,
  openWhatsAppWeb,
} from "@/lib/whatsapp";

type Props = {
  phone: string | null | undefined;
  message: string;
  referenceType: WhatsAppReferenceType;
  referenceId: string;
  className?: string;
  wrapperClassName?: string;
  title?: string;
  "aria-label"?: string;
  disabled?: boolean;
  children?: ReactNode;
  /** @deprecated O painel já oferece Web + Desktop. Mantido por compat. */
  showWebOption?: boolean;
  onOpenRequested?: (meta?: { copied: boolean; mode: string }) => void;
  onInvalidPhone?: () => void;
};

/**
 * Abre um painel no ERP (mensagem + copiar + tentar Desktop + Web).
 * O protocolo sozinho no Windows/Store muitas vezes não traz o app para frente;
 * o Web exige login (QR). O painel garante um caminho utilizável.
 */
export function WhatsAppButton({
  phone,
  message,
  referenceType,
  referenceId,
  className,
  wrapperClassName,
  title,
  "aria-label": ariaLabel,
  disabled,
  children,
  onOpenRequested,
  onInvalidPhone,
}: Props) {
  const { companyId } = useCompany();
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [copiedHint, setCopiedHint] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const openingRef = useRef(false);
  const phoneDigits = normalizeWhatsAppPhone(phone);
  const phoneOk = Boolean(phoneDigits);
  const phoneLabel = formatWhatsAppPhoneDisplay(phoneDigits) || phoneDigits || "";

  useEffect(() => {
    setMounted(true);
  }, []);

  const logOpen = (digits: string, meta: { copied: boolean; mode: string }) => {
    onOpenRequested?.(meta);
    void (async () => {
      if (!companyId) return;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await logWhatsAppOpenRequested(supabase, {
        companyId,
        userId: user?.id ?? null,
        phone: digits,
        referenceType,
        referenceId,
      });
    })();
  };

  const openPanel = () => {
    if (disabled || busy) return;
    if (!phoneOk || !phoneDigits) {
      onInvalidPhone?.();
      return;
    }
    const copied = message.trim() ? copyWhatsAppMessageSync(message) : false;
    setCopiedHint(
      copied
        ? "Mensagem copiada. No WhatsApp use Ctrl+V."
        : "Não foi possível copiar automaticamente — selecione o texto abaixo e copie."
    );
    setPanelOpen(true);
    logOpen(phoneDigits, { copied, mode: "compose-panel" });
  };

  const handleDesktop = () => {
    if (!phoneOk || !phoneDigits || openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    const result = openWhatsApp({ phone: phoneDigits, message });
    setCopiedHint(
      result.copied
        ? "Pedimos ao Windows abrir o app. Se não aparecer, clique no WhatsApp na barra de tarefas e use Ctrl+V."
        : "Pedimos ao Windows abrir o app. Se não aparecer, use a barra de tarefas."
    );
    window.setTimeout(() => {
      setBusy(false);
      openingRef.current = false;
    }, 1500);
    if (result.ok && result.mode !== "debounced") {
      logOpen(phoneDigits, { copied: result.copied, mode: "native" });
    }
  };

  const handleWeb = () => {
    if (!phoneOk || !phoneDigits || openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    const result = openWhatsAppWeb({ phone: phoneDigits, message });
    if (result.ok) {
      logOpen(phoneDigits, { copied: result.copied, mode: "web" });
    } else {
      setBusy(false);
      openingRef.current = false;
    }
  };

  const handleCopy = () => {
    const ok = copyWhatsAppMessageSync(message);
    setCopiedHint(ok ? "Mensagem copiada de novo." : "Falha ao copiar — selecione o texto manualmente.");
  };

  const panel =
    mounted && panelOpen
      ? createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wa-compose-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPanelOpen(false);
            }}
          >
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <h2 id="wa-compose-title" className="text-lg font-semibold text-slate-900">
                Enviar no WhatsApp
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Destino: <strong>{phoneLabel}</strong>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                No Windows o app da Store muitas vezes <strong>não vem para frente</strong>. O Web
                só funciona se este Chrome já estiver logado (senão aparece QR). Use o caminho que
                funcionar aí.
              </p>

              <textarea
                readOnly
                rows={8}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                value={message}
              />

              {copiedHint ? (
                <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {copiedHint}
                </p>
              ) : null}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  variant="moss"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2"
                  onClick={handleDesktop}
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  Abrir app Desktop
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={handleCopy}>
                  Copiar mensagem
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  title="Requer WhatsApp Web já logado neste navegador"
                  onClick={handleWeb}
                >
                  Abrir WhatsApp Web
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPanelOpen(false)}
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-2",
          children ? "w-full" : undefined,
          wrapperClassName
        )}
      >
        <button
          type="button"
          title={title ?? (phoneOk ? "Preparar envio no WhatsApp" : "Cadastre o telefone")}
          aria-label={ariaLabel ?? (phoneOk ? "Abrir WhatsApp" : "WhatsApp indisponível")}
          disabled={disabled || busy}
          className={cn(
            glassAction("green", true),
            "inline-flex h-10 w-10 shrink-0 items-center justify-center p-0",
            children ? "h-auto w-full sm:w-auto" : undefined,
            (!phoneOk || disabled) && "opacity-50",
            className
          )}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            e.stopPropagation();
            openPanel();
          }}
        >
          {children ?? <WhatsAppIcon className="h-5 w-5" />}
        </button>
      </span>
      {panel}
    </>
  );
}

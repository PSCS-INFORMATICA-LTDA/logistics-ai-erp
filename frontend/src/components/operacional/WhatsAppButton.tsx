"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { WhatsAppIcon } from "@/components/icons/ShareIcons";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { glassAction } from "@/lib/liquid-glass-styles";
import {
  logWhatsAppOpenRequested,
  type WhatsAppReferenceType,
} from "@/lib/whatsapp-open-log";
import {
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
  /** Fallback wa.me — útil quando o Desktop da Store não vem para frente. */
  showWebOption?: boolean;
  onOpenRequested?: (meta?: { copied: boolean; mode: string }) => void;
  onInvalidPhone?: () => void;
};

/**
 * Botão WhatsApp: um clique → um location.assign(whatsapp://).
 * Web só se showWebOption e o usuário clicar no link secundário.
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
  showWebOption = false,
  onOpenRequested,
  onInvalidPhone,
}: Props) {
  const { companyId } = useCompany();
  const [busy, setBusy] = useState(false);
  const openingRef = useRef(false);
  const phoneOk = Boolean(normalizeWhatsAppPhone(phone));

  const afterOpen = (phoneDigits: string, meta: { copied: boolean; mode: string }) => {
    window.setTimeout(() => {
      onOpenRequested?.(meta);
    }, 0);

    void (async () => {
      try {
        if (!companyId) return;
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await logWhatsAppOpenRequested(supabase, {
          companyId,
          userId: user?.id ?? null,
          phone: phoneDigits,
          referenceType,
          referenceId,
        });
      } finally {
        window.setTimeout(() => {
          setBusy(false);
          openingRef.current = false;
        }, 2000);
      }
    })();
  };

  const handleNativeClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (disabled || busy || openingRef.current) return;

    if (!phoneOk) {
      onInvalidPhone?.();
      return;
    }

    openingRef.current = true;
    setBusy(true);

    const result = openWhatsApp({ phone: phone!, message });

    if (!result.ok || !result.phoneDigits) {
      openingRef.current = false;
      setBusy(false);
      onInvalidPhone?.();
      return;
    }

    if (result.mode === "debounced") {
      window.setTimeout(() => {
        setBusy(false);
        openingRef.current = false;
      }, 300);
      return;
    }

    afterOpen(result.phoneDigits, { copied: result.copied, mode: result.mode });
  };

  const handleWebClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (disabled || busy || openingRef.current) return;

    if (!phoneOk) {
      onInvalidPhone?.();
      return;
    }

    openingRef.current = true;
    setBusy(true);
    const result = openWhatsAppWeb({ phone: phone!, message });

    if (!result.ok || !result.phoneDigits) {
      openingRef.current = false;
      setBusy(false);
      onInvalidPhone?.();
      return;
    }

    afterOpen(result.phoneDigits, { copied: result.copied, mode: result.mode });
  };

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-2",
        children ? "w-full" : undefined,
        wrapperClassName
      )}
    >
      <button
        type="button"
        title={
          title ??
          (phoneOk
            ? "Abrir WhatsApp Desktop (mensagem copiada — Ctrl+V)"
            : "Cadastre o telefone para abrir o WhatsApp")
        }
        aria-label={
          ariaLabel ??
          (phoneOk ? "Abrir WhatsApp Desktop" : "WhatsApp indisponível — telefone não cadastrado")
        }
        disabled={disabled || busy}
        className={cn(
          glassAction("green", true),
          "inline-flex h-10 w-10 shrink-0 items-center justify-center p-0",
          children ? "h-auto w-full sm:w-auto" : undefined,
          (!phoneOk || disabled) && "opacity-50",
          className
        )}
        onClick={handleNativeClick}
      >
        {children ?? <WhatsAppIcon className="h-5 w-5" />}
      </button>

      {showWebOption && phoneOk ? (
        <button
          type="button"
          disabled={disabled || busy}
          className={cn(
            glassAction("emerald", true),
            "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 px-2.5 text-xs font-semibold",
            (disabled || busy) && "opacity-50"
          )}
          title="Abrir no navegador (WhatsApp Web) — use se o app Desktop não aparecer"
          aria-label="Usar WhatsApp Web"
          onClick={handleWebClick}
        >
          <WhatsAppIcon className="h-4 w-4" />
          Web
        </button>
      ) : null}
    </span>
  );
}

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
  buildWhatsAppNativeUrl,
  copyWhatsAppMessageSync,
  normalizeWhatsAppPhone,
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
  showWebOption?: boolean;
  onOpenRequested?: () => void;
  onInvalidPhone?: () => void;
};

/**
 * Botão WhatsApp: <a href="whatsapp://…"> real (Chrome exige gesto nativo no link).
 * Windows: só phone na URL; mensagem vai para a área de transferência.
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
  const phoneDigits = normalizeWhatsAppPhone(phone);
  const phoneOk = Boolean(phoneDigits);
  const nativeHref = phoneOk
    ? buildWhatsAppNativeUrl({ phone: phoneDigits! })
    : null;

  const logOpen = (digits: string) => {
    window.setTimeout(() => {
      onOpenRequested?.();
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
          phone: digits,
          referenceType,
          referenceId,
        });
      } finally {
        window.setTimeout(() => {
          setBusy(false);
          openingRef.current = false;
        }, 1500);
      }
    })();
  };

  const handleNativeClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled || busy) {
      event.preventDefault();
      return;
    }

    if (!phoneOk || !nativeHref || !phoneDigits) {
      event.preventDefault();
      onInvalidPhone?.();
      return;
    }

    if (openingRef.current) {
      event.preventDefault();
      return;
    }

    openingRef.current = true;
    setBusy(true);

    // Copia a mensagem no mesmo gesto do clique (antes do protocolo).
    if (message.trim()) copyWhatsAppMessageSync(message);

    // NÃO preventDefault: o navegador segue href=whatsapp:// (único jeito confiável no Chrome).
    logOpen(phoneDigits);
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

    logOpen(result.phoneDigits);
  };

  const sharedClass = cn(
    glassAction("green", true),
    "inline-flex h-10 w-10 shrink-0 items-center justify-center p-0 no-underline",
    children ? "h-auto w-full" : undefined,
    (!phoneOk || disabled || busy) && "pointer-events-none opacity-50",
    className
  );

  return (
    <span
      className={cn(
        "inline-flex",
        showWebOption ? "flex-col items-start gap-1.5" : "items-center",
        children ? "w-full" : undefined,
        wrapperClassName
      )}
    >
      {phoneOk && nativeHref ? (
        <a
          href={nativeHref}
          title={
            title ?? "Abrir WhatsApp Desktop no chat do contato (mensagem: Ctrl+V)"
          }
          aria-label={ariaLabel ?? "Abrir WhatsApp Desktop"}
          className={sharedClass}
          onClick={handleNativeClick}
        >
          {children ?? <WhatsAppIcon className="h-5 w-5" />}
        </a>
      ) : (
        <button
          type="button"
          title="Cadastre o telefone para abrir o WhatsApp"
          aria-label="WhatsApp indisponível — telefone não cadastrado"
          className={sharedClass}
          onClick={() => onInvalidPhone?.()}
        >
          {children ?? <WhatsAppIcon className="h-5 w-5" />}
        </button>
      )}

      {showWebOption && phoneOk ? (
        <button
          type="button"
          disabled={disabled || busy}
          className="max-w-full text-left text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 disabled:opacity-50"
          title="Abrir pelo navegador (WhatsApp Web). Use só se o app Desktop não abrir."
          onClick={handleWebClick}
        >
          Usar WhatsApp Web
        </button>
      ) : null}
    </span>
  );
}

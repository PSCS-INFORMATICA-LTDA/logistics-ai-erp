"use client";

import { useState, type ReactNode } from "react";
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
  /** Classes do botão principal (padrão: ícone verde compacto). */
  className?: string;
  /** Classes do wrapper (ícone + opção Web). */
  wrapperClassName?: string;
  title?: string;
  "aria-label"?: string;
  disabled?: boolean;
  children?: ReactNode;
  /** Exibir link secundário "Usar WhatsApp Web" (padrão: true). */
  showWebOption?: boolean;
  /** Após solicitar abertura. Não marca “enviado”. */
  onOpenRequested?: () => void;
  /** Telefone inválido / faltando. */
  onInvalidPhone?: () => void;
};

/**
 * Único botão WhatsApp do ERP (proposta, motorista, lava, ticket).
 * Principal: whatsapp:// na mesma janela. Web: só se o usuário clicar em "Usar WhatsApp Web".
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
  showWebOption = true,
  onOpenRequested,
  onInvalidPhone,
}: Props) {
  const { companyId } = useCompany();
  const [busy, setBusy] = useState(false);
  const phoneOk = Boolean(normalizeWhatsAppPhone(phone));

  const logOpen = (phoneDigits: string) => {
    onOpenRequested?.();
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
        window.setTimeout(() => setBusy(false), 400);
      }
    })();
  };

  const handleNativeClick = () => {
    if (disabled || busy) return;

    if (!phoneOk) {
      onInvalidPhone?.();
      return;
    }

    setBusy(true);
    const result = openWhatsApp({ phone: phone!, message });

    if (!result.ok || !result.phoneDigits) {
      setBusy(false);
      onInvalidPhone?.();
      return;
    }

    logOpen(result.phoneDigits);
  };

  const handleWebClick = () => {
    if (disabled || busy) return;

    if (!phoneOk) {
      onInvalidPhone?.();
      return;
    }

    setBusy(true);
    const result = openWhatsAppWeb({ phone: phone!, message });

    if (!result.ok || !result.phoneDigits) {
      setBusy(false);
      onInvalidPhone?.();
      return;
    }

    logOpen(result.phoneDigits);
  };

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-2",
        children ? "w-full flex-col items-stretch sm:flex-row sm:items-center" : undefined,
        wrapperClassName
      )}
    >
      <button
        type="button"
        title={
          title ??
          (phoneOk
            ? "Abrir WhatsApp Desktop no chat do contato"
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
          !phoneOk || disabled ? "opacity-50" : undefined,
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
          className="text-left text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 disabled:opacity-50"
          title="Abrir pelo navegador (WhatsApp Web). Use só se o app Desktop não abrir."
          onClick={handleWebClick}
        >
          Usar WhatsApp Web
        </button>
      ) : null}
    </span>
  );
}

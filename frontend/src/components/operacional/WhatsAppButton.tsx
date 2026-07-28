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
import { normalizeWhatsAppPhone, openWhatsApp } from "@/lib/whatsapp";

type Props = {
  phone: string | null | undefined;
  message: string;
  referenceType: WhatsAppReferenceType;
  referenceId: string;
  /** Classes do botão (padrão: ícone verde compacto). */
  className?: string;
  title?: string;
  "aria-label"?: string;
  disabled?: boolean;
  children?: ReactNode;
  /** Após solicitar abertura (ex.: marcar status Pronto). Não marca “enviado”. */
  onOpenRequested?: () => void;
  /** Telefone inválido / faltando. */
  onInvalidPhone?: () => void;
};

/**
 * Único botão WhatsApp do ERP (proposta, motorista, lava).
 * Abre via whatsapp:// (sem aba nova); fallback wa.me se a página continuar visível.
 */
export function WhatsAppButton({
  phone,
  message,
  referenceType,
  referenceId,
  className,
  title,
  "aria-label": ariaLabel,
  disabled,
  children,
  onOpenRequested,
  onInvalidPhone,
}: Props) {
  const { companyId } = useCompany();
  const [busy, setBusy] = useState(false);
  const phoneOk = Boolean(normalizeWhatsAppPhone(phone));

  const handleClick = () => {
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

    onOpenRequested?.();

    // Log assíncrono — não bloqueia o protocolo nativo.
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
          phone: result.phoneDigits!,
          referenceType,
          referenceId,
        });
      } finally {
        window.setTimeout(() => setBusy(false), 400);
      }
    })();
  };

  return (
    <button
      type="button"
      title={
        title ??
        (phoneOk
          ? "Abrir WhatsApp no chat do contato"
          : "Cadastre o telefone para abrir o WhatsApp")
      }
      aria-label={
        ariaLabel ??
        (phoneOk ? "Abrir WhatsApp" : "WhatsApp indisponível — telefone não cadastrado")
      }
      disabled={disabled || busy}
      className={cn(
        glassAction("green", true),
        "inline-flex h-10 w-10 shrink-0 items-center justify-center p-0",
        (!phoneOk || disabled) && "opacity-50",
        className
      )}
      onClick={handleClick}
    >
      {children ?? <WhatsAppIcon className="h-5 w-5" />}
    </button>
  );
}

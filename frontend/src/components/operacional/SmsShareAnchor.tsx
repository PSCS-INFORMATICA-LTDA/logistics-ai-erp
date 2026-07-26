"use client";

import type { MouseEvent, ReactNode } from "react";
import { copyTextToClipboardSync } from "@/lib/service-order-proposal";
import { canUseDeviceSms } from "@/lib/wash-notify";

type Props = {
  href: string;
  message: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
  /** Depois do gesto (ex.: gravar status Pronto). */
  onOpen?: () => void;
  /** Aviso no desktop quando o SO não tem app SMS. */
  onDesktopHint?: () => void;
};

/**
 * Abre o app SMS nativo no celular.
 * No PC: copia a mensagem e tenta o protocolo sms: (Phone Link / app).
 */
export function SmsShareAnchor({
  href,
  message,
  className,
  title,
  "aria-label": ariaLabel,
  children,
  onOpen,
  onDesktopHint,
}: Props) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    copyTextToClipboardSync(message);
    onOpen?.();

    if (!canUseDeviceSms()) {
      // Desktop: muitos PCs não têm handler SMS — não cancela o href (Phone Link pode abrir),
      // mas avisa o operador.
      onDesktopHint?.();
      return;
    }

    // Celular: deixa o <a href="sms:…"> seguir o gesto nativo (mais confiável que assign).
    event.preventDefault();
    window.location.href = href;
  };

  return (
    <a
      href={href}
      title={title}
      aria-label={ariaLabel}
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

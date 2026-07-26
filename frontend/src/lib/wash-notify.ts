import {
  buildWhatsAppShareLinks,
  formatPhoneForWhatsApp,
  isWindowsWhatsAppDesktop,
  type WhatsAppShareLinks,
} from "@/lib/service-order-proposal";

export function buildWashReadyMessage(params: {
  companyName: string;
  plate: string;
  clientName?: string | null;
  serviceName?: string | null;
}): string {
  const name = params.clientName?.trim();
  const greeting = name ? `Olá, ${name}!` : "Olá!";
  return [
    `*${params.companyName}*`,
    "",
    greeting,
    "",
    `Boa notícia: o *${params.plate}* está pronto para retirada.`,
    "Pode vir buscar quando quiser 🙂",
  ].join("\n");
}

export function buildWashReadyWhatsApp(params: {
  companyName: string;
  plate: string;
  phone?: string | null;
  clientName?: string | null;
  serviceName?: string | null;
}) {
  const message = buildWashReadyMessage(params);
  return { message, links: buildWhatsAppShareLinks(message, params.phone) };
}

/** Href WhatsApp mais confiável por plataforma (mesma aba / ponte no Windows). */
export function washReadyWhatsAppHref(links: WhatsAppShareLinks): string {
  if (!links.opensDirectChat) return "";
  if (isWindowsWhatsAppDesktop()) {
    return links.desktopBridgeHref || links.primaryHref || "";
  }
  return links.mobileHref || links.primaryHref || links.desktopHref || "";
}

export function canUseDeviceSms(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

/** Abre o app de SMS do aparelho (sem provedor externo). */
export function buildSmsShareHref(phone: string | null | undefined, text: string): string | null {
  const digits = formatPhoneForWhatsApp(phone);
  if (!digits) return null;
  const body = encodeURIComponent(text);
  // iOS usa &body=; Android usa ?body=.
  const isIos =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  return isIos ? `sms:+${digits}&body=${body}` : `sms:+${digits}?body=${body}`;
}

/** Navega na mesma aba — evita bloqueio de popup do target=_blank. */
export function launchShareHref(href: string): void {
  if (!href) return;
  window.location.assign(href);
}

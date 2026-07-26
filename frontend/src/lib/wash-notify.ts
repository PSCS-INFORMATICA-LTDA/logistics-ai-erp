import {
  buildWhatsAppShareLinks,
  formatPhoneForWhatsApp,
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

/** Abre o app de SMS do aparelho (sem provedor externo). */
export function buildSmsShareHref(phone: string | null | undefined, text: string): string | null {
  const digits = formatPhoneForWhatsApp(phone);
  if (!digits) return null;
  const body = encodeURIComponent(text);
  // iOS usa &body=; Android/desktop usam ?body=.
  const isIos =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  return isIos ? `sms:+${digits}&body=${body}` : `sms:+${digits}?body=${body}`;
}

/** Dispara sms: / whatsapp: com clique sintético (mais confiável após await). */
export function launchShareHref(href: string): void {
  if (!href) return;
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

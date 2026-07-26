import {
  buildWhatsAppShareLinks,
  formatPhoneForWhatsApp,
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

/** Texto SMS sem markdown/emoji (melhor compatibilidade com app de mensagens). */
export function buildWashReadySmsMessage(params: {
  companyName: string;
  plate: string;
  clientName?: string | null;
}): string {
  const name = params.clientName?.trim();
  const greeting = name ? `Olá, ${name}!` : "Olá!";
  return [
    params.companyName.trim() || "Lava-rápido",
    greeting,
    `Boa notícia: o ${params.plate} está pronto para retirada.`,
    "Pode vir buscar quando quiser.",
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
  return {
    message,
    links: buildWhatsAppShareLinks(message, params.phone, { recipient: "cliente" }),
  };
}

/**
 * Mesmo critério da proposta/OS: `primaryHref` (WhatsAppAppAnchor).
 * Windows → /abrir-whatsapp; mobile → wa.me; outros → whatsapp://.
 */
export function washReadyWhatsAppHref(links: WhatsAppShareLinks): string {
  if (!links.opensDirectChat) return "";
  return links.primaryHref || "";
}

export function canUseDeviceSms(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

/**
 * Número para SMS nativo no Brasil: DDD+número (sem 55).
 * Apps de SMS locais costumam falhar com +55 na URI.
 */
export function phoneDigitsForSms(phone: string | null | undefined): string | null {
  const e164 = formatPhoneForWhatsApp(phone);
  if (!e164) return null;
  if (e164.startsWith("55") && (e164.length === 12 || e164.length === 13)) {
    return e164.slice(2);
  }
  return e164;
}

/**
 * Abre o app de SMS do aparelho (sem provedor externo).
 * Formato universal `?&body=` (Android + iOS).
 */
export function buildSmsShareHref(phone: string | null | undefined, text: string): string | null {
  const digits = phoneDigitsForSms(phone);
  if (!digits) return null;
  const body = encodeURIComponent(text.replace(/\*/g, "").trim());
  if (!body) return `sms:${digits}`;
  // ?& = Android (?body) + iOS (&body)
  return `sms:${digits}?&body=${body}`;
}

/** Navega na mesma aba — evita bloqueio de popup do target=_blank. */
export function launchShareHref(href: string): void {
  if (!href) return;
  window.location.assign(href);
}

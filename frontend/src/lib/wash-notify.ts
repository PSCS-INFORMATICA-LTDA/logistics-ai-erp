import { formatPhoneForWhatsApp } from "@/lib/whatsapp";

function appendTicketLink(lines: string[], ticketUrl?: string | null): string[] {
  const url = ticketUrl?.trim();
  if (!url) return lines;
  return [...lines, "", "Comprovante:", url];
}

export function buildWashReadyMessage(params: {
  companyName: string;
  plate: string;
  clientName?: string | null;
  serviceName?: string | null;
  ticketUrl?: string | null;
}): string {
  const name = params.clientName?.trim();
  const greeting = name ? `Olá, ${name}!` : "Olá!";
  return appendTicketLink(
    [
      `*${params.companyName}*`,
      "",
      greeting,
      "",
      `Seu veículo de placa *${params.plate}* está pronto para retirada.`,
      "",
      "Pode vir buscar quando quiser 🙂",
      "",
      "Até logo!",
    ],
    params.ticketUrl
  ).join("\n");
}

/** Texto SMS sem markdown/emoji (melhor compatibilidade com app de mensagens). */
export function buildWashReadySmsMessage(params: {
  companyName: string;
  plate: string;
  clientName?: string | null;
  ticketUrl?: string | null;
}): string {
  const name = params.clientName?.trim();
  const greeting = name ? `Olá, ${name}!` : "Olá!";
  return appendTicketLink(
    [
      params.companyName.trim() || "Lava-rápido",
      "",
      greeting,
      "",
      `Seu veiculo de placa ${params.plate} esta pronto para retirada.`,
      "",
      "Pode vir buscar quando quiser.",
      "",
      "Ate logo!",
    ],
    params.ticketUrl
  ).join("\n");
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
  return `sms:${digits}?&body=${body}`;
}

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
  const who = params.clientName?.trim() ? ` ${params.clientName.trim()}` : "";
  const service = params.serviceName?.trim() ? ` (${params.serviceName.trim()})` : "";
  return [
    `*${params.companyName}*`,
    `Olá${who}!`,
    `Seu veículo *${params.plate}*${service} está *pronto para retirada*.`,
    "Pode vir buscar quando quiser. Obrigado!",
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
  return `sms:+${digits}?body=${encodeURIComponent(text)}`;
}

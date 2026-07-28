/**
 * Utilitário único de abertura do WhatsApp (proposta, designação, lava-rápido, ticket).
 * Fluxo principal: protocolo nativo (app Desktop). WhatsApp Web só sob ação explícita.
 * Não usa window.open / target=_blank.
 *
 * AUDITORIA: logs [WA-AUDIT] — comportamento de abertura inalterado.
 */

import {
  installWhatsAppNavigationAudit,
  waAuditLog,
} from "@/lib/whatsapp-audit";

export type WhatsAppOpenResult = {
  ok: boolean;
  mode: "native" | "web" | "invalid-phone";
  phoneDigits: string | null;
  error?: string;
};

/** Somente dígitos com DDI (BR → 55…). Sem +, espaços, parênteses ou hífens. */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return digits;
}

export function buildWhatsAppNativeUrl(params: {
  phone: string;
  message?: string;
}): string | null {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) return null;
  const message = params.message ?? "";
  const text = encodeURIComponent(message);
  const url = text
    ? `whatsapp://send?phone=${phoneDigits}&text=${text}`
    : `whatsapp://send?phone=${phoneDigits}`;
  waAuditLog("2-construcao-url-nativa", {
    phoneDigits,
    messageLength: message.length,
    urlPreview: url.slice(0, 160),
  });
  return url;
}

/** URL wa.me — só para a opção secundária "Usar WhatsApp Web". */
export function buildWhatsAppWebUrl(params: {
  phone: string;
  message?: string;
}): string | null {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) return null;
  const message = params.message ?? "";
  const text = encodeURIComponent(message);
  const url = text
    ? `https://wa.me/${phoneDigits}?text=${text}`
    : `https://wa.me/${phoneDigits}`;
  waAuditLog("2-construcao-url-web (wa.me)", {
    phoneDigits,
    messageLength: message.length,
    urlPreview: url.slice(0, 160),
  });
  return url;
}

/**
 * Abre o WhatsApp Desktop pelo protocolo nativo (mesma janela / handler do SO).
 * Sem fallback automático para wa.me / WhatsApp Web.
 */
export function openWhatsApp(params: {
  phone: string;
  message?: string;
}): WhatsAppOpenResult {
  installWhatsAppNavigationAudit();

  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) {
    waAuditLog("openWhatsApp-invalid-phone", { phone: params.phone });
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      error: "Telefone incompleto. Use DDD + número (com DDI 55 se necessário).",
    };
  }

  const nativeUrl = buildWhatsAppNativeUrl({
    phone: phoneDigits,
    message: params.message ?? "",
  });
  if (!nativeUrl) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      error: "Não foi possível montar o link do WhatsApp.",
    };
  }

  waAuditLog("3-abertura-protocolo-nativo", {
    via: "openWhatsApp → window.location.href",
    urlPreview: nativeUrl.slice(0, 160),
  });

  // Protocolo nativo — NÃO usar window.open (gera aba branca / wa.me).
  window.location.href = nativeUrl;

  return { ok: true, mode: "native", phoneDigits };
}

/**
 * Opção secundária explícita: abre wa.me na mesma aba (pode cair no WhatsApp Web).
 */
export function openWhatsAppWeb(params: {
  phone: string;
  message?: string;
}): WhatsAppOpenResult {
  installWhatsAppNavigationAudit();

  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) {
    waAuditLog("openWhatsAppWeb-invalid-phone", { phone: params.phone });
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      error: "Telefone incompleto. Use DDD + número (com DDI 55 se necessário).",
    };
  }

  const webUrl = buildWhatsAppWebUrl({
    phone: phoneDigits,
    message: params.message ?? "",
  });
  if (!webUrl) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      error: "Não foi possível montar o link do WhatsApp Web.",
    };
  }

  waAuditLog("4-navegacao-wa.me", {
    via: "openWhatsAppWeb → window.location.href",
    urlPreview: webUrl.slice(0, 160),
  });

  window.location.href = webUrl;

  return { ok: true, mode: "web", phoneDigits };
}

/** Compat: alias do normalizador usado no restante do ERP. */
export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  return normalizeWhatsAppPhone(phone);
}

/**
 * Utilitário único de abertura do WhatsApp (proposta, designação, lava-rápido).
 * Não usa window.open / target=_blank — evita aba branca no Desktop.
 */

export type WhatsAppOpenResult = {
  ok: boolean;
  mode: "native" | "fallback" | "cancelled" | "invalid-phone";
  phoneDigits: string | null;
  error?: string;
};

/** Somente dígitos com DDI (BR → 55…). */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return digits;
}

export function buildWhatsAppNativeUrl(phoneDigits: string, message: string): string {
  const text = encodeURIComponent(message);
  return text
    ? `whatsapp://send?phone=${phoneDigits}&text=${text}`
    : `whatsapp://send?phone=${phoneDigits}`;
}

export function buildWhatsAppFallbackUrl(phoneDigits: string, message: string): string {
  const text = encodeURIComponent(message);
  return text
    ? `https://wa.me/${phoneDigits}?text=${text}`
    : `https://wa.me/${phoneDigits}`;
}

/**
 * Abre o WhatsApp pelo protocolo nativo (mesma aba / handler do SO).
 * Se o usuário permanecer na página (~1,2s e document ainda visível),
 * faz fallback para wa.me na mesma aba (sem window.open).
 */
export function openWhatsApp(params: {
  phone: string;
  message: string;
  /** Atraso antes do fallback wa.me (ms). */
  fallbackDelayMs?: number;
}): WhatsAppOpenResult {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      error: "Telefone incompleto. Use DDD + número (com DDI 55 se necessário).",
    };
  }

  const message = params.message ?? "";
  const nativeUrl = buildWhatsAppNativeUrl(phoneDigits, message);
  const fallbackUrl = buildWhatsAppFallbackUrl(phoneDigits, message);
  const delay = params.fallbackDelayMs ?? 1200;

  // Protocolo nativo — NÃO usar window.open (gera aba branca).
  window.location.href = nativeUrl;

  window.setTimeout(() => {
    // Se o usuário foi para o app, a página fica oculta → não abre wa.me.
    if (typeof document !== "undefined" && document.hidden) return;
    // Fallback na mesma aba (sem _blank).
    window.location.href = fallbackUrl;
  }, delay);

  return { ok: true, mode: "native", phoneDigits };
}

/** Compat: alias do normalizador usado no restante do ERP. */
export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  return normalizeWhatsAppPhone(phone);
}

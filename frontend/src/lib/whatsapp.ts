/**
 * Utilitário único de abertura do WhatsApp (proposta, designação, lava-rápido, ticket).
 * Windows: whatsapp:// só com phone (texto longo no protocolo falha / vira Web).
 * Mensagem completa vai para a área de transferência (Ctrl+V).
 */

export type WhatsAppOpenResult = {
  ok: boolean;
  mode: "native" | "web" | "invalid-phone" | "debounced";
  phoneDigits: string | null;
  copied: boolean;
  error?: string;
};

/** Debounce curto — só evita double-click, não trava o usuário. */
let lastNativePhone = "";
let lastNativeLaunchAt = 0;
const NATIVE_DEBOUNCE_MS = 1200;

/** Somente dígitos com DDI (BR → 55…). Sem +, espaços, parênteses ou hífens. */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return digits;
}

function isWindowsDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Windows/i.test(ua) && !/Android|iPhone|iPad|iPod/i.test(ua);
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

/** Cópia síncrona no gesto do clique (não usar após await). */
export function copyWhatsAppMessageSync(text: string): boolean {
  if (typeof document === "undefined" || !text) return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * URL nativa.
 * Windows: só phone — URL longa com text quebra e o Chrome/SO caem no Web.
 * Mobile: phone + text curto.
 */
export function buildWhatsAppNativeUrl(params: {
  phone: string;
  message?: string;
}): string | null {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) return null;

  if (isWindowsDesktop()) {
    return `whatsapp://send?phone=${phoneDigits}`;
  }

  const message = (params.message ?? "").trim();
  if (!message) return `whatsapp://send?phone=${phoneDigits}`;

  const max = 500;
  const short =
    encodeURIComponent(message).length <= max
      ? message
      : `${message.slice(0, 180).trim()}…`;
  return `whatsapp://send?phone=${phoneDigits}&text=${encodeURIComponent(short)}`;
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
  return text
    ? `https://wa.me/${phoneDigits}?text=${text}`
    : `https://wa.me/${phoneDigits}`;
}

/**
 * Abre o WhatsApp Desktop no chat do telefone.
 * Usa location.assign no gesto do usuário (Chrome bloqueia <a> sintético oculto).
 * Windows: só phone + mensagem na área de transferência.
 */
export function openWhatsApp(params: {
  phone: string;
  message?: string;
}): WhatsAppOpenResult {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      copied: false,
      error: "Telefone incompleto. Use DDD + número (com DDI 55 se necessário).",
    };
  }

  const now = Date.now();
  if (phoneDigits === lastNativePhone && now - lastNativeLaunchAt < NATIVE_DEBOUNCE_MS) {
    return { ok: true, mode: "debounced", phoneDigits, copied: false };
  }

  const message = params.message ?? "";
  const copied = message.trim() ? copyWhatsAppMessageSync(message) : false;

  const nativeUrl = buildWhatsAppNativeUrl({
    phone: phoneDigits,
    message: isMobileDevice() ? message : undefined,
  });
  if (!nativeUrl) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      copied,
      error: "Não foi possível montar o link do WhatsApp.",
    };
  }

  lastNativePhone = phoneDigits;
  lastNativeLaunchAt = now;

  // Gesto real do usuário: location.assign é o que o Chrome honra para whatsapp://.
  // URL curta (só phone no Windows) — não cai no Web como a URL longa com text.
  window.location.assign(nativeUrl);

  return { ok: true, mode: "native", phoneDigits, copied };
}

/**
 * Opção secundária explícita: abre wa.me na mesma aba (pode cair no WhatsApp Web).
 */
export function openWhatsAppWeb(params: {
  phone: string;
  message?: string;
}): WhatsAppOpenResult {
  const phoneDigits = normalizeWhatsAppPhone(params.phone);
  if (!phoneDigits) {
    return {
      ok: false,
      mode: "invalid-phone",
      phoneDigits: null,
      copied: false,
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
      copied: false,
      error: "Não foi possível montar o link do WhatsApp Web.",
    };
  }

  window.location.assign(webUrl);

  return { ok: true, mode: "web", phoneDigits, copied: false };
}

/** Compat: alias do normalizador usado no restante do ERP. */
export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  return normalizeWhatsAppPhone(phone);
}

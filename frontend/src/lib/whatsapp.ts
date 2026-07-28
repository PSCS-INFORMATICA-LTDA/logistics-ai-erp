/**
 * Utilitário único de abertura do WhatsApp (proposta, designação, lava-rápido, ticket).
 * Fluxo principal: protocolo nativo (app Desktop). WhatsApp Web só sob ação explícita.
 * Não usa window.open / target=_blank / location.href no fluxo nativo.
 */

export type WhatsAppOpenResult = {
  ok: boolean;
  mode: "native" | "web" | "invalid-phone" | "debounced";
  phoneDigits: string | null;
  error?: string;
};

/** Evita disparar o protocolo duas vezes no mesmo clique (Chrome logava 2x). */
let lastNativeLaunchAt = 0;
let lastNativeLaunchUrl = "";

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
  return text
    ? `whatsapp://send?phone=${phoneDigits}&text=${text}`
    : `whatsapp://send?phone=${phoneDigits}`;
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
 * Dispara whatsapp:// sem navegar a aba do ERP.
 * location.href = whatsapp:// faz o Chrome tratar como navegação da aba
 * (Desktop abre, mas a aba pode seguir para Web/QR).
 */
function launchNativeProtocol(url: string): void {
  const now = Date.now();
  if (url === lastNativeLaunchUrl && now - lastNativeLaunchAt < 2500) {
    return;
  }
  lastNativeLaunchUrl = url;
  lastNativeLaunchAt = now;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Abre o WhatsApp Desktop pelo protocolo nativo (sem mudar a URL da aba).
 * Sem fallback automático para wa.me / WhatsApp Web.
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

  const now = Date.now();
  if (nativeUrl === lastNativeLaunchUrl && now - lastNativeLaunchAt < 2500) {
    return { ok: true, mode: "debounced", phoneDigits };
  }

  launchNativeProtocol(nativeUrl);

  return { ok: true, mode: "native", phoneDigits };
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

  window.location.assign(webUrl);

  return { ok: true, mode: "web", phoneDigits };
}

/** Compat: alias do normalizador usado no restante do ERP. */
export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  return normalizeWhatsAppPhone(phone);
}

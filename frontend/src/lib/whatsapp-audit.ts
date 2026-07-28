/**
 * Auditoria temporária do fluxo WhatsApp — só logs, sem mudar comportamento.
 * Procurar no DevTools (F12 → Console) por: [WA-AUDIT]
 */

const TAG = "[WA-AUDIT]";

declare global {
  interface Window {
    __waAuditInstalled?: boolean;
  }
}

function stackSnippet(): string {
  try {
    return (new Error().stack || "").split("\n").slice(2, 12).join("\n");
  } catch {
    return "(stack indisponível)";
  }
}

export function waAuditLog(
  step: string,
  detail?: Record<string, unknown>
): void {
  if (typeof console === "undefined") return;
  // eslint-disable-next-line no-console
  console.info(TAG, step, {
    t: new Date().toISOString(),
    href: typeof window !== "undefined" ? window.location.href : null,
    hidden: typeof document !== "undefined" ? document.hidden : null,
    ...detail,
  });
  // eslint-disable-next-line no-console
  console.info(TAG, `${step} · stack`, stackSnippet());
}

function classifyUrl(url: string): "wa.me" | "web.whatsapp.com" | "whatsapp://" | "other" {
  const u = url.toLowerCase();
  if (u.startsWith("whatsapp:")) return "whatsapp://";
  if (u.includes("wa.me")) return "wa.me";
  if (u.includes("web.whatsapp.com")) return "web.whatsapp.com";
  if (u.includes("api.whatsapp.com")) return "wa.me";
  return "other";
}

function logIfWhatsAppNav(source: string, url: string): void {
  const kind = classifyUrl(url);
  if (kind === "other") {
    waAuditLog(`nav:${source}`, { url, kind });
    return;
  }
  if (kind === "whatsapp://") {
    waAuditLog("3-abertura-protocolo-nativo (via navegação)", { source, url, kind });
    return;
  }
  if (kind === "wa.me") {
    waAuditLog("4-navegacao-wa.me", { source, url, kind });
    return;
  }
  waAuditLog("5-navegacao-web.whatsapp.com", { source, url, kind });
}

/**
 * Instala spies em location/open/clicks. Idempotente.
 * Objetivo: revelar QUEM navega para wa.me / web.whatsapp.com após o Desktop abrir.
 */
export function installWhatsAppNavigationAudit(): void {
  if (typeof window === "undefined") return;
  if (window.__waAuditInstalled) return;
  window.__waAuditInstalled = true;

  waAuditLog("audit-installed", {
    note: "Spies em location.href/assign/replace, window.open e cliques em <a>",
  });

  const loc = window.location;

  try {
    const assignOrig = loc.assign.bind(loc);
    loc.assign = (url: string | URL) => {
      logIfWhatsAppNav("location.assign", String(url));
      return assignOrig(url);
    };
  } catch (e) {
    waAuditLog("audit-wrap-failed", { api: "location.assign", error: String(e) });
  }

  try {
    const replaceOrig = loc.replace.bind(loc);
    loc.replace = (url: string | URL) => {
      logIfWhatsAppNav("location.replace", String(url));
      return replaceOrig(url);
    };
  } catch (e) {
    waAuditLog("audit-wrap-failed", { api: "location.replace", error: String(e) });
  }

  try {
    const desc =
      Object.getOwnPropertyDescriptor(Location.prototype, "href") ||
      Object.getOwnPropertyDescriptor(loc, "href");
    if (desc?.set && desc?.get) {
      Object.defineProperty(loc, "href", {
        configurable: true,
        enumerable: true,
        get() {
          return desc.get!.call(loc);
        },
        set(value: string) {
          logIfWhatsAppNav("location.href=", String(value));
          desc.set!.call(loc, value);
        },
      });
    } else {
      waAuditLog("audit-wrap-skipped", {
        api: "location.href",
        reason: "descriptor sem get/set",
      });
    }
  } catch (e) {
    waAuditLog("audit-wrap-failed", { api: "location.href", error: String(e) });
  }

  try {
    const openOrig = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (url != null) logIfWhatsAppNav("window.open", String(url));
      else waAuditLog("nav:window.open", { url: null, target, features });
      return openOrig(url, target, features);
    }) as typeof window.open;
  } catch (e) {
    waAuditLog("audit-wrap-failed", { api: "window.open", error: String(e) });
  }

  document.addEventListener(
    "click",
    (event) => {
      const t = event.target;
      if (!(t instanceof Element)) return;
      const a = t.closest("a");
      if (!a?.href) return;
      const href = a.href;
      const kind = classifyUrl(href);
      if (kind === "other" && !href.toLowerCase().includes("whatsapp")) return;
      waAuditLog("click-anchor", {
        href,
        kind,
        target: a.getAttribute("target"),
        id: a.id || null,
        dataWhatsappTarget: a.getAttribute("data-whatsapp-target"),
      });
      if (kind === "wa.me") waAuditLog("4-navegacao-wa.me", { source: "click-anchor", url: href });
      if (kind === "web.whatsapp.com") {
        waAuditLog("5-navegacao-web.whatsapp.com", { source: "click-anchor", url: href });
      }
      if (kind === "whatsapp://") {
        waAuditLog("3-abertura-protocolo-nativo (via <a>)", { source: "click-anchor", url: href });
      }
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    waAuditLog("visibilitychange", { hidden: document.hidden });
  });

  window.addEventListener("pagehide", () => {
    waAuditLog("pagehide", { href: window.location.href });
  });

  window.addEventListener("beforeunload", () => {
    waAuditLog("beforeunload", { href: window.location.href });
  });
}

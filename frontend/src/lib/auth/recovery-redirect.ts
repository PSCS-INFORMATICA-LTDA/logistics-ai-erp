/**
 * Origens autorizadas para o link de recuperação de senha.
 * Sem fallback para localhost ou para o app de produção quando a origem
 * que iniciou o pedido não está nesta lista.
 */

const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3002",
]);

const EXACT_HTTPS_ORIGINS = new Set([
  "https://logistics-ai-erp-dev.vercel.app",
  "https://grx-management.vercel.app",
]);

const PREVIEW_HOST_PREFIX = "logistics-ai-erp-";

export const PASSWORD_RECOVERY_NEXT_PATH = "/auth/redefinir-senha";

export const RECOVERY_ORIGIN_REJECTED_MESSAGE =
  "Este endereço não pode receber o link de recuperação.";

export type RecoveryLinkKind = "valid" | "expired" | "reused" | "invalid" | "missing";

export type RecoveryCallbackDecision = {
  location: string;
  kind: RecoveryLinkKind;
};

export type PasswordUpdateDecision =
  | { ok: true; next: "/dashboard" }
  | { ok: false; error: string };

function bareOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  if (url.origin === "null") return null;
  return url.origin;
}

function isLogisticsPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const labels = host.split(".");
  if (labels.length !== 3) return false;
  if (labels[1] !== "vercel" || labels[2] !== "app") return false;
  const subdomain = labels[0] ?? "";
  if (!subdomain.startsWith(PREVIEW_HOST_PREFIX)) return false;
  const slug = subdomain.slice(PREVIEW_HOST_PREFIX.length);
  return /^[a-z0-9][a-z0-9-]*$/i.test(slug);
}

export function isAuthorizedRecoveryOrigin(origin: string | null | undefined): boolean {
  if (!origin || typeof origin !== "string") return false;
  const normalized = bareOrigin(origin.trim());
  if (!normalized) return false;
  if (LOCAL_ORIGINS.has(normalized)) return true;
  if (EXACT_HTTPS_ORIGINS.has(normalized)) return true;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return isLogisticsPreviewHost(url.hostname);
}

function safeNextPath(nextPath: string): string | null {
  const next = nextPath.trim();
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.includes("\\") || next.includes("://")) return null;
  return next;
}

/** Callback PKCE na mesma origem que iniciou a recuperação. */
export function buildPasswordRecoveryRedirect(
  origin: string | null | undefined,
  nextPath: string,
): string | null {
  if (!isAuthorizedRecoveryOrigin(origin)) return null;
  const next = safeNextPath(nextPath);
  if (!next) return null;
  const base = bareOrigin(origin!.trim());
  if (!base) return null;
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function recoveryLinkErrorMessage(kind: RecoveryLinkKind): string {
  switch (kind) {
    case "expired":
      return "Este link de recuperação expirou. Solicite um novo.";
    case "reused":
      return "Este link de recuperação já foi utilizado. Solicite um novo.";
    case "missing":
      return "Link de recuperação inválido. Solicite um novo.";
    case "invalid":
      return "Não foi possível validar o link de recuperação. Solicite um novo.";
    case "valid":
      return "";
  }
}

export function classifyRecoveryLinkError(
  error: { message?: string; code?: string } | null | undefined,
): Exclude<RecoveryLinkKind, "valid" | "missing"> {
  const code = error?.code?.toLowerCase() ?? "";
  const message = error?.message?.toLowerCase() ?? "";

  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    message.includes("expired") ||
    message.includes("expirou")
  ) {
    return "expired";
  }

  if (
    code === "flow_state_not_found" ||
    message.includes("already used") ||
    message.includes("already been used") ||
    message.includes("flow state not found") ||
    message.includes("reutiliz")
  ) {
    return "reused";
  }

  return "invalid";
}

export function resolveRecoveryCallback(input: {
  requestUrl: string;
  exchangeError: { message?: string; code?: string } | null;
}): RecoveryCallbackDecision {
  const url = new URL(input.requestUrl);
  const code = url.searchParams.get("code");

  if (!code) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", recoveryLinkErrorMessage("missing"));
    return { location: login.toString(), kind: "missing" };
  }

  if (input.exchangeError) {
    const kind = classifyRecoveryLinkError(input.exchangeError);
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", recoveryLinkErrorMessage(kind));
    return { location: login.toString(), kind };
  }

  const next = safeNextPath(url.searchParams.get("next") ?? "") ?? "/dashboard";
  return { location: new URL(next, url.origin).toString(), kind: "valid" };
}

export function classifyPasswordUpdate(input: {
  sessionPresent: boolean;
  updateError: { message?: string; code?: string } | null;
}): PasswordUpdateDecision {
  if (!input.sessionPresent) {
    return { ok: false, error: recoveryLinkErrorMessage("invalid") };
  }
  if (input.updateError) {
    return {
      ok: false,
      error: "Não foi possível atualizar a senha. Solicite um novo link e tente novamente.",
    };
  }
  return { ok: true, next: "/dashboard" };
}

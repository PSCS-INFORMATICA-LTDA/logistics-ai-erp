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
  "https://logistics-release-main-ll6013z3f.vercel.app",
  "https://logistics-release-m-git-fa6d84-pscs-informatica-ltda-s-projects.vercel.app",
]);

const PREVIEW_HOST_PREFIX = "logistics-ai-erp-";

export const PASSWORD_RECOVERY_NEXT_PATH = "/auth/redefinir-senha";

export const RECOVERY_GRANT_COOKIE = "pscs_recovery_grant";

export const RECOVERY_ORIGIN_REJECTED_MESSAGE =
  "Este endereço não pode receber o link de recuperação.";

export const RECOVERY_LINK_EXPIRED_MESSAGE =
  "Link de recuperação inválido ou expirado. Solicite um novo e-mail.";

export const RECOVERY_LINK_REUSED_MESSAGE =
  "Este link de recuperação já foi utilizado. Solicite um novo.";

export type RecoveryLinkKind = "valid" | "expired" | "reused" | "invalid" | "missing";

export type RecoveryCallbackDecision = {
  location: string;
  kind: RecoveryLinkKind;
  setRecoveryGrant: boolean;
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
    case "missing":
    case "invalid":
      return RECOVERY_LINK_EXPIRED_MESSAGE;
    case "reused":
      return RECOVERY_LINK_REUSED_MESSAGE;
    case "valid":
      return "";
  }
}

const SUPABASE_ERROR_CODES = new Set([
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
  "bad_code_verifier",
  "bad_oauth_callback",
  "bad_oauth_state",
  "validation_failed",
]);

const SUPABASE_ERROR_NAMES = new Set(["access_denied", "server_error", "unauthorized_client"]);

/** Erro cru do Supabase Auth na query ou no fragmento. Mensagens da própria tela não entram. */
export function recoveryAuthErrorKind(
  params: URLSearchParams,
): Exclude<RecoveryLinkKind, "valid" | "missing"> | null {
  const code = (params.get("error_code") ?? "").toLowerCase();
  const error = (params.get("error") ?? "").toLowerCase();
  const description = (params.get("error_description") ?? "").toLowerCase();
  const knownCode = SUPABASE_ERROR_CODES.has(code);
  const knownError = SUPABASE_ERROR_NAMES.has(error);
  const described =
    description.includes("expired") ||
    description.includes("expirou") ||
    description.includes("already used") ||
    description.includes("already been used") ||
    description.includes("reutiliz");
  if (!knownCode && !knownError && !described) return null;

  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    description.includes("expired") ||
    description.includes("expirou")
  ) {
    return "expired";
  }

  if (
    code === "flow_state_not_found" ||
    description.includes("already used") ||
    description.includes("already been used") ||
    description.includes("reutiliz")
  ) {
    return "reused";
  }

  return "invalid";
}

export function recoveryAuthErrorKindFromHref(
  href: string,
): Exclude<RecoveryLinkKind, "valid" | "missing"> | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return recoveryAuthErrorKind(url.searchParams) ?? recoveryAuthErrorKind(hash);
}

function loginFailure(
  origin: string,
  kind: Exclude<RecoveryLinkKind, "valid">,
): RecoveryCallbackDecision {
  const login = new URL("/login", origin);
  login.searchParams.set("recovery", "1");
  login.searchParams.set("error", recoveryLinkErrorMessage(kind));
  return { location: login.toString(), kind, setRecoveryGrant: false };
}

function nestedAuthError(
  next: string | null,
  origin: string,
): Exclude<RecoveryLinkKind, "valid" | "missing"> | null {
  if (!next) return null;
  try {
    return recoveryAuthErrorKind(new URL(next, origin).searchParams);
  } catch {
    return null;
  }
}

/**
 * Destino quando a URL traz erro do link de recuperação.
 * Sessão já autenticada não desvia para o dashboard.
 */
export function resolveAuthEntryRedirect(input: {
  requestUrl: string;
  existingSession: boolean;
}): RecoveryCallbackDecision | null {
  const url = new URL(input.requestUrl);
  if (url.pathname === "/login" && url.searchParams.get("recovery") === "1") {
    return null;
  }

  const direct = recoveryAuthErrorKind(url.searchParams);
  const nested = nestedAuthError(url.searchParams.get("next"), url.origin);
  const kind = direct ?? nested;
  if (!kind) return null;

  if (input.existingSession) {
    return loginFailure(url.origin, kind);
  }
  return loginFailure(url.origin, kind);
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
  existingSession?: boolean;
}): RecoveryCallbackDecision {
  const url = new URL(input.requestUrl);
  const entry = resolveAuthEntryRedirect({
    requestUrl: input.requestUrl,
    existingSession: input.existingSession === true,
  });
  if (entry) return entry;

  const code = url.searchParams.get("code");
  if (!code) {
    return loginFailure(url.origin, "missing");
  }

  if (input.exchangeError) {
    return loginFailure(url.origin, classifyRecoveryLinkError(input.exchangeError));
  }

  const requested = safeNextPath(url.searchParams.get("next") ?? "");
  const next =
    !requested || requested === "/dashboard" ? PASSWORD_RECOVERY_NEXT_PATH : requested;
  const location = new URL(next, url.origin).toString();
  return {
    location,
    kind: "valid",
    setRecoveryGrant: new URL(location).pathname === PASSWORD_RECOVERY_NEXT_PATH,
  };
}

export function canShowPasswordResetForm(recoveryGrant: boolean): boolean {
  return recoveryGrant === true;
}

export function classifyPasswordConfirmation(
  password: string,
  confirmPassword: string,
): { ok: true } | { ok: false; error: string } {
  if (password.length < 6) {
    return { ok: false, error: "A senha deve ter pelo menos 6 caracteres." };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "A confirmação da senha não confere." };
  }
  return { ok: true };
}

export function classifyPasswordUpdate(input: {
  sessionPresent: boolean;
  recoveryGrant: boolean;
  updateError: { message?: string; code?: string } | null;
  updateAccepted: boolean;
}): PasswordUpdateDecision {
  if (!input.recoveryGrant || !input.sessionPresent) {
    return { ok: false, error: RECOVERY_LINK_EXPIRED_MESSAGE };
  }
  if (!input.updateAccepted || input.updateError) {
    return {
      ok: false,
      error: "Não foi possível atualizar a senha. Solicite um novo link e tente novamente.",
    };
  }
  return { ok: true, next: "/dashboard" };
}

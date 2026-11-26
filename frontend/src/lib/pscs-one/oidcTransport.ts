import { sanitizeEnvString } from "./config";

export const PSCS_ONE_OIDC_HEADER = "x-vercel-trusted-oidc-idp-token";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TOKEN_PATH = "/api/integrations/sso/token";

export function authorizedOidcHostname(
  source: Record<string, string | undefined>,
): string | null {
  const raw = sanitizeEnvString(source.PSCS_ONE_OIDC_HOST).toLowerCase();
  if (!raw || raw.includes(".") === false || /[/\\@:?#\s]/.test(raw)) return null;
  return raw;
}

function oidcDestination(tokenUrl: string, source: Record<string, string | undefined>): URL | null {
  const configured = sanitizeEnvString(source.PSCS_ONE_OIDC_HOST);
  if (!configured) return null;
  const allowed = authorizedOidcHostname(source);
  let url: URL;
  try {
    url = new URL(tokenUrl);
  } catch {
    throw new Error("oidc_destination_denied");
  }
  const portAllowed = url.port === "" || url.port === "443";
  const matches =
    allowed !== null &&
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === allowed &&
    portAllowed &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === TOKEN_PATH &&
    url.search === "" &&
    url.hash === "";
  if (!matches) throw new Error("oidc_destination_denied");
  return url;
}

export function oidcTokenIsUsable(token: string, nowMs = Date.now()): boolean {
  const payload = token.split(".")[1];
  if (!payload || token.split(".").length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" && claims.exp * 1000 > nowMs + 15_000;
  } catch {
    return false;
  }
}

async function defaultOidcToken(): Promise<string | undefined> {
  const { getVercelOidcToken } = await import("@vercel/oidc");
  const token = await getVercelOidcToken();
  return typeof token === "string" ? token : undefined;
}

export async function exchangeCoreToken(input: {
  tokenUrl: string;
  body: Record<string, string>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  loadOidcToken?: () => Promise<string | undefined>;
}): Promise<{ response: Response; oidcToken: string | null }> {
  const env = input.env ?? process.env;
  const pinned = oidcDestination(input.tokenUrl, env);
  const url = pinned ?? new URL(input.tokenUrl);
  let oidcToken: string | null = null;

  if (pinned) {
    try {
      const loaded = await (input.loadOidcToken ?? defaultOidcToken)();
      oidcToken = loaded && oidcTokenIsUsable(loaded) ? loaded : null;
    } catch {
      oidcToken = null;
    }
    if (!oidcToken) {
      throw new Error("oidc_token_unavailable");
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (oidcToken) headers[PSCS_ONE_OIDC_HEADER] = oidcToken;

  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body),
    cache: "no-store",
    ...(oidcToken ? { redirect: "manual" as const } : {}),
  });

  if (oidcToken && (response.status === 0 || REDIRECT_STATUSES.has(response.status))) {
    throw new Error("oidc_redirect_blocked");
  }
  return { response, oidcToken };
}

export function exchangeErrorReason(reason: string | undefined, oidcToken: string | null): string {
  if (!reason || (oidcToken && reason.includes(oidcToken))) return "token_exchange_denied";
  return reason;
}

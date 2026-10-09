import {
  PSCS_ONE_CORE_COMPANY_COOKIE,
  PSCS_ONE_CORE_SESSION_COOKIE,
} from "./core/config";
import type { PscsOneIdentityV1, PscsOneTokenExchangeV1 } from "./types";
import { publicPscsOneSsoReason } from "./errors";

export type PscsOneSsoStage =
  | "callback_params"
  | "token_exchange"
  | "user_mapping"
  | "membership"
  | "session"
  | "cookie"
  | "redirect";

export type SsoCookieWrite = {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
};

export type PscsOneCallbackDeps = {
  exchangeAuthorizationCode: (code: string) => Promise<PscsOneTokenExchangeV1>;
  ensureLocalUser: (identity: PscsOneIdentityV1) => Promise<{
    authUserId: string;
    email: string;
    tokenHash: string;
  }>;
  ensureMembership: (authUserId: string, companyId: string) => Promise<void>;
  verifySession: (tokenHash: string) => Promise<{
    accessTokenPresent: boolean;
    refreshTokenPresent: boolean;
  }>;
  writeCookies: (cookies: SsoCookieWrite[]) => void;
};

export type PscsOneCallbackResult =
  | {
      ok: true;
      stage: "redirect";
      location: string;
      cookieNames: string[];
    }
  | {
      ok: false;
      stage: PscsOneSsoStage;
      reason: string;
    };

const MAPPED_COOKIE = "pscs_one_mapped_company_id";

export function logPscsOneSsoCallback(fields: {
  correlation_id: string;
  stage: PscsOneSsoStage;
  result: "success" | "failure";
  reason?: string;
}): void {
  console.info("pscs_one_sso_callback", {
    event: "pscs_one_sso_callback",
    ...fields,
  });
}

export async function executePscsOneCallback(
  input: { code: string | null; origin: string },
  deps: PscsOneCallbackDeps,
): Promise<PscsOneCallbackResult> {
  const code = input.code?.trim() ?? "";
  if (!code) {
    return { ok: false, stage: "callback_params", reason: "missing_code" };
  }

  let exchange: PscsOneTokenExchangeV1;
  try {
    exchange = await deps.exchangeAuthorizationCode(code);
  } catch (error) {
    return { ok: false, stage: "token_exchange", reason: publicPscsOneSsoReason(error) };
  }
  const { identity, core_auth: coreAuth } = exchange;

  let local: { authUserId: string; email: string; tokenHash: string };
  try {
    local = await deps.ensureLocalUser(identity);
  } catch (error) {
    return { ok: false, stage: "user_mapping", reason: publicPscsOneSsoReason(error) };
  }

  try {
    await deps.ensureMembership(local.authUserId, identity.external_company_id);
  } catch (error) {
    return { ok: false, stage: "membership", reason: publicPscsOneSsoReason(error) };
  }

  let session: { accessTokenPresent: boolean; refreshTokenPresent: boolean };
  try {
    session = await deps.verifySession(local.tokenHash);
  } catch (error) {
    return { ok: false, stage: "session", reason: publicPscsOneSsoReason(error) };
  }
  if (!session.accessTokenPresent || !session.refreshTokenPresent) {
    return { ok: false, stage: "session", reason: "session_creation_failed" };
  }

  const cookies: SsoCookieWrite[] = [
    {
      name: MAPPED_COOKIE,
      value: identity.external_company_id,
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    },
    {
      name: PSCS_ONE_CORE_COMPANY_COOKIE,
      value: identity.company_id,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    },
  ];

  if (coreAuth) {
    cookies.push({
      name: PSCS_ONE_CORE_SESSION_COOKIE,
      value: JSON.stringify({
        access_token: coreAuth.access_token,
        refresh_token: coreAuth.refresh_token,
        expires_at: coreAuth.expires_at,
        user_id: coreAuth.user_id ?? identity.user_id,
      }),
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  try {
    deps.writeCookies(cookies);
  } catch (error) {
    return { ok: false, stage: "cookie", reason: publicPscsOneSsoReason(error) };
  }

  return {
    ok: true,
    stage: "redirect",
    location: `${input.origin}/dashboard`,
    cookieNames: cookies.map((cookie) => cookie.name),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function identityFromTokenPayload(payload: {
  ok?: boolean;
  identity?: PscsOneIdentityV1;
}): PscsOneIdentityV1 {
  if (payload.ok !== true || !payload.identity) {
    throw new Error("token_payload_invalid");
  }
  if (payload.identity.version !== "1") {
    throw new Error("unsupported_contract");
  }
  if (payload.identity.product_key !== "logistics_ai") {
    throw new Error("product_key_denied");
  }
  if (
    !UUID_RE.test(payload.identity.user_id) ||
    !UUID_RE.test(payload.identity.company_id) ||
    !UUID_RE.test(payload.identity.external_company_id)
  ) {
    throw new Error("token_payload_invalid");
  }
  return payload.identity;
}

import { parseCoreSessionCookie } from "./authCookie";
import { PSCS_ONE_CORE_SESSION_COOKIE, isCoreArConsumerConfigured } from "./config";
import { CoreArError } from "./errors";
import type { CoreArAuthSessionWithUser } from "./types";

export function readCoreSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): CoreArAuthSessionWithUser | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${PSCS_ONE_CORE_SESSION_COOKIE}=([^;]+)`),
  );
  if (!match?.[1]) return null;
  let raw = match[1].trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return parseCoreSessionCookie(raw);
}

export function requireCoreArSession(
  cookieHeader: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): CoreArAuthSessionWithUser {
  if (!isCoreArConsumerConfigured(env)) {
    throw new CoreArError("core_unconfigured", "Core AR consumer is not configured on the server.", 503);
  }
  const session = readCoreSessionFromCookieHeader(cookieHeader);
  if (!session) {
    throw new CoreArError(
      "core_session_missing",
      "Core session is missing. Sign in via PSCS One SSO to refresh Core AR access.",
      401,
    );
  }
  if (session.expires_at * 1000 <= Date.now()) {
    throw new CoreArError(
      "core_session_invalid",
      "Core session expired. Sign in via PSCS One SSO again.",
      401,
    );
  }
  return session;
}

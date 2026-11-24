import type { CoreArAuthSession } from "./types";
import { pscsOneCoreSupabaseProjectRef } from "./config";
import { CoreArError } from "./errors";

export type CoreSupabaseSessionCookiePayload = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in?: number;
  token_type?: string;
  user?: { id: string };
};

export function parseCoreSessionCookie(raw: string | undefined | null): CoreArAuthSession | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as CoreSupabaseSessionCookiePayload;
    const expiresAt = Number(parsed.expires_at);
    if (!parsed.access_token || !parsed.refresh_token || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      return null;
    }
    const rawUserId = (parsed as { user_id?: unknown }).user_id ?? parsed.user?.id;
    const userId = typeof rawUserId === "string" ? rawUserId : undefined;
    if (userId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return null;
    }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: expiresAt,
      ...(userId ? { user_id: userId } : {}),
    };
  } catch {
    return null;
  }
}

export function buildCoreSupabaseAuthCookieHeader(
  session: CoreArAuthSessionWithUser,
  source: Record<string, string | undefined> = process.env,
): string {
  const ref = pscsOneCoreSupabaseProjectRef(source);
  if (!ref) {
    throw new CoreArError("core_unconfigured", "Core Supabase project ref is not configured.", 503);
  }
  const payload: CoreSupabaseSessionCookiePayload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)),
    token_type: "bearer",
    user: session.user_id ? { id: session.user_id } : undefined,
  };
  const name = `sb-${ref}-auth-token`;
  return `${name}=${encodeURIComponent(JSON.stringify(payload))}`;
}

/** Optional user id when minting the Core SSR cookie for server-side fetch. */
export type CoreArAuthSessionWithUser = CoreArAuthSession & { user_id?: string };

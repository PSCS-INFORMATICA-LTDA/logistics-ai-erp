/** URL pública do app (redirects de Auth / e-mail). */

const DEFAULT_PUBLIC_APP_URL = "https://grx-management.vercel.app";

export function getAppOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return fromEnv || DEFAULT_PUBLIC_APP_URL;
}

export function getAuthCallbackUrl(nextPath: string): string {
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return `${getAppOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
}

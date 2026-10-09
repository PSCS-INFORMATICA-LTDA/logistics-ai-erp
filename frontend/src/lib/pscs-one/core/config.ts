import { sanitizeEnvString } from "../config";

export const PSCS_ONE_CORE_COMPANY_COOKIE = "pscs_one_core_company_id";
export const PSCS_ONE_CORE_SESSION_COOKIE = "pscs_one_core_session";

const DEFAULT_CORE_API_BASE = "https://pscs-core.vercel.app";

export function pscsOneCoreApiBaseUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const raw =
    sanitizeEnvString(source.PSCS_ONE_CORE_API_BASE_URL) ||
    sanitizeEnvString(source.PSCS_ONE_CORE_BASE_URL);
  return (raw || DEFAULT_CORE_API_BASE).replace(/\/+$/, "");
}

/** Supabase project ref for Core (cookie name `sb-{ref}-auth-token`). Server-only. */
export function pscsOneCoreSupabaseProjectRef(
  source: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = sanitizeEnvString(source.PSCS_ONE_CORE_SUPABASE_PROJECT_REF);
  if (explicit) return explicit;
  const url =
    sanitizeEnvString(source.PSCS_ONE_SUPABASE_URL) ||
    sanitizeEnvString(source.ONE_SUPABASE_URL);
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match?.[1] ?? null;
}

export function isCoreArConsumerConfigured(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(pscsOneCoreSupabaseProjectRef(source) && pscsOneCoreApiBaseUrl(source));
}

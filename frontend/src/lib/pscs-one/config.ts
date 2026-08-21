import { evaluateLogisticsSsoSupabase } from "./devSupabaseGuard";

export const PSCS_ONE_MAPPED_COMPANY_COOKIE = "pscs_one_mapped_company_id";

export function sanitizeEnvString(value: string | undefined): string {
  return (value ?? "").replace(/^\uFEFF/, "").trim();
}

export function isPscsOneSsoEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return evaluateLogisticsSsoSupabase(source).ok;
}

export function pscsOneTokenUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  return (
    sanitizeEnvString(source.PSCS_ONE_TOKEN_URL) ||
    "https://pscs-core.vercel.app/api/integrations/sso/token"
  );
}

export function pscsOneClientId(
  source: Record<string, string | undefined> = process.env,
): string {
  return sanitizeEnvString(source.PSCS_ONE_CLIENT_ID) || "logistics_ai";
}

export function pscsOneCallbackUri(
  source: Record<string, string | undefined> = process.env,
): string {
  return (
    sanitizeEnvString(source.PSCS_ONE_REDIRECT_URI) ||
    "https://logistics-ai-erp-dev.vercel.app/auth/pscs-one/callback"
  );
}

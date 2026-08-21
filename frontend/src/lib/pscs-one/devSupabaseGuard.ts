export const LOGISTICS_DEV_SUPABASE_REF = "jmbajdpkvlrslirwzyze";
export const LOGISTICS_PROD_SUPABASE_REF = "tqeenmswotxqainkyyct";

export function supabaseProjectRefFromUrl(url: string | undefined): string | null {
  const match = url?.trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (match?.[1]) return match[1];
  const loose = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return loose?.[1] ?? null;
}

export type LogisticsSsoSupabaseDecision =
  | { ok: true; ref: string }
  | {
      ok: false;
      reason:
        | "sso_disabled"
        | "supabase_prod_forbidden"
        | "supabase_project_denied"
        | "supabase_url_missing";
    };

export function evaluateLogisticsSsoSupabase(
  source: Record<string, string | undefined> = process.env,
): LogisticsSsoSupabaseDecision {
  if (source.PSCS_ONE_SSO_ENABLED !== "true") {
    return { ok: false, reason: "sso_disabled" };
  }
  const ref = supabaseProjectRefFromUrl(source.NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) {
    return { ok: false, reason: "supabase_url_missing" };
  }
  if (ref === LOGISTICS_PROD_SUPABASE_REF) {
    return { ok: false, reason: "supabase_prod_forbidden" };
  }
  if (ref !== LOGISTICS_DEV_SUPABASE_REF) {
    return { ok: false, reason: "supabase_project_denied" };
  }
  return { ok: true, ref };
}

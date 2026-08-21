/**
 * Fail-fast: Logistics SSO cannot build against production Supabase.
 * When PSCS_ONE_SSO_ENABLED is not true, this is a no-op so commercial
 * Production (grx-management.vercel.app) keeps building.
 */
const DEV = "jmbajdpkvlrslirwzyze";
const PROD = "tqeenmswotxqainkyyct";

function refFromUrl(url) {
  const match = String(url || "").trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match?.[1] ?? null;
}

if (process.env.PSCS_ONE_SSO_ENABLED !== "true") {
  console.log("SSO guard: skipped (flag off)");
  process.exit(0);
}

const ref = refFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (!ref) {
  console.error("SSO guard: supabase_url_missing");
  process.exit(1);
}
if (ref === PROD) {
  console.error("SSO guard: supabase_prod_forbidden");
  process.exit(1);
}
if (ref !== DEV) {
  console.error("SSO guard: supabase_project_denied");
  process.exit(1);
}

console.log("SSO guard: enabled on Logistics DEV");

/**
 * Fail-fast: Logistics SSO cannot build against production Supabase.
 * When PSCS_ONE_SSO_ENABLED is not true, the SSO check is a no-op so
 * commercial Production (grx-management.vercel.app) keeps building.
 *
 * Vercel Preview is separate: VERCEL_ENV=preview always requires the
 * Logistics DEV Supabase host, whether or not SSO is enabled.
 */
import { pathToFileURL } from "node:url";

const DEV_REF = "jmbajdpkvlrslirwzyze";
const PROD_REF = "tqeenmswotxqainkyyct";
const DEV_HOST = "jmbajdpkvlrslirwzyze.supabase.co";

function safeProjectRef(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port) return null;
  const match = parsed.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.co$/);
  return match?.[1] ?? null;
}

export function evaluatePreviewSupabase(url) {
  const ref = safeProjectRef(url);
  if (typeof url !== "string" || url.trim() === "") {
    return { ok: false, ref: null };
  }
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, ref: null };
  }
  const pathOk = parsed.pathname === "" || parsed.pathname === "/";
  const ok =
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    pathOk &&
    parsed.hostname.toLowerCase() === DEV_HOST &&
    ref === DEV_REF;
  return { ok, ref };
}

function refFromUrl(url) {
  const match = String(url || "").trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match?.[1] ?? null;
}

export function evaluateGuards(env) {
  const lines = [];
  let exitCode = 0;

  if (env.VERCEL_ENV === "preview") {
    const preview = evaluatePreviewSupabase(env.NEXT_PUBLIC_SUPABASE_URL);
    if (preview.ok) {
      lines.push({
        stream: "stdout",
        text: `preview-supabase: PASS project_ref=${preview.ref}`,
      });
    } else {
      const refPart = preview.ref ? ` project_ref=${preview.ref}` : "";
      lines.push({ stream: "stderr", text: `preview-supabase: FAIL${refPart}` });
      exitCode = 1;
    }
  }

  if (env.PSCS_ONE_SSO_ENABLED !== "true") {
    lines.push({ stream: "stdout", text: "SSO guard: skipped (flag off)" });
    return { exitCode, lines };
  }

  const ref = refFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) {
    lines.push({ stream: "stderr", text: "SSO guard: supabase_url_missing" });
    return { exitCode: 1, lines };
  }
  if (ref === PROD_REF) {
    lines.push({ stream: "stderr", text: "SSO guard: supabase_prod_forbidden" });
    return { exitCode: 1, lines };
  }
  if (ref !== DEV_REF) {
    lines.push({ stream: "stderr", text: "SSO guard: supabase_project_denied" });
    return { exitCode: 1, lines };
  }
  lines.push({ stream: "stdout", text: "SSO guard: enabled on Logistics DEV" });
  return { exitCode, lines };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const { exitCode, lines } = evaluateGuards(process.env);
  for (const line of lines) {
    if (line.stream === "stderr") console.error(line.text);
    else console.log(line.text);
  }
  process.exit(exitCode);
}

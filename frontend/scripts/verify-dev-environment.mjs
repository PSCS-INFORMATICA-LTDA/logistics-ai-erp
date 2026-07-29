/**
 * Bloqueia uso acidental do Supabase de produção no ambiente local.
 * Não imprime chaves. Não conecta ao banco.
 *
 * Uso: node scripts/verify-dev-environment.mjs
 *      (cwd = frontend/)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROD_REF = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const envPath = path.join(frontendRoot, ".env.local");

function fail(msg) {
  console.error(`verify:dev-env FALHOU: ${msg}`);
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) fail(`.env.local não encontrado em ${filePath}`);
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function maskRef(ref) {
  if (!ref || ref.length < 8) return "****";
  return `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

const env = loadEnvFile(envPath);
const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
if (!url) fail("NEXT_PUBLIC_SUPABASE_URL vazio ou ausente");
if (!url.startsWith("https://")) fail("NEXT_PUBLIC_SUPABASE_URL deve usar https://");
if (!url.includes(".supabase.co")) fail("NEXT_PUBLIC_SUPABASE_URL deve terminar em .supabase.co");

const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
if (!m) fail("Não foi possível extrair project-ref da URL");
const ref = m[1].toLowerCase();
if (!ref) fail("project-ref vazio");
if (ref === PROD_REF) {
  fail(
    `project-ref é PRODUÇÃO (${maskRef(PROD_REF)}). Use o Supabase DEV. Abortando.`
  );
}

if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  fail("NEXT_PUBLIC_SUPABASE_ANON_KEY ausente");
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  fail("SUPABASE_SERVICE_ROLE_KEY ausente (necessária para scripts DEV)");
}
if (String(env.SUPABASE_SERVICE_ROLE_KEY).startsWith("NEXT_PUBLIC_")) {
  fail("SUPABASE_SERVICE_ROLE_KEY inválida");
}

console.log(`Ambiente DEV confirmado`);
console.log(`project-ref: ${maskRef(ref)}`);
process.exit(0);

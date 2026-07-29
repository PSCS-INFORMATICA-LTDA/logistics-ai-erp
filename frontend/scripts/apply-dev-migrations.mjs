/**
 * Aplica supabase/migrations/*.sql no projeto apontado por .env.local.
 * Só roda se verify-dev-environment passar (bloqueia produção).
 *
 * Requer no .env.local (além das keys DEV):
 *   SUPABASE_DB_PASSWORD=...   OU
 *   DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
 *
 * Uso (cwd=frontend):
 *   node scripts/apply-dev-migrations.mjs
 *   node scripts/apply-dev-migrations.mjs --from=065 --to=073
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const PROD_REF = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const migrationsDir = path.resolve(frontendRoot, "..", "supabase", "migrations");

function fail(msg) {
  console.error(`apply-dev-migrations FALHOU: ${msg}`);
  process.exit(1);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) fail(`.env.local não encontrado`);
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function parseArgs(argv) {
  let from = 1;
  let to = 999;
  for (const a of argv) {
    if (a.startsWith("--from=")) from = Number(a.slice(7));
    if (a.startsWith("--to=")) to = Number(a.slice(5));
  }
  return { from, to };
}

function extractRef(url) {
  const m = String(url || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

function buildDatabaseUrlCandidates(env) {
  const out = [];
  if (env.DATABASE_URL) out.push(env.DATABASE_URL);
  if (env.SUPABASE_DB_URL) out.push(env.SUPABASE_DB_URL);
  const password = env.SUPABASE_DB_PASSWORD;
  const ref = extractRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (password && ref) {
    const enc = encodeURIComponent(password);
    out.push(`postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`);
    out.push(
      `postgresql://postgres.${ref}:${enc}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`
    );
    out.push(
      `postgresql://postgres.${ref}:${enc}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`
    );
  }
  return [...new Set(out)];
}

async function connectFirstWorking(candidates) {
  let lastErr = null;
  for (const dbUrl of candidates) {
    if (dbUrl.includes(PROD_REF)) continue;
    const client = new pg.Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20000,
    });
    try {
      await client.connect();
      return client;
    } catch (e) {
      lastErr = e;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error("Nenhuma conexão Postgres funcionou");
}

async function main() {
  const verify = spawnSync(
    process.execPath,
    [path.join(__dirname, "verify-dev-environment.mjs")],
    { cwd: frontendRoot, encoding: "utf8" }
  );
  if (verify.status !== 0) {
    process.stdout.write(verify.stdout || "");
    process.stderr.write(verify.stderr || "");
    fail("verify:dev-env não passou — abortando.");
  }
  process.stdout.write(verify.stdout || "");

  const env = loadEnv(path.join(frontendRoot, ".env.local"));
  const ref = extractRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) fail("project-ref inválido");
  if (ref === PROD_REF) fail("ref de produção bloqueada");

  const candidates = buildDatabaseUrlCandidates(env);
  if (!candidates.length) {
    fail(
      "Falta SUPABASE_DB_PASSWORD ou DATABASE_URL no .env.local (senha do Postgres do projeto DEV)."
    );
  }

  const { from, to } = parseArgs(process.argv.slice(2));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f))
    .sort()
    .filter((f) => {
      const n = Number(f.slice(0, 3));
      return n >= from && n <= to;
    });

  if (!files.length) fail(`Nenhuma migration entre ${from} e ${to}`);

  console.log(`Aplicando ${files.length} migration(s) em ${ref.slice(0, 4)}…${ref.slice(-4)}`);

  let client;
  try {
    client = await connectFirstWorking(candidates);
  } catch (e) {
    fail(`Conexão Postgres falhou: ${e?.message || e}`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._dev_schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  let applied = 0;
  let skipped = 0;
  try {
    for (const file of files) {
      const already = await client.query(
        `SELECT 1 FROM public._dev_schema_migrations WHERE filename = $1`,
        [file]
      );
      if (already.rowCount) {
        console.log(`SKIP ${file}`);
        skipped += 1;
        continue;
      }
      // Greenfield: 001 cria vw_ownership_base; 004 altera ownership_percentage.
      // Sem dropar a view antes, o ALTER TYPE da 004 falha. Não reescrevemos a 004
      // (já aplicada em produção); o pré-passo só roda no apply DEV.
      if (/^004_/i.test(file)) {
        await client.query(
          "DROP VIEW IF EXISTS public.vw_ownership_base CASCADE"
        );
        console.log(
          "PRE 004: DROP VIEW IF EXISTS public.vw_ownership_base CASCADE"
        );
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      process.stdout.write(`APPLY ${file} ... `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO public._dev_schema_migrations (filename) VALUES ($1)`,
          [file]
        );
        await client.query("COMMIT");
        console.log("OK");
        applied += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("FAIL");
        console.error(err?.message || err);
        fail(`Parou em ${file}`);
      }
    }
  } finally {
    await client.end();
  }

  console.log(`Concluído. applied=${applied} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

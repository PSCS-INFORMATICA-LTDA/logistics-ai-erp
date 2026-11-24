/**
 * Aplica supabase/migrations/*.sql no projeto apontado por .env.local.
 * Só roda se verify-dev-environment passar (bloqueia produção).
 *
 * Requer no .env.local (além das keys DEV):
 *   SUPABASE_DB_PASSWORD=...   OU
 *   DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
 *
 * Uso (cwd=frontend):
 *   node scripts/apply-dev-migrations.mjs --dry-run
 *   node scripts/apply-dev-migrations.mjs
 *   node scripts/apply-dev-migrations.mjs --from=065 --to=073
 *   node scripts/apply-dev-migrations.mjs --self-test
 *
 * --dry-run só lê o controle e lista skip, apply ou block. Não executa SQL
 * de migration e não insere no controle.
 *
 * Arquivos 078, 079 e 083 a 091 já estão instalados no DEV e fora do
 * controle. O runner recusa aplicá-los de novo. O registro dos nomes fica
 * no script de reconciliação, que não entra neste comando.
 * 021_seed_demo_freight_os.sql e 060_import_driver_confirmed.sql são
 * histórico. Este runner não apaga linhas do controle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

export const HISTORICAL_LEDGER_FILES = [
  "021_seed_demo_freight_os.sql",
  "060_import_driver_confirmed.sql",
];

export const EXTERNAL_APPLIED_BLOCK = [
  "078_pscs_one_user_id.sql",
  "079_close_company_members_self_join.sql",
  "083_public_driver_assignment_schedule.sql",
  "084_service_order_security_guards.sql",
  "085_driver_reassignment_and_public_amounts.sql",
  "086_rbac_financial_and_ownership_view.sql",
  "087_driver_payment_and_finance_rpc_guards.sql",
  "088_financial_approval_status_guard.sql",
  "089_financial_insert_delete_guard.sql",
  "090_financial_approved_field_guard.sql",
  "091_pre_pilot_security.sql",
];

export function planMigrationRun(files, recorded, contentConflicts = []) {
  const known = new Set(recorded);
  const conflicts = new Set(contentConflicts);
  const branchFiles = new Set(files);
  const missingHistory =
    known.size === 0
      ? []
      : HISTORICAL_LEDGER_FILES.filter((file) => !known.has(file));
  const preservedWithoutFile = [...known].filter((file) => !branchFiles.has(file)).sort();
  const actions = [];
  let blocked = missingHistory.length > 0;
  for (const file of files) {
    if (conflicts.has(file)) {
      actions.push({ file, action: "block", reason: "content" });
      blocked = true;
      continue;
    }
    if (known.has(file)) {
      actions.push({ file, action: "skip" });
      continue;
    }
    if (blocked || EXTERNAL_APPLIED_BLOCK.includes(file)) {
      actions.push({ file, action: "block", reason: "unregistered" });
      blocked = true;
      continue;
    }
    actions.push({ file, action: "apply" });
  }
  return { missingHistory, preservedWithoutFile, actions };
}

export async function applyBatch(client, actions, readSql) {
  const pending = actions.filter((row) => row.action === "apply");
  if (!pending.length) return { applied: 0 };
  await client.query("BEGIN");
  try {
    for (const row of pending) {
      if (/^004_/i.test(row.file)) {
        await client.query("DROP VIEW IF EXISTS public.vw_ownership_base CASCADE");
      }
      await client.query(await readSql(row.file));
      await client.query(
        "INSERT INTO public._dev_schema_migrations (filename) VALUES ($1)",
        [row.file]
      );
    }
    await client.query("COMMIT");
    return { applied: pending.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function parseArgs(argv) {
  let from = 1;
  let to = 999;
  let dryRun = false;
  let selfTest = false;
  for (const a of argv) {
    if (a.startsWith("--from=")) from = Number(a.slice(7));
    if (a.startsWith("--to=")) to = Number(a.slice(5));
    if (a === "--dry-run") dryRun = true;
    if (a === "--self-test") selfTest = true;
  }
  return { from, to, dryRun, selfTest };
}

async function runSelfTest() {
  const files = [
    "077_ap_soft_delete_rpc.sql",
    "078_pscs_one_user_id.sql",
    "082_service_order_client_id.sql",
    "091_pre_pilot_security.sql",
    "092_futura.sql",
  ];
  const recorded = [
    "021_seed_demo_freight_os.sql",
    "060_import_driver_confirmed.sql",
    "077_ap_soft_delete_rpc.sql",
    "082_service_order_client_id.sql",
  ];
  const plan = planMigrationRun(files, recorded);
  const byFile = Object.fromEntries(plan.actions.map((row) => [row.file, row.action]));
  if (plan.missingHistory.length !== 0) fail("self-test: histórico presente foi marcado como ausente");
  if (byFile["077_ap_soft_delete_rpc.sql"] !== "skip") fail("self-test: arquivo registrado não ficou em skip");
  if (byFile["082_service_order_client_id.sql"] !== "skip") fail("self-test: 082 não ficou em skip");
  if (byFile["078_pscs_one_user_id.sql"] !== "block") fail("self-test: 078 não bloqueou reaplicação");
  if (byFile["091_pre_pilot_security.sql"] !== "block") fail("self-test: 091 não bloqueou reaplicação");
  if (byFile["092_futura.sql"] !== "block") fail("self-test: arquivo posterior a um bloqueio não foi retido");
  const clean = planMigrationRun(
    ["092_futura.sql"],
    [...recorded, ...EXTERNAL_APPLIED_BLOCK]
  );
  if (clean.actions[0]?.action !== "apply") fail("self-test: migration nova não entrou em apply");
  const lost = planMigrationRun(["092_futura.sql"], ["001_schema.sql"]);
  if (!lost.missingHistory.includes("021_seed_demo_freight_os.sql")) {
    fail("self-test: ausência de 021 não foi detectada");
  }
  if (lost.actions[0]?.action !== "block") fail("self-test: ledger sem histórico não bloqueou");
  const divergent = planMigrationRun(files, recorded, ["082_service_order_client_id.sql"]);
  const divergentByFile = Object.fromEntries(
    divergent.actions.map((row) => [row.file, row.action])
  );
  if (divergentByFile["082_service_order_client_id.sql"] !== "block") {
    fail("self-test: divergência de conteúdo não bloqueou");
  }
  if (divergentByFile["092_futura.sql"] !== "block") {
    fail("self-test: arquivo posterior à divergência não foi retido");
  }
  const preserved = planMigrationRun(
    ["077_ap_soft_delete_rpc.sql"],
    ["021_seed_demo_freight_os.sql", "060_import_driver_confirmed.sql", "077_ap_soft_delete_rpc.sql"]
  );
  if (preserved.missingHistory.length !== 0) fail("self-test: histórico presente foi tratado como ausente");
  if (!preserved.preservedWithoutFile.includes("021_seed_demo_freight_os.sql")) {
    fail("self-test: 021 fora da branch não foi sinalizado");
  }
  if (!preserved.preservedWithoutFile.includes("060_import_driver_confirmed.sql")) {
    fail("self-test: 060 fora da branch não foi sinalizado");
  }

  const memory = createMemoryLedger([
    "021_seed_demo_freight_os.sql",
    "060_import_driver_confirmed.sql",
    "077_ap_soft_delete_rpc.sql",
  ]);
  await memory.query("SELECT to_regclass('public._dev_schema_migrations') IS NOT NULL AS present");
  await memory.query("SELECT filename FROM public._dev_schema_migrations ORDER BY filename");
  if (memory.queries.length !== 2 || memory.queries.some((sql) => !sql.startsWith("SELECT "))) {
    fail("self-test: dry-run emitiu escrita");
  }
  if (memory.recorded.size !== 3) fail("self-test: dry-run alterou o ledger");

  const failing = createMemoryLedger(["021_seed_demo_freight_os.sql", "060_import_driver_confirmed.sql"]);
  const failingPlan = planMigrationRun(
    ["092_primeira.sql", "093_falha.sql"],
    [...failing.recorded]
  );
  let failed = false;
  try {
    await applyBatch(failing, failingPlan.actions, async (file) =>
      file.startsWith("093_") ? "SELECT 'BOOM'" : "SELECT 1"
    );
  } catch (err) {
    failed = err?.message === "boom";
  }
  if (!failed) fail("self-test: falha da segunda migration não interrompeu o lote");
  if (failing.recorded.size !== 2) fail("self-test: falha deixou registro ou aplicação parcial");
  if (!failing.queries.includes("ROLLBACK")) fail("self-test: falha não desfez a transação");
  console.log("self-test OK");
}

function createMemoryLedger(seed) {
  const recorded = new Set(seed);
  let open = false;
  let staged = [];
  return {
    recorded,
    queries: [],
    async query(sql, params = []) {
      const text = String(sql);
      this.queries.push(text);
      if (text === "BEGIN") {
        open = true;
        staged = [];
        return { rows: [] };
      }
      if (text === "ROLLBACK") {
        open = false;
        staged = [];
        return { rows: [] };
      }
      if (text === "COMMIT") {
        for (const name of staged) recorded.add(name);
        open = false;
        staged = [];
        return { rows: [] };
      }
      if (text.includes("BOOM")) throw new Error("boom");
      if (text.startsWith("INSERT INTO public._dev_schema_migrations")) {
        if (!open) throw new Error("insert fora da transação");
        staged.push(params[0]);
        return { rows: [] };
      }
      if (text.includes("to_regclass")) return { rows: [{ present: true }] };
      if (text.includes("SELECT filename")) {
        return { rows: [...recorded].map((filename) => ({ filename })) };
      }
      return { rows: [] };
    },
    async end() {},
  };
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
  const { default: pg } = await import("pg");
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
  const { selfTest } = parseArgs(process.argv.slice(2));
  if (selfTest) {
    await runSelfTest();
    return;
  }
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

  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f))
    .sort()
    .filter((f) => {
      const n = Number(f.slice(0, 3));
      return n >= from && n <= to;
    });

  if (!files.length) fail(`Nenhuma migration entre ${from} e ${to}`);

  console.log(
    `${dryRun ? "Dry-run" : "Aplicação"} de ${files.length} migration(s) em ${ref.slice(0, 4)}…${ref.slice(-4)}`
  );

  let client;
  try {
    client = await connectFirstWorking(candidates);
  } catch (e) {
    fail(`Conexão Postgres falhou: ${e?.message || e}`);
  }

  const ledger = await client.query(
    `SELECT to_regclass('public._dev_schema_migrations') IS NOT NULL AS present`
  );
  if (!ledger.rows[0]?.present) {
    await client.end();
    fail("public._dev_schema_migrations ausente. Dry-run e aplicação param aqui.");
  }

  const recorded = await client.query(
    `SELECT filename FROM public._dev_schema_migrations ORDER BY filename`
  );
  const plan = planMigrationRun(
    files,
    recorded.rows.map((row) => row.filename)
  );
  for (const file of plan.missingHistory) {
    console.log(`HISTÓRICO AUSENTE ${file}`);
  }
  for (const row of plan.actions) {
    console.log(`${row.action.toUpperCase()} ${row.file}`);
  }
  const blocked = plan.actions.filter((row) => row.action === "block");
  const pending = plan.actions.filter((row) => row.action === "apply");
  if (dryRun || plan.missingHistory.length || blocked.length) {
    await client.end();
    console.log(
      `Plano. skip=${plan.actions.filter((row) => row.action === "skip").length} apply=${pending.length} block=${blocked.length}`
    );
    if (plan.missingHistory.length || blocked.length) {
      fail(
        dryRun
          ? "Dry-run bloqueado. Há histórico ausente ou migration já instalada fora do controle. Não reaplicar. A reconciliação é outro script e não rodou."
          : "Aplicação recusada. Há histórico ausente ou migration já instalada fora do controle. Não reaplicar. Use o dry-run e a reconciliação autorizada."
      );
    }
    if (dryRun) return;
  }

  const skipped = plan.actions.filter((row) => row.action === "skip").length;
  for (const row of plan.actions) {
    if (row.action === "skip") console.log(`SKIP ${row.file}`);
  }
  try {
    const result = await applyBatch(client, plan.actions, async (file) =>
      fs.readFileSync(path.join(migrationsDir, file), "utf8")
    );
    console.log(`Concluído. applied=${result.applied} skipped=${skipped}`);
  } catch (err) {
    console.log("FAIL");
    console.error(err?.message || err);
    fail("Lote desfeito. Nenhuma migration nova ficou registrada.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

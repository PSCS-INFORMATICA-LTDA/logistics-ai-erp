/**
 * Ajusta dados fictícios DEV do Contas a Pagar (somente DEV).
 * - renomeia números ACCOUNTS_PAYABLE-* → AP-*
 * - corrige descrições técnicas/smoke
 * - padroniza prefixo da sequência
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const PROD = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function loadEnv(filePath) {
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

const verify = spawnSync(
  process.execPath,
  [path.join(__dirname, "verify-dev-environment.mjs")],
  { cwd: frontendRoot, encoding: "utf8" }
);
if (verify.status !== 0) {
  process.stdout.write(verify.stdout || "");
  process.stderr.write(verify.stderr || "");
  process.exit(1);
}
process.stdout.write(verify.stdout || "");

const env = loadEnv(path.join(frontendRoot, ".env.local"));
if (!env.DATABASE_URL || env.DATABASE_URL.includes(PROD)) {
  console.error("DATABASE_URL inválida");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query("BEGIN");

  const bad = await client.query(`
    select id, internal_number, description
    from public.accounts_payable
    where deleted_at is null
      and (
        internal_number ilike 'ACCOUNTS_PAYABLE%'
        or description ilike '%ACCOUNTS_PAYABLE%'
        or description ilike '%smoke DEV%'
        or description = 'Combustível smoke DEV'
      )
  `);
  console.log("candidates", bad.rowCount);

  for (const row of bad.rows) {
    let nextNumber = row.internal_number;
    if (String(row.internal_number).toUpperCase().startsWith("ACCOUNTS_PAYABLE")) {
      const seq = await client.query(
        `
        insert into public.company_document_sequences
          (company_id, document_type, prefix, last_number, padding)
        select company_id, 'accounts_payable', 'AP', 0, 8
        from public.accounts_payable where id = $1
        on conflict (company_id, document_type) do nothing
        `,
        [row.id]
      );
      void seq;
      const num = await client.query(
        `
        update public.company_document_sequences s
        set last_number = last_number + 1, updated_at = now(), prefix = 'AP'
        from public.accounts_payable ap
        where ap.id = $1
          and s.company_id = ap.company_id
          and s.document_type = 'accounts_payable'
        returning s.last_number, s.padding
        `,
        [row.id]
      );
      const n = num.rows[0].last_number;
      const pad = num.rows[0].padding || 8;
      nextNumber = `AP-${String(n).padStart(pad, "0")}`;
    }

    await client.query(
      `
      update public.accounts_payable
      set internal_number = $2,
          description = 'Teste DEV — Combustível',
          updated_at = now()
      where id = $1
      `,
      [row.id, nextNumber]
    );
    console.log("fixed", row.internal_number, "->", nextNumber);
  }

  await client.query(`
    update public.company_document_sequences
    set prefix = 'AP'
    where document_type = 'accounts_payable'
      and (prefix is distinct from 'AP')
  `);

  await client.query("COMMIT");
  console.log("DEV_DATA_FIXED");
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e.message || e);
  process.exit(1);
} finally {
  await client.end();
}

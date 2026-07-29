/**
 * Seed mínimo + smoke Contas a Pagar no DEV.
 * Bloqueia produção. Não imprime senhas/keys.
 *
 * Uso (cwd=frontend): node scripts/seed-dev-ap-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "tqeenmswotxqainkyyct";
const EMAIL = "dev.ap@pscs.local";
const PASSWORD = "DevAp#2026Test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function fail(msg) {
  console.error("seed-dev-ap-smoke FALHOU:", msg);
  process.exit(1);
}

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
  fail("verify:dev-env");
}
process.stdout.write(verify.stdout || "");

const env = loadEnv(path.join(frontendRoot, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
if (!ref || ref === PROD_REF) fail("ref inválido/prod");
if (!env.DATABASE_URL || env.DATABASE_URL.includes(PROD_REF)) {
  fail("DATABASE_URL ausente ou produção");
}

const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "DEV Contas a Pagar" },
});
if (createErr && !/already|registered|exists/i.test(createErr.message)) {
  fail("createUser: " + createErr.message);
}
const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
const user =
  created?.user ||
  listed?.users?.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user?.id) fail("usuário DEV não encontrado");

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function q(sql, params = []) {
  return client.query(sql, params);
}

try {
  await q("BEGIN");
  // Auth context for SECURITY DEFINER RPCs that call auth.uid()
  // is_local=true só vale dentro da transação — por isso BEGIN acima.
  await q(`select set_config('request.jwt.claim.sub', $1, true)`, [user.id]);
  await q(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
  await q(
    `select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: user.id, role: "authenticated" })]
  );

  let companyId;
  {
    const existing = await q(
      `select id from public.companies where name = $1 limit 1`,
      ["PSCS DEV Contas a Pagar"]
    );
    if (existing.rowCount) {
      companyId = existing.rows[0].id;
      console.log("company exists");
    } else {
      const ins = await q(
        `insert into public.companies (name, trade_name, document, status)
         values ($1,$2,$3,'Ativo') returning id`,
        ["PSCS DEV Contas a Pagar", "DEV AP", "00.000.000/0001-91"]
      );
      companyId = ins.rows[0].id;
      console.log("company created");
    }
  }

  await q(
    `insert into public.company_members (company_id, user_id, role)
     values ($1,$2,'admin')
     on conflict (company_id, user_id) do update set role = excluded.role`,
    [companyId, user.id]
  );

  await q(`select public.seed_chart_of_accounts($1::uuid)`, [companyId]);

  let branchId;
  {
    const b = await q(
      `select id from public.branches where company_id=$1 and code='MATRIZ' limit 1`,
      [companyId]
    );
    if (b.rowCount) branchId = b.rows[0].id;
    else {
      const ins = await q(
        `insert into public.branches (company_id, code, name, is_default, status)
         values ($1,'MATRIZ','Matriz DEV', true, 'Ativo') returning id`,
        [companyId]
      );
      branchId = ins.rows[0].id;
    }
  }

  let supplierId;
  {
    const s = await q(
      `select id from public.suppliers
       where company_id=$1 and code='FOR-DEV-001' and deleted_at is null limit 1`,
      [companyId]
    );
    if (s.rowCount) supplierId = s.rows[0].id;
    else {
      const ins = await q(
        `insert into public.suppliers
           (company_id, code, name, category, status)
         values ($1,'FOR-DEV-001','Fornecedor DEV Combustível','Combustivel','Ativo')
         returning id`,
        [companyId]
      );
      supplierId = ins.rows[0].id;
    }
  }

  let accountId;
  {
    const a = await q(
      `select id from public.company_financial_accounts
       where company_id=$1 and name='Caixa DEV' and deleted_at is null limit 1`,
      [companyId]
    );
    if (a.rowCount) accountId = a.rows[0].id;
    else {
      const ins = await q(
        `insert into public.company_financial_accounts
           (company_id, branch_id, name, account_type, opening_balance, opening_balance_date)
         values ($1,$2,'Caixa DEV','cash',1000, CURRENT_DATE)
         returning id`,
        [companyId, branchId]
      );
      accountId = ins.rows[0].id;
    }
  }

  const coa = await q(
    `select id from public.chart_of_accounts
     where company_id=$1 and name='Posto de Combustível'
     limit 1`,
    [companyId]
  );
  if (!coa.rowCount) fail("conta DRE 'Posto de Combustível' não encontrada");
  const chartId = coa.rows[0].id;

  // Ensure approval settings row exists (approval off = auto-approve path)
  await q(
    `insert into public.company_financial_approval_settings (company_id)
     values ($1)
     on conflict (company_id) do nothing`,
    [companyId]
  );
  // Table might not have unique on company_id — handle gracefully
  const settingsCols = await q(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='company_financial_approval_settings'`
  );
  console.log(
    "approval_settings_cols",
    settingsCols.rows.map((r) => r.column_name).join(",")
  );

  const hasAp = settingsCols.rows.some(
    (r) => r.column_name === "ap_approval_enabled"
  );
  if (hasAp) {
    await q(
      `update public.company_financial_approval_settings
       set ap_approval_enabled = false
       where company_id = $1`,
      [companyId]
    );
  }

  const amount = 150.5;
  const numberRes = await q(
    `select public.next_company_document_number($1::uuid, 'accounts_payable', 'AP', 8) as n`,
    [companyId]
  );
  const internalNumber = numberRes.rows[0].n;

  const apIns = await q(
    `insert into public.accounts_payable (
       company_id, branch_id, internal_number, description,
       competence_date, entry_date, supplier_id, chart_of_account_id,
       original_amount, net_amount, open_balance, installment_count,
       status, approval_status, source, created_by
     ) values (
       $1,$2,$3,'Teste DEV — Combustível',
       CURRENT_DATE, CURRENT_DATE, $4, $5,
       $6,$6,$6,1,
       'open','draft','manual',$7
     ) returning id`,
    [companyId, branchId, internalNumber, supplierId, chartId, amount, user.id]
  );
  const apId = apIns.rows[0].id;

  await q(
    `insert into public.accounts_payable_installments (
       company_id, accounts_payable_id, installment_no, due_date,
       amount, open_balance, status, created_by
     ) values ($1,$2,1, CURRENT_DATE + 7, $3, $3, 'open', $4)`,
    [companyId, apId, amount, user.id]
  );

  await q(
    `insert into public.accounts_payable_allocations (
       company_id, accounts_payable_id, line_no, amount, percent,
       chart_of_account_id, created_by
     ) values ($1,$2,1,$3,100,$4,$5)`,
    [companyId, apId, amount, chartId, user.id]
  );

  const approve = await q(
    `select public.approve_accounts_payable($1::uuid, 'Smoke DEV') as result`,
    [apId]
  );
  console.log("approve", JSON.stringify(approve.rows[0].result));

  const ap = await q(
    `select approval_status, status, open_balance from public.accounts_payable where id=$1`,
    [apId]
  );
  console.log("ap_row", ap.rows[0]);

  const postings = await q(
    `select count(*)::int as n from public.accounts_payable_postings
     where accounts_payable_id=$1 and reversed_at is null`,
    [apId]
  );
  console.log("postings", postings.rows[0].n);

  const fts = await q(
    `select count(*)::int as n from public.financial_transactions ft
     join public.accounts_payable_postings p on p.financial_transaction_id = ft.id
     where p.accounts_payable_id=$1`,
    [apId]
  );
  console.log("financial_transactions", fts.rows[0].n);

  if (ap.rows[0].approval_status !== "approved") fail("AP não aprovado");
  if (postings.rows[0].n < 1) fail("sem postings");
  if (fts.rows[0].n < 1) fail("sem FT DRE");

  const tables = await q(`
    select table_name from information_schema.tables
    where table_schema='public'
      and table_name in (
        'accounts_payable','accounts_payable_installments',
        'accounts_payable_allocations','accounts_payable_payments',
        'accounts_payable_postings','company_financial_accounts',
        'company_document_sequences'
      )
    order by 1`);
  console.log(
    "ap_tables",
    tables.rows.map((r) => r.table_name).join(",")
  );

  console.log("SMOKE_OK");
  console.log("login_hint", EMAIL);
  await q("COMMIT");
} catch (e) {
  try {
    await q("ROLLBACK");
  } catch {
    /* ignore */
  }
  throw e;
} finally {
  await client.end();
}

/**
 * Seed multiempresa DEV — Empresa A + Empresa B (Contas a Pagar).
 *
 * Bloqueia produção. Idempotente.
 * Senha dos usuários: env DEV_SEED_PASSWORD (não versionada).
 *
 * Uso (cwd=frontend):
 *   $env:DEV_SEED_PASSWORD="..."
 *   node scripts/seed-dev-ap-multicompany.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const COMPANY_A = "PSCS DEV Contas a Pagar";
const COMPANY_B = "GRX DEV Empresa B";

const USERS = {
  aAdmin: { email: "dev.ap.a.admin@pscs.local", name: "Admin Empresa A DEV", role: "admin" },
  aFin: { email: "dev.ap.a.fin@pscs.local", name: "Financeiro Empresa A DEV", role: "financeiro" },
  bAdmin: { email: "dev.ap.b.admin@pscs.local", name: "Admin Empresa B DEV", role: "admin" },
  bFin: { email: "dev.ap.b.fin@pscs.local", name: "Financeiro Empresa B DEV", role: "financeiro" },
};

function fail(msg) {
  console.error("seed-dev-ap-multicompany FALHOU:", msg);
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
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(
  /^https:\/\/([a-z0-9]+)\.supabase\.co/i
)?.[1];
if (!ref || ref === PROD_REF) fail("ref inválido/prod");
if (!env.DATABASE_URL || env.DATABASE_URL.includes(PROD_REF)) fail("DATABASE_URL");
if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  fail("chaves DEV ausentes");
}

const password = process.env.DEV_SEED_PASSWORD || "";
if (!password || password.length < 8) {
  fail("Defina DEV_SEED_PASSWORD (mín. 8) no ambiente — não versionar.");
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureAuthUser(email, fullName) {
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = listed?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) fail(`createUser ${email}: ${error.message}`);
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
  }
  return user.id;
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function q(sql, params = []) {
  return client.query(sql, params);
}

async function ensureCompany(name, trade, document) {
  const existing = await q(`select id from public.companies where name = $1 limit 1`, [name]);
  if (existing.rowCount) return existing.rows[0].id;
  const ins = await q(
    `insert into public.companies (name, trade_name, document, status)
     values ($1,$2,$3,'Ativo') returning id`,
    [name, trade, document]
  );
  return ins.rows[0].id;
}

async function seedCompany(companyId, tag, adminUserId, finUserId) {
  await q(
    `insert into public.company_members (company_id, user_id, role)
     values ($1,$2,'admin')
     on conflict (company_id, user_id) do update set role = 'admin'`,
    [companyId, adminUserId]
  );
  await q(
    `insert into public.company_members (company_id, user_id, role)
     values ($1,$2,'financeiro')
     on conflict (company_id, user_id) do update set role = 'financeiro'`,
    [companyId, finUserId]
  );

  await q(`select public.seed_chart_of_accounts($1::uuid)`, [companyId]);

  await q(
    `insert into public.company_financial_approval_settings (company_id, ap_approval_enabled)
     values ($1, false)
     on conflict (company_id) do update set ap_approval_enabled = false`,
    [companyId]
  );

  let branchId;
  {
    const r = await q(
      `select id from public.branches where company_id=$1 and code='MATRIZ' limit 1`,
      [companyId]
    );
    if (r.rowCount) branchId = r.rows[0].id;
    else {
      const ins = await q(
        `insert into public.branches (company_id, code, name, is_default, status)
         values ($1,'MATRIZ',$2,true,'Ativo') returning id`,
        [companyId, `Matriz ${tag}`]
      );
      branchId = ins.rows[0].id;
    }
  }

  async function upsertNamed(table, code, insertSql, insertParams) {
    const r = await q(
      `select id from public.${table} where company_id=$1 and code=$2 limit 1`,
      [companyId, code]
    );
    if (r.rowCount) return r.rows[0].id;
    const ins = await q(insertSql, insertParams);
    return ins.rows[0].id;
  }

  const supplierId = await upsertNamed(
    "suppliers",
    `FOR-${tag}-001`,
    `insert into public.suppliers (company_id, code, name, category, status)
     values ($1,$2,$3,'Combustivel','Ativo') returning id`,
    [companyId, `FOR-${tag}-001`, `Fornecedor ${tag} DEV`]
  );

  const clientId = await upsertNamed(
    "clients",
    `CLI-${tag}-001`,
    `insert into public.clients (company_id, code, name, status)
     values ($1,$2,$3,'Ativo') returning id`,
    [companyId, `CLI-${tag}-001`, `Cliente ${tag} DEV`]
  );

  const driverId = await upsertNamed(
    "drivers",
    `MOT-${tag}-001`,
    `insert into public.drivers
       (company_id, code, name, name_normalized, driver_type, status, active_for_operations)
     values ($1,$2,$3,lower($3),'Motorista','Ativo',true) returning id`,
    [companyId, `MOT-${tag}-001`, `Motorista ${tag} DEV`]
  );

  const plate = tag === "A" ? "DEV0A01" : "DEV0B01";
  let vehicleId;
  {
    const r = await q(
      `select id from public.vehicles where company_id=$1 and code=$2 limit 1`,
      [companyId, `VEI-${tag}-001`]
    );
    if (r.rowCount) vehicleId = r.rows[0].id;
    else {
      const ins = await q(
        `insert into public.vehicles
           (company_id, branch_id, code, plate, plate_display, model, vehicle_category, status)
         values ($1,$2,$3,$4,$4,'Van DEV','Van','Ativo') returning id`,
        [companyId, branchId, `VEI-${tag}-001`, plate]
      );
      vehicleId = ins.rows[0].id;
    }
  }

  let osId;
  {
    const code = `OS-${tag}-001`;
    const r = await q(
      `select id from public.service_orders where company_id=$1 and code=$2 limit 1`,
      [companyId, code]
    );
    if (r.rowCount) osId = r.rows[0].id;
    else {
      const ins = await q(
        `insert into public.service_orders
           (company_id, branch_id, code, service_type, service_date, plate, client_name,
            service_name, service_amount, status, driver_id)
         values ($1,$2,$3,'CarWash', CURRENT_DATE, $4, $5, 'Lavagem DEV', 50, 'Aberto', $6)
         returning id`,
        [companyId, branchId, code, plate, `Cliente ${tag} DEV`, driverId]
      );
      osId = ins.rows[0].id;
    }
  }

  let accountId;
  {
    const name = `Caixa ${tag} DEV`;
    const r = await q(
      `select id from public.company_financial_accounts
       where company_id=$1 and name=$2 and deleted_at is null limit 1`,
      [companyId, name]
    );
    if (r.rowCount) accountId = r.rows[0].id;
    else {
      const ins = await q(
        `insert into public.company_financial_accounts
           (company_id, branch_id, name, account_type, opening_balance, opening_balance_date)
         values ($1,$2,$3,'cash',500, CURRENT_DATE) returning id`,
        [companyId, branchId, name]
      );
      accountId = ins.rows[0].id;
    }
  }

  const coa = await q(
    `select id from public.chart_of_accounts
     where company_id=$1 and name='Posto de Combustível' limit 1`,
    [companyId]
  );
  if (!coa.rowCount) fail(`DRE Posto ausente em ${tag}`);
  const chartId = coa.rows[0].id;

  async function ensureAp({ description, approval, amount }) {
    const existing = await q(
      `select id, internal_number from public.accounts_payable
       where company_id=$1 and description=$2 and deleted_at is null limit 1`,
      [companyId, description]
    );
    if (existing.rowCount) {
      return { id: existing.rows[0].id, number: existing.rows[0].internal_number };
    }

    await q(`select set_config('request.jwt.claim.sub', $1, true)`, [adminUserId]);
    await q(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: adminUserId, role: "authenticated" })]
    );
    const num = await q(
      `select public.next_company_document_number($1::uuid,'accounts_payable','AP',8) as n`,
      [companyId]
    );
    const internalNumber = num.rows[0].n;
    const ap = await q(
      `insert into public.accounts_payable (
         company_id, branch_id, internal_number, description, competence_date, entry_date,
         supplier_id, chart_of_account_id, original_amount, net_amount, open_balance,
         installment_count, status, approval_status, source, created_by
       ) values (
         $1,$2,$3,$4, CURRENT_DATE, CURRENT_DATE,
         $5,$6,$7,$7,$7,1,'open','draft','manual',$8
       ) returning id`,
      [
        companyId,
        branchId,
        internalNumber,
        description,
        supplierId,
        chartId,
        amount,
        adminUserId,
      ]
    );
    const apId = ap.rows[0].id;
    await q(
      `insert into public.accounts_payable_installments
         (company_id, accounts_payable_id, installment_no, due_date, amount, open_balance, status, created_by)
       values ($1,$2,1, CURRENT_DATE + 10, $3, $3, 'open', $4)`,
      [companyId, apId, amount, adminUserId]
    );
    await q(
      `insert into public.accounts_payable_allocations
         (company_id, accounts_payable_id, line_no, amount, percent, chart_of_account_id, created_by)
       values ($1,$2,1,$3,100,$4,$5)`,
      [companyId, apId, amount, chartId, adminUserId]
    );
    if (approval === "approved") {
      await q(`select public.approve_accounts_payable($1::uuid, 'Seed multiempresa DEV')`, [apId]);
    }
    return { id: apId, number: internalNumber };
  }

  await q("BEGIN");
  try {
    await q(`select set_config('request.jwt.claim.sub', $1, true)`, [adminUserId]);
    await q(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: adminUserId, role: "authenticated" })]
    );
    const draft = await ensureAp({
      description: `Teste DEV ${tag} — Rascunho`,
      approval: "draft",
      amount: 80,
    });
    const approved = await ensureAp({
      description: `Teste DEV ${tag} — Combustível aprovado`,
      approval: "approved",
      amount: 120.5,
    });
    await q("COMMIT");
    return {
      companyId,
      branchId,
      supplierId,
      clientId,
      driverId,
      vehicleId,
      osId,
      accountId,
      chartId,
      draft,
      approved,
    };
  } catch (e) {
    await q("ROLLBACK");
    throw e;
  }
}

try {
  const aAdminId = await ensureAuthUser(USERS.aAdmin.email, USERS.aAdmin.name);
  const aFinId = await ensureAuthUser(USERS.aFin.email, USERS.aFin.name);
  const bAdminId = await ensureAuthUser(USERS.bAdmin.email, USERS.bAdmin.name);
  const bFinId = await ensureAuthUser(USERS.bFin.email, USERS.bFin.name);

  const companyAId = await ensureCompany(COMPANY_A, "DEV AP A", "00.000.000/0001-91");
  const companyBId = await ensureCompany(COMPANY_B, "DEV AP B", "00.000.000/0002-72");

  const a = await seedCompany(companyAId, "A", aAdminId, aFinId);
  const b = await seedCompany(companyBId, "B", bAdminId, bFinId);

  const outPath = path.join(frontendRoot, ".tmp-dev-ap-multicompany.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        refMask: `${ref.slice(0, 4)}…${ref.slice(-4)}`,
        companyA: { id: companyAId, name: COMPANY_A, ...a, adminEmail: USERS.aAdmin.email },
        companyB: { id: companyBId, name: COMPANY_B, ...b, adminEmail: USERS.bAdmin.email },
        emails: Object.fromEntries(Object.entries(USERS).map(([k, v]) => [k, v.email])),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("SEED_OK");
  console.log("companyA", COMPANY_A, a.draft.number, a.approved.number);
  console.log("companyB", COMPANY_B, b.draft.number, b.approved.number);
  console.log("meta", outPath);
} catch (e) {
  fail((e?.message || String(e)) + (e?.stack ? `\n${e.stack.split("\n").slice(0, 4).join("\n")}` : ""));
} finally {
  await client.end();
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/092_chart_seed_finance_guard.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "supabase/rollbacks/092_chart_seed_finance_guard.sql"), "utf8");
const editor = fs.readFileSync(path.join(root, "frontend/scripts/apply-092-sql-editor.sql"), "utf8");
const previous = fs.readFileSync(path.join(root, "supabase/migrations/091_pre_pilot_security.sql"), "utf8");

describe("arquivos da 092", () => {
  it("restringe o plano e preserva o seed de tarifas", () => {
    assert.equal(migration.includes("$$"), false);
    assert.equal(rollback.includes("$$"), false);
    assert.match(migration, /auth_user_can_access_company_finance\(p_company_id\)/);
    assert.doesNotMatch(migration, /create or replace function public\.seed_freight_rate_defaults/i);
    assert.match(rollback, /auth_user_has_company\(p_company_id\)/);
    assert.doesNotMatch(rollback, /auth_user_can_access_company_finance/);
    assert.match(editor, /\nbegin;\n/);
    assert.match(editor, /\ncommit;\s*$/);
    assert.match(editor, /092_chart_seed_finance_guard\.sql/);
  });
});

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const FIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const OPER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const FIN_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

function claims(sub) {
  return `'${JSON.stringify({ sub, role: "authenticated" }).replaceAll("'", "''")}'`;
}

async function failIf(db, sql, needle) {
  try {
    await db.exec(sql);
  } catch (error) {
    assert.match(String(error?.message || error), needle);
    try { await db.exec("rollback"); } catch { /* sessão ociosa */ }
    return;
  }
  throw new Error(`esperava erro ${needle}`);
}

describe("seed do plano no Postgres local", () => {
  it("aceita administrador e financeiro, recusa operacional e outra empresa, e mantém a tarifa para membro", async () => {
    const { PGlite } = await import("/tmp/pglite-090/node_modules/@electric-sql/pglite/dist/index.js");
    const db = new PGlite();
    const freightStart = previous.indexOf("CREATE OR REPLACE FUNCTION public.seed_freight_rate_defaults");
    const freightEnd = previous.indexOf("CREATE OR REPLACE FUNCTION public.seed_demo_freight_os");
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $uid$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $uid$;
      create table public.companies (id uuid primary key, name text);
      create table public.company_members (company_id uuid, user_id uuid, role text, primary key (company_id, user_id));
      create table public.chart_of_accounts (
        id uuid primary key default gen_random_uuid(), company_id uuid not null, name text not null,
        classification text, transaction_type text, status text, unique (company_id, name)
      );
      create table public.freight_rate_tables (
        id uuid primary key default gen_random_uuid(), company_id uuid, code text, modality text,
        vehicle_category text, rate_per_km numeric, round_trip_from_km numeric, valid_from date, status text, notes text
      );
      insert into public.companies values ('${A}', 'A'), ('${B}', 'B');
      insert into public.company_members values
        ('${A}', '${FIN}', 'financeiro'),
        ('${A}', '${ADMIN}', 'admin'),
        ('${A}', '${OPER}', 'operacional'),
        ('${B}', '${FIN_B}', 'financeiro');
      create or replace function public.auth_user_can_access_company_finance(p_company_id uuid)
      returns boolean language sql stable as $fin$
        select exists (
          select 1 from public.company_members m
          where m.user_id = auth.uid() and m.company_id = p_company_id and m.role in ('admin', 'financeiro')
        )
      $fin$;
      create or replace function public.auth_user_has_company(p_company_id uuid)
      returns boolean language sql stable as $mem$
        select exists (
          select 1 from public.company_members m
          where m.user_id = auth.uid() and m.company_id = p_company_id
        )
      $mem$;
    `);
    await db.exec(migration);
    await db.exec(previous.slice(freightStart, freightEnd));

    async function asUser(id) {
      await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false)`);
      await db.exec(`select set_config('request.jwt.claims', ${claims(id)}, false)`);
    }
    await asUser(OPER);
    await failIf(db, `select public.seed_chart_of_accounts('${A}')`, /Sem permissão para inicializar o plano/);
    const untouched = await db.query("select count(*)::int as n from public.chart_of_accounts");
    assert.equal(untouched.rows[0].n, 0);

    await asUser(FIN);
    const first = await db.query(`select public.seed_chart_of_accounts('${A}') as n`);
    assert.ok(Number(first.rows[0].n) > 0);
    const second = await db.query(`select public.seed_chart_of_accounts('${A}') as n`);
    assert.equal(Number(second.rows[0].n), 0);
    await failIf(db, `select public.seed_chart_of_accounts('${B}')`, /Sem permissão para inicializar o plano/);
    const companyB = await db.query(`select count(*)::int as n from public.chart_of_accounts where company_id = '${B}'`);
    assert.equal(companyB.rows[0].n, 0);

    await asUser(ADMIN);
    const adminCall = await db.query(`select public.seed_chart_of_accounts('${A}') as n`);
    assert.equal(Number(adminCall.rows[0].n), 0);

    await asUser(OPER);
    await db.exec(`select public.seed_freight_rate_defaults('${A}')`);
    const rates = await db.query(`select count(*)::int as n from public.freight_rate_tables where company_id = '${A}'`);
    assert.equal(rates.rows[0].n, 5);
    await db.close();
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertReconcileTarget } from "./reconcile-dev-migration-ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, "reconcile-dev-migration-ledger.sql");
const canonPath = path.join(here, "fixtures/reconcile-canon-functions.sql");
const scriptSql = fs.readFileSync(scriptPath, "utf8");
const pglitePath = "/tmp/pglite-090/node_modules/@electric-sql/pglite/dist/index.js";

function priorNames() {
  const incoming = new Set([
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
  ]);
  const names = [...scriptSql.matchAll(/\('((?:0[0-8]\d|082)_[^']+\.sql)'\)/g)].map((match) => match[1]);
  const unique = [...new Set(names)].filter((name) => !incoming.has(name));
  assert.equal(unique.length, 80);
  return unique;
}

async function database() {
  const { PGlite } = await import(pglitePath);
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.companies (id uuid primary key, name text not null);
    create table public.profiles (id uuid primary key, pscs_one_user_id text);
    create unique index idx_profiles_pscs_one_user_id on public.profiles (pscs_one_user_id);
    create table public.financial_transactions (id uuid primary key);
    create table public.financial_correction_events (id uuid primary key);
    create table public.service_orders (id uuid primary key);
    create table public.accounts_payable (id uuid primary key, company_id uuid, approval_status text);
    create table public.chart_of_accounts (id uuid primary key, company_id uuid, classification text);
    create table public.company_members (company_id uuid, user_id uuid, role text);
    create view public.vw_ownership_base with (security_invoker = true) as select 1 as ready;
    create table public._dev_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public._dev_schema_migrations enable row level security;
    revoke all on table public._dev_schema_migrations from public, anon, authenticated;
    grant select, insert, update, delete on table public._dev_schema_migrations to service_role;
    create or replace function public.guard_service_order_direct_confirmation() returns trigger language plpgsql as $$ begin return new; end $$;
    create or replace function public.guard_financial_transaction_approval_insert() returns trigger language plpgsql as $$ begin return new; end $$;
    create or replace function public.guard_financial_transaction_direct_delete() returns trigger language plpgsql as $$ begin return old; end $$;
    create or replace function public.guard_financial_correction_events_immutable() returns trigger language plpgsql as $$ begin return null; end $$;
    create or replace function public.guard_financial_correction_events_no_truncate() returns trigger language plpgsql as $$ begin return null; end $$;
    create or replace function public.guard_financial_transaction_approved_fields() returns trigger language plpgsql as $$ begin return new; end $$;
  `);
  await db.exec(fs.readFileSync(canonPath, "utf8"));
  await db.exec(`
    create trigger trg_service_orders_guard_direct_confirmation before update on public.service_orders for each row execute function guard_service_order_direct_confirmation();
    create trigger trg_financial_transactions_approval_status before update on public.financial_transactions for each row execute function guard_financial_transaction_approval_status();
    create trigger trg_financial_transactions_approval_insert before insert on public.financial_transactions for each row execute function guard_financial_transaction_approval_insert();
    create trigger trg_financial_transactions_direct_delete before delete on public.financial_transactions for each row execute function guard_financial_transaction_direct_delete();
    create trigger trg_financial_correction_events_immutable before insert or delete or update on public.financial_correction_events for each row execute function guard_financial_correction_events_immutable();
    create trigger trg_financial_correction_events_no_truncate before truncate on public.financial_correction_events for each statement execute function guard_financial_correction_events_no_truncate();
    create trigger trg_financial_transactions_approved_fields before update on public.financial_transactions for each row execute function guard_financial_transaction_approved_fields();
  `);
  return db;
}

async function seedLedger(db, names, stamp = "2026-11-01T12:00:00Z") {
  for (const name of names) {
    await db.query(
      "insert into public._dev_schema_migrations (filename, applied_at) values ($1, $2)",
      [name, stamp]
    );
  }
}

async function seedCompanies(db) {
  await db.exec(`
    insert into public.companies (id, name) values
      ('92c4c90d-6856-4c41-a9a1-9eba6a7468f6', 'PSCS DEV Contas a Pagar'),
      ('bcd3c6c9-0e4a-4356-addd-4af925725576', 'GRX DEV Empresa B');
  `);
}

async function runScript(db) {
  try {
    await db.exec(scriptSql);
    return { failed: false, message: "" };
  } catch (error) {
    return { failed: true, message: String(error.message || error) };
  }
}

async function ledgerCount(db) {
  await db.exec("rollback").catch(() => {});
  const result = await db.query("select count(*)::int as n from public._dev_schema_migrations");
  return result.rows[0].n;
}

test("conexão de produção e host estranho são recusados sem abrir banco", () => {
  assert.throws(
    () => assertReconcileTarget("postgresql://postgres:secret@db.tqeenmswotxqainkyyct.supabase.co:5432/postgres"),
    /produção/
  );
  assert.throws(
    () => assertReconcileTarget("postgresql://postgres.jmbajdpkvlrslirwzyze:secret@db.tqeenmswotxqainkyyct.supabase.co:5432/postgres"),
    /produção/
  );
  assert.throws(
    () => assertReconcileTarget("postgresql://postgres:secret@db.outroprojeto.supabase.co:5432/postgres"),
    /não é o DEV/
  );
  assert.deepEqual(
    assertReconcileTarget("postgresql://postgres:secret@db.jmbajdpkvlrslirwzyze.supabase.co:5432/postgres"),
    { host: "db.jmbajdpkvlrslirwzyze.supabase.co", user: "postgres" }
  );
  assert.equal(
    assertReconcileTarget("postgresql://postgres.jmbajdpkvlrslirwzyze:secret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres").user,
    "postgres.jmbajdpkvlrslirwzyze"
  );
});

test("função ausente impede a reconciliação", async () => {
  const db = await database();
  const names = priorNames();
  await seedCompanies(db);
  await seedLedger(db, names);
  await db.exec("drop function public.company_has_no_members(uuid)");
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /company_has_no_members/);
  assert.equal(await ledgerCount(db), 80);
});

test("hash divergente impede a reconciliação", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames());
  await db.exec("create or replace function public.company_has_no_members(p_company_id uuid) returns boolean language sql as $$ select true $$");
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /company_has_no_members/);
  assert.equal(await ledgerCount(db), 80);
});

test("trigger desativada impede a reconciliação", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames());
  await db.exec("alter table public.financial_transactions disable trigger trg_financial_transactions_approved_fields");
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /trg_financial_transactions_approved_fields/);
  assert.equal(await ledgerCount(db), 80);
});

test("migration já registrada impede a reconciliação", async () => {
  const db = await database();
  await seedCompanies(db);
  const names = priorNames();
  await seedLedger(db, names);
  await db.query("insert into public._dev_schema_migrations (filename, applied_at) values ('090_financial_approved_field_guard.sql', '2026-11-01T12:00:00Z')");
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /já está no controle/);
  assert.equal(await ledgerCount(db), 81);
});

test("histórico 021 ausente impede a reconciliação", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames().filter((name) => name !== "021_seed_demo_freight_os.sql"));
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /021 ou 060/);
  assert.equal(await ledgerCount(db), 79);
});

test("quantidade inicial divergente impede a reconciliação", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames().filter((name) => name !== "003_seed_chart_of_accounts.sql"));
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /80 nomes/);
  assert.equal(await ledgerCount(db), 79);
});

test("ambiente incorreto impede a reconciliação", async () => {
  const db = await database();
  await seedLedger(db, priorNames());
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /não é o DEV/);
  assert.equal(await ledgerCount(db), 80);
});

test("falha na pós-validação desfaz a inserção", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames());
  await db.exec(`
    create function public.recon_sabotage() returns trigger language plpgsql as $$
    begin
      if new.filename = '091_pre_pilot_security.sql' then
        delete from public._dev_schema_migrations where filename = '021_seed_demo_freight_os.sql';
      end if;
      return new;
    end $$;
    create trigger recon_sabotage before insert on public._dev_schema_migrations
    for each row execute function public.recon_sabotage();
  `);
  const result = await runScript(db);
  assert.equal(result.failed, true);
  assert.match(result.message, /registro anterior foi alterado|021 ou 060/);
  assert.equal(await ledgerCount(db), 80);
  const kept = await db.query("select count(*)::int as n from public._dev_schema_migrations where filename = '021_seed_demo_freight_os.sql'");
  assert.equal(kept.rows[0].n, 1);
});

test("caminho válido local preserva os 80 e termina em 91", async () => {
  const db = await database();
  await seedCompanies(db);
  await seedLedger(db, priorNames());
  const result = await runScript(db);
  assert.equal(result.failed, false, result.message);
  const count = await db.query("select count(*)::int as n from public._dev_schema_migrations");
  assert.equal(count.rows[0].n, 91);
  const preserved = await db.query(
    "select count(*)::int as n from public._dev_schema_migrations where filename <> all($1::text[]) and applied_at = '2026-11-01T12:00:00Z'",
    [[
      "078_pscs_one_user_id.sql","079_close_company_members_self_join.sql","083_public_driver_assignment_schedule.sql","084_service_order_security_guards.sql","085_driver_reassignment_and_public_amounts.sql","086_rbac_financial_and_ownership_view.sql","087_driver_payment_and_finance_rpc_guards.sql","088_financial_approval_status_guard.sql","089_financial_insert_delete_guard.sql","090_financial_approved_field_guard.sql","091_pre_pilot_security.sql",
    ]]
  );
  assert.equal(preserved.rows[0].n, 80);
});

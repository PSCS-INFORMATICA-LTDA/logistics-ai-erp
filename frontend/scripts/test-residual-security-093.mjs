import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/093_residual_search_path_and_helpers.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "supabase/rollbacks/093_residual_search_path_and_helpers.sql"), "utf8");
const editor = fs.readFileSync(path.join(root, "frontend/scripts/apply-093-sql-editor.sql"), "utf8");

const functions = [
  "public.set_updated_at()",
  "public.normalize_driver_name()",
  "public.sync_transaction_classification()",
  "public.ensure_single_default_branch()",
  "public.check_ownership_percentage()",
  "public.sync_traffic_infraction_plate()",
  "public.trg_deletion_audit_events_immutable()",
  "public.compliance_documents_set_root()",
  "public.service_order_driver_confirmed(uuid, text)",
];
const helpers = [
  "public._ap_assert_company_member(uuid)",
  "public._ap_post_competence(uuid)",
  "public._assert_service_order_member(uuid)",
];

describe("arquivos da 093", () => {
  it("fixa o caminho, revoga o helper e não mexe na trilha nem na 092", () => {
    assert.equal(migration.includes("$$"), false);
    assert.equal(rollback.includes("$$"), false);
    for (const name of functions) {
      assert.match(migration, new RegExp(`alter function ${name.replace(/[()]/g, "\\$&")} set search_path = public`, "i"));
      assert.match(rollback, new RegExp(`alter function ${name.replace(/[()]/g, "\\$&")} reset search_path`, "i"));
    }
    for (const name of helpers) {
      assert.match(migration, new RegExp(`revoke all on function ${name.replace(/[()]/g, "\\$&")} from authenticated`, "i"));
      assert.match(rollback, new RegExp(`grant execute on function ${name.replace(/[()]/g, "\\$&")} to authenticated`, "i"));
    }
    assert.doesNotMatch(rollback, /to anon|to public/i);
    assert.doesNotMatch(migration, /grant |revoke all on table|seed_chart_of_accounts/i);
    assert.match(editor, /\nbegin;\n/);
    assert.match(editor, /\ncommit;\s*$/);
    assert.match(editor, /lock table public\._dev_schema_migrations in share row exclusive mode/i);
    assert.match(editor, /092_chart_seed_finance_guard\.sql/);
    assert.match(editor, /insert into public\._dev_schema_migrations \(filename\)\s+values \('093_residual_search_path_and_helpers\.sql'\)/i);
    assert.match(editor, /esperado 92 registros distintos/i);
    assert.match(editor, /esperado 93 registros distintos/i);
    assert.doesNotMatch(editor, /\bgrant\b/i);
    assert.equal((editor.match(/\nbegin;\n/g) || []).length, 1);
    assert.equal((editor.match(/\ncommit;\n/g) || []).length, 1);
  });
});

describe("search_path e helper no Postgres local", () => {
  it("fixa o caminho, bloqueia o papel de aplicação e deixa o dono chamar", async () => {
    const { PGlite } = await import("/tmp/pglite-090/node_modules/@electric-sql/pglite/dist/index.js");
    const db = new PGlite();
    await db.exec(`
      create or replace function public.set_updated_at()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
      create or replace function public._ap_assert_company_member(p_company_id uuid)
      returns void language plpgsql as $fn$ begin return; end $fn$;
      create role app_user nologin;
      grant usage on schema public to app_user;
      grant execute on function public._ap_assert_company_member(uuid) to app_user;
    `);
    await db.exec("ALTER FUNCTION public.set_updated_at() SET search_path = public");
    await db.exec("REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM PUBLIC");
    await db.exec("REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM app_user");
    const config = await db.query(`
      select proconfig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_updated_at'
    `);
    assert.deepEqual(config.rows[0].proconfig, ["search_path=public"]);

    await db.exec("set role app_user");
    let denied = "";
    try {
      await db.exec("select public._ap_assert_company_member('11111111-1111-1111-1111-111111111111')");
    } catch (error) {
      denied = String(error.message || error);
    }
    assert.match(denied, /permission denied/i);
    await db.exec("reset role");

    await db.exec(`
      create or replace function public.approve_wrapper(p_company_id uuid)
      returns void language plpgsql security definer set search_path = public as $fn$
      begin
        perform public._ap_assert_company_member(p_company_id);
      end $fn$;
      grant execute on function public.approve_wrapper(uuid) to app_user;
    `);
    await db.exec("set role app_user");
    await db.exec("select public.approve_wrapper('11111111-1111-1111-1111-111111111111')");
    await db.exec("reset role");
    await db.exec("ALTER FUNCTION public.set_updated_at() RESET search_path");
    const cleared = await db.query(`
      select proconfig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_updated_at'
    `);
    assert.equal(cleared.rows[0].proconfig, null);
    await db.close();
  });
});

const PGLITE = "/tmp/pglite-090/node_modules/@electric-sql/pglite/dist/index.js";
const COMPANY_ID = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
const FILE_092 = "092_chart_seed_finance_guard.sql";
const FILE_093 = "093_residual_search_path_and_helpers.sql";
const PRIOR_AT = "2026-11-24 17:01:44.094947+00";

function priorNames(count = 92) {
  const names = [];
  for (let i = 1; i < count; i += 1) names.push(`${String(i).padStart(3, "0")}_prior.sql`);
  names.push(FILE_092);
  return names.slice(0, count);
}

async function openLedger(options = {}) {
  const { PGlite } = await import(PGLITE);
  const db = new PGlite();
  const companyName = options.companyName ?? "PSCS DEV Contas a Pagar";
  const names = options.names ?? priorNames(92);
  await db.exec(`
    create table public.companies (id uuid primary key, name text);
    insert into public.companies (id, name) values ('${COMPANY_ID}', '${companyName}');
    create table public._dev_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
    create or replace function public.set_updated_at()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.normalize_driver_name()
      returns text language plpgsql as $fn$ begin return 'a'; end $fn$;
    create or replace function public.sync_transaction_classification()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.ensure_single_default_branch()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.check_ownership_percentage()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.sync_traffic_infraction_plate()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.trg_deletion_audit_events_immutable()
      returns trigger language plpgsql as $fn$ begin return null; end $fn$;
    create or replace function public.compliance_documents_set_root()
      returns trigger language plpgsql as $fn$ begin return new; end $fn$;
    create or replace function public.service_order_driver_confirmed(p_order_id uuid, p_source text)
      returns boolean language plpgsql as $fn$ begin return true; end $fn$;
    create or replace function public._ap_assert_company_member(p_company_id uuid)
      returns void language plpgsql as $fn$ begin return; end $fn$;
    create or replace function public._ap_post_competence(p_payable_id uuid)
      returns void language plpgsql as $fn$ begin return; end $fn$;
    create or replace function public._assert_service_order_member(p_order_id uuid)
      returns void language plpgsql as $fn$ begin return; end $fn$;
    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end
    $roles$;
  `);
  const helpers = [
    "public._ap_assert_company_member(uuid)",
    "public._ap_post_competence(uuid)",
    "public._assert_service_order_member(uuid)",
  ];
  for (const helper of helpers) {
    await db.exec(`grant execute on function ${helper} to anon, authenticated, service_role, public`);
  }
  for (const name of names) {
    await db.query(
      "insert into public._dev_schema_migrations (filename, applied_at) values ($1, $2)",
      [name, PRIOR_AT],
    );
  }
  if (options.trapInsert) {
    await db.exec(`
      create function public._m093_trap() returns trigger language plpgsql as $fn$
      begin raise exception '093: falha injetada apos permissao'; end $fn$;
      create trigger _m093_trap before insert on public._dev_schema_migrations
      for each row execute function public._m093_trap();
    `);
  }
  return db;
}

async function runEditor(db) {
  let failed = "";
  try {
    await db.exec(editor);
  } catch (error) {
    failed = String(error.message || error);
    try { await db.exec("rollback"); } catch { /* transação já encerrada */ }
  }
  return failed;
}

async function ledgerState(db) {
  const rows = await db.query(
    "select filename, applied_at from public._dev_schema_migrations order by filename",
  );
  const config = await db.query(`
    select proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  `);
  const priv = await db.query(`
    select has_function_privilege('authenticated', 'public._ap_assert_company_member(uuid)', 'execute') as auth_exec
  `);
  return {
    rows: rows.rows,
    searchPath: config.rows[0].proconfig,
    authExec: priv.rows[0].auth_exec,
  };
}

describe("transação do script 093", () => {
  it("registra a 093 e preserva os 92 timestamps", async () => {
    const db = await openLedger();
    const before = await db.query(
      "select filename, applied_at::text as applied_at from public._dev_schema_migrations",
    );
    const failed = await runEditor(db);
    assert.equal(failed, "");
    const state = await ledgerState(db);
    assert.equal(state.rows.length, 93);
    assert.equal(new Set(state.rows.map((row) => row.filename)).size, 93);
    assert.equal(state.rows.some((row) => row.filename === FILE_093), true);
    const after = await db.query(
      "select filename, applied_at::text as applied_at from public._dev_schema_migrations",
    );
    const afterMap = new Map(after.rows.map((row) => [row.filename, row.applied_at]));
    for (const row of before.rows) {
      assert.equal(afterMap.get(row.filename), row.applied_at);
    }
    assert.deepEqual(state.searchPath, ["search_path=public"]);
    assert.equal(state.authExec, false);
    await db.close();
  });

  it("recusa ambiente incorreto sem alterar função nem ledger", async () => {
    const db = await openLedger({ companyName: "Outra empresa" });
    const failed = await runEditor(db);
    assert.match(failed, /ambiente não é o DEV/);
    const state = await ledgerState(db);
    assert.equal(state.rows.length, 92);
    assert.equal(state.searchPath, null);
    assert.equal(state.authExec, true);
    await db.close();
  });

  it("recusa ledger divergente e 093 já registrada", async () => {
    const short = await openLedger({ names: priorNames(91) });
    assert.match(await runEditor(short), /ledger divergente/);
    assert.equal((await ledgerState(short)).searchPath, null);
    await short.close();

    const missing092 = priorNames(92).map((name) => (name === FILE_092 ? "091_pre_pilot_security.sql" : name));
    const no092 = await openLedger({ names: missing092 });
    assert.match(await runEditor(no092), /092 precisa já estar registrada/);
    assert.equal((await ledgerState(no092)).rows.length, 92);
    await no092.close();

    const again = await openLedger({ names: [...priorNames(92), FILE_093] });
    assert.match(await runEditor(again), /já está registrada/);
    assert.equal((await ledgerState(again)).searchPath, null);
    assert.equal((await ledgerState(again)).authExec, true);
    await again.close();
  });

  it("desfaz a revogação quando a falha ocorre depois da permissão", async () => {
    const db = await openLedger({ trapInsert: true });
    const failed = await runEditor(db);
    assert.match(failed, /falha injetada apos permissao/);
    const state = await ledgerState(db);
    assert.equal(state.rows.some((row) => row.filename === FILE_093), false);
    assert.equal(state.rows.length, 92);
    assert.equal(state.searchPath, null);
    assert.equal(state.authExec, true);
    const preserved = await db.query(
      "select count(*)::int as n from public._dev_schema_migrations where applied_at = $1::timestamptz",
      [PRIOR_AT],
    );
    assert.equal(preserved.rows[0].n, 92);
    await db.close();
  });
});

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
    assert.match(editor, /092_chart_seed_finance_guard\.sql/);
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

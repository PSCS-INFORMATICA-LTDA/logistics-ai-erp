import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const FINANCE = "22222222-2222-4222-8222-222222222222";
const OPERATIONAL = "33333333-3333-4333-8333-333333333333";
const LINKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function psql(database, sql) {
  const result = spawnSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-X", "-q"],
    { input: sql, encoding: "utf8" },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function recreate(database) {
  psql("postgres", `drop database if exists ${database};`);
  const created = psql("postgres", `create database ${database};`);
  if (!created.ok) throw new Error(created.output);
}

function assert(condition, message, output) {
  if (!condition) throw new Error(`${message}\n${output ?? ""}`);
}

function identity() {
  recreate("logistics_identity_local");
  const setup = psql("logistics_identity_local", `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant anon, authenticated, service_role to postgres;
    create schema if not exists auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.profiles (
      id uuid primary key,
      full_name text,
      email text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      pscs_one_user_id uuid
    );
    create or replace function public.set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end $$;
    create trigger trg_profiles_updated_at before update on public.profiles
      for each row execute function public.set_updated_at();
    alter table public.profiles enable row level security;
    create policy profiles_select_own on public.profiles
      for select to authenticated
      using (id = auth.uid());
    create policy profiles_update_own on public.profiles
      for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
    grant select, update, insert on table public.profiles to authenticated;
    grant update, insert on table public.profiles to public, anon;
    create table public.companies (id uuid primary key);
    insert into public.companies (id) values
      ('92c4c90d-6856-4c41-a9a1-9eba6a7468f6'),
      ('bcd3c6c9-0e4a-4356-addd-4af925725576');
    create table public._dev_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null
    );
    insert into public._dev_schema_migrations (filename, applied_at)
    select 'm' || lpad(i::text, 3, '0') || '.sql', timestamptz '2026-11-01 00:00:00+00' + make_interval(mins => i)
    from generate_series(1, 93) as i;
    insert into public.profiles (id, full_name, email, pscs_one_user_id) values
      ('${ADMIN}', 'Admin', 'admin@example.com', null),
      ('${FINANCE}', 'Financeiro', 'fin@example.com', null),
      ('${OPERATIONAL}', 'Operacional', 'op@example.com', null);
    select has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE') as before_fix;
  `);
  assert(setup.ok && setup.output.includes("t"), "privilégio inicial deveria ser verdadeiro", setup.output);

  const guard = psql("logistics_identity_local", readFileSync(new URL("../../supabase/pending/094_protect_pscs_one_user_id.sql", import.meta.url), "utf8"));
  assert(guard.ok, "aplicação local da trava", guard.output);

  const closed = psql("logistics_identity_local", `
    select has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE') as auth_link,
           has_column_privilege('anon', 'public.profiles', 'pscs_one_user_id', 'UPDATE') as anon_link,
           has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as auth_name,
           has_column_privilege('service_role', 'public.profiles', 'pscs_one_user_id', 'UPDATE') as sso_link;
  `);
  assert(closed.ok, "consulta de privilégio", closed.output);
  assert(closed.output.includes("f") && closed.output.includes("t"), "privilégio depois da trava", closed.output);

  for (const [label, id] of [["admin", ADMIN], ["financeiro", FINANCE], ["operacional", OPERATIONAL]]) {
    const denied = psql("logistics_identity_local", `
      begin;
      select set_config('request.jwt.claim.sub', '${id}', true);
      set local role authenticated;
      update public.profiles set pscs_one_user_id = '${LINKED}' where id = '${id}';
      commit;
    `);
    assert(!denied.ok, `${label} não pode alterar o vínculo`, denied.output);
    const renamed = psql("logistics_identity_local", `
      begin;
      select set_config('request.jwt.claim.sub', '${id}', true);
      set local role authenticated;
      update public.profiles set full_name = '${label} editado' where id = '${id}';
      commit;
      select full_name, pscs_one_user_id::text from public.profiles where id = '${id}';
    `);
    assert(renamed.ok && renamed.output.includes(`${label} editado`), `${label} edita o nome`, renamed.output);
    assert(renamed.output.includes("|"), `${label} preserva o vínculo`, renamed.output);
  }

  const cross = psql("logistics_identity_local", `
    begin;
    select set_config('request.jwt.claim.sub', '${ADMIN}', true);
    set local role authenticated;
    update public.profiles set full_name = 'invadido' where id = '${FINANCE}';
    commit;
    select full_name from public.profiles where id = '${FINANCE}';
  `);
  assert(cross.ok && cross.output.includes("financeiro editado"), "admin não reescreve outro perfil", cross.output);

  const anon = psql("logistics_identity_local", `
    begin;
    set local role anon;
    update public.profiles set full_name = 'anon' where id = '${ADMIN}';
    commit;
  `);
  assert(!anon.ok, "anon não atualiza perfil", anon.output);

  const reopened = psql("logistics_identity_local", `
    grant update on table public.profiles to authenticated;
    begin;
    select set_config('request.jwt.claim.sub', '${ADMIN}', true);
    set local role authenticated;
    update public.profiles set pscs_one_user_id = '${LINKED}' where id = '${ADMIN}';
    commit;
  `);
  assert(!reopened.ok && reopened.output.includes("pscs_one_user_id_immutable"), "gatilho segura um grant posterior", reopened.output);
  psql("logistics_identity_local", "revoke update on table public.profiles from authenticated; grant update (full_name, email) on table public.profiles to authenticated;");

  const sso = psql("logistics_identity_local", `
    begin;
    set local role service_role;
    update public.profiles set pscs_one_user_id = '${LINKED}' where id = '${ADMIN}';
    commit;
    select pscs_one_user_id::text from public.profiles where id = '${ADMIN}';
  `);
  assert(sso.ok && sso.output.includes(LINKED), "SSO grava o vínculo", sso.output);

  const inserted = psql("logistics_identity_local", `
    begin;
    select set_config('request.jwt.claim.sub', '${ADMIN}', true);
    set local role authenticated;
    insert into public.profiles (id, full_name, email, pscs_one_user_id)
    values ('44444444-4444-4444-8444-444444444444', 'Novo', 'novo@example.com', '${LINKED}');
    commit;
  `);
  assert(!inserted.ok, "authenticated não insere o vínculo", inserted.output);
  const forced = psql("logistics_identity_local", `
    grant insert (id, full_name, email, pscs_one_user_id) on table public.profiles to authenticated;
    begin;
    select set_config('request.jwt.claim.sub', '${ADMIN}', true);
    set local role authenticated;
    insert into public.profiles (id, full_name, email, pscs_one_user_id)
    values ('44444444-4444-4444-8444-444444444444', 'Novo', 'novo@example.com', '${LINKED}');
    commit;
  `);
  assert(!forced.ok && forced.output.includes("pscs_one_user_id_immutable"), "gatilho segura o insert do vínculo", forced.output);
  const ssoInsert = psql("logistics_identity_local", `
    begin;
    set local role service_role;
    insert into public.profiles (id, full_name, email, pscs_one_user_id)
    values ('55555555-5555-4555-8555-555555555555', 'SSO', 'sso@example.com', '${LINKED}');
    commit;
    select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555';
  `);
  assert(ssoInsert.ok && ssoInsert.output.includes("1"), "SSO insere o vínculo", ssoInsert.output);
  const ledger = psql("logistics_identity_local", `
    select count(*) as rows,
           (select applied_at from public._dev_schema_migrations where filename = 'm001.sql') as first_at
    from public._dev_schema_migrations;
  `);
  assert(ledger.ok && ledger.output.includes("94") && ledger.output.includes("2026-11-01 00:01:00"), "ledger 94 preserva o histórico", ledger.output);

  const rolled = psql("logistics_identity_local", readFileSync(new URL("../../supabase/rollbacks/094_after_commit.sql", import.meta.url), "utf8"));
  assert(rolled.ok, "rollback pós-commit da 094", rolled.output);
  const after = psql("logistics_identity_local", `
    select count(*) as rows,
           has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE') as reopened,
           (select applied_at from public._dev_schema_migrations where filename = 'm001.sql') as first_at
    from public._dev_schema_migrations;
  `);
  assert(after.ok && after.output.includes("93") && after.output.includes("t") && after.output.includes("2026-11-01 00:01:00"), "rollback volta a 93", after.output);
  console.log("identity local: admin, financeiro, operacional e anon negados; nome editável; SSO gravou e inseriu; rollback 94→93");
}

function rollback093() {
  recreate("logistics_093_local");
  const fixture = psql("logistics_093_local", `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create table public.companies (id uuid primary key);
    insert into public.companies (id) values
      ('92c4c90d-6856-4c41-a9a1-9eba6a7468f6'),
      ('bcd3c6c9-0e4a-4356-addd-4af925725576');
    create table public._dev_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null
    );
    insert into public._dev_schema_migrations (filename, applied_at)
    select 'm' || lpad(i::text, 3, '0') || '.sql', timestamptz '2026-11-01 00:00:00+00' + make_interval(mins => i)
    from generate_series(1, 92) as i;
    insert into public._dev_schema_migrations (filename, applied_at)
    values ('093_residual_search_path_and_helpers.sql', timestamptz '2026-11-24 18:00:00+00');
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin return new; end $$;
    create function public.normalize_driver_name() returns text language sql as $$ select ''::text $$;
    create function public.sync_transaction_classification() returns void language sql as $$ select null::void $$;
    create function public.ensure_single_default_branch() returns void language sql as $$ select null::void $$;
    create function public.check_ownership_percentage() returns void language sql as $$ select null::void $$;
    create function public.sync_traffic_infraction_plate() returns void language sql as $$ select null::void $$;
    create function public.trg_deletion_audit_events_immutable() returns trigger language plpgsql as $$ begin return new; end $$;
    create function public.compliance_documents_set_root() returns void language sql as $$ select null::void $$;
    create function public.service_order_driver_confirmed(uuid, text) returns void language sql as $$ select null::void $$;
    create function public._ap_assert_company_member(uuid) returns void language sql as $$ select null::void $$;
    create function public._ap_post_competence(uuid) returns void language sql as $$ select null::void $$;
    create function public._assert_service_order_member(uuid) returns void language sql as $$ select null::void $$;
    alter function public.set_updated_at() set search_path = public;
    alter function public.normalize_driver_name() set search_path = public;
    alter function public.sync_transaction_classification() set search_path = public;
    alter function public.ensure_single_default_branch() set search_path = public;
    alter function public.check_ownership_percentage() set search_path = public;
    alter function public.sync_traffic_infraction_plate() set search_path = public;
    alter function public.trg_deletion_audit_events_immutable() set search_path = public;
    alter function public.compliance_documents_set_root() set search_path = public;
    alter function public.service_order_driver_confirmed(uuid, text) set search_path = public;
    revoke all on function public._ap_assert_company_member(uuid) from public, anon, authenticated;
    revoke all on function public._ap_post_competence(uuid) from public, anon, authenticated;
    revoke all on function public._assert_service_order_member(uuid) from public, anon, authenticated;
  `);
  assert(fixture.ok, "fixture da 093", fixture.output);

  psql("postgres", "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'logistics_093_negative' and pid <> pg_backend_pid();");
  psql("postgres", "drop database if exists logistics_093_negative;");
  const negativeDb = psql("postgres", "create database logistics_093_negative template logistics_093_local;");
  assert(negativeDb.ok, "cópia negativa da 093", negativeDb.output);
  const trigger = psql("logistics_093_negative", `
    create function public.bump_history() returns trigger language plpgsql as $$
    begin
      update public._dev_schema_migrations
      set applied_at = applied_at + interval '1 second'
      where filename = 'm050.sql';
      return old;
    end $$;
    create trigger bump_history before delete on public._dev_schema_migrations
    for each row execute function public.bump_history();
  `);
  assert(trigger.ok, "gatilho negativo", trigger.output);
  const negative = psql(
    "logistics_093_negative",
    readFileSync(new URL("../../supabase/rollbacks/093_after_commit.sql", import.meta.url), "utf8"),
  );
  assert(!negative.ok && negative.output.includes("rollback_093_historical_row_changed"), "linha histórica alterada é recusada", negative.output);
  const preserved = psql("logistics_093_negative", "select count(*) from public._dev_schema_migrations;");
  assert(preserved.ok && preserved.output.includes("93"), "rollback negativo não commitou", preserved.output);

  const positive = psql(
    "logistics_093_local",
    readFileSync(new URL("../../supabase/rollbacks/093_after_commit.sql", import.meta.url), "utf8"),
  );
  assert(positive.ok, "rollback positivo da 093", positive.output);
  const rows = psql("logistics_093_local", `
    select count(*) as rows,
           (select applied_at from public._dev_schema_migrations where filename = 'm001.sql') as first_at
    from public._dev_schema_migrations;
  `);
  assert(rows.ok && rows.output.includes("92") && rows.output.includes("2026-11-01 00:01:00"), "92 linhas e applied_at preservado", rows.output);
  console.log("093 local: comparação individual recusou applied_at alterado e o caminho limpo ficou em 92");
}

identity();
rollback093();

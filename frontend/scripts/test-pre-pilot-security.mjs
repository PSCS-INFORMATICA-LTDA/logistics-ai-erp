import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const migrationPath = path.join(root, "supabase/migrations/091_pre_pilot_security.sql");
const editorPath = path.join(root, "frontend/scripts/apply-091-sql-editor.sql");
const rollbackPath = path.join(root, "supabase/rollbacks/091_pre_pilot_security.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const editor = fs.readFileSync(editorPath, "utf8");
const rollback = fs.readFileSync(rollbackPath, "utf8");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const MEMBER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ADMIN_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const MEMBER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const PARKING = "cccccccc-cccc-cccc-cccc-ccccccccccc1";
const PAYABLE = "dddddddd-dddd-dddd-dddd-ddddddddddd1";
const FT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1";
const SENTINEL = "00000000-0000-0000-0000-000000000099";
const TOKEN = "a".repeat(32);

function claims(sub, role) {
  return JSON.stringify({ sub, role }).replaceAll("'", "''");
}

describe("arquivos da 091", () => {
  it("não usa cifrão duplo solto e o editor é uma transação", () => {
    assert.equal(migration.includes("$$"), false);
    assert.equal(editor.includes("$$"), false);
    assert.equal(rollback.includes("$$"), false);
    assert.match(editor, /^-- SQL Editor/);
    assert.match(editor, /\nbegin;\n/);
    assert.match(editor, /\ncommit;\s*$/);
    assert.ok(editor.includes(migration.trim()));
    assert.match(migration, /auth_user_has_company\(p_company_id\)/);
    assert.match(migration, /bloqueada para usuários da aplicação/);
    assert.doesNotMatch(migration, /revoke all on function public\.get_public_proposal/i);
    assert.doesNotMatch(migration, /revoke all on function public\.approve_accounts_payable/i);
    assert.doesNotMatch(migration, /revoke all on function public\.reverse_accounts_payable_postings/i);
    assert.doesNotMatch(migration, /revoke all on function public\.post_parking_revenue/i);
    assert.doesNotMatch(migration, /revoke all on function public\.post_car_wash_revenue/i);
    assert.match(
      fs.readFileSync(path.join(root, "frontend/scripts/seed-dev-ap-multicompany.mjs"), "utf8"),
      /seed_chart_of_accounts[\s\S]*set_config\('request\.jwt\.claim\.sub'/
    );
  });
});

async function loadDb() {
  const spec = "/tmp/pglite-090/node_modules/@electric-sql/pglite/dist/index.js";
  const { PGlite } = await import(spec);
  return new PGlite();
}

function sqlText(value) {
  return `'${value}'`;
}

async function failIf(db, sql, needle) {
  try {
    await db.exec(sql);
  } catch (error) {
    const message = String(error?.message || error);
    try {
      await db.exec("rollback");
    } catch {
      /* a sessão já voltou ao estado ocioso */
    }
    assert.match(message, needle);
    return;
  }
  throw new Error(`esperava erro ${needle}: ${sql.slice(0, 120)}`);
}

async function setSession(db, role, sub, jwtRole) {
  await db.exec("reset role");
  await db.exec(
    `select set_config('request.jwt.claim.sub', ${sub ? sqlText(sub) : "''"}, false)`
  );
  await db.exec(
    `select set_config('request.jwt.claim.role', ${jwtRole ? sqlText(jwtRole) : "''"}, false)`
  );
  await db.exec(
    `select set_config('request.jwt.claims', ${
      sub ? sqlText(claims(sub, jwtRole || "authenticated")) : "''"
    }, false)`
  );
  if (role) await db.exec(`set role ${role}`);
}

const fixture = `
create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable as $uid$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$uid$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant anon, authenticated, service_role, supabase_auth_admin to current_user;

create table public.companies (id uuid primary key, name text);
create table public.company_members (
  company_id uuid,
  user_id uuid,
  role text,
  primary key (company_id, user_id)
);
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  classification text,
  transaction_type text,
  status text,
  unique (company_id, name)
);
create table public.freight_rate_tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  code text,
  modality text,
  vehicle_category text,
  rate_per_km numeric,
  round_trip_from_km numeric,
  valid_from date,
  status text,
  notes text
);
create table public.profiles (
  id uuid primary key,
  full_name text,
  email text
);
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);
create table public.parking_entries (
  id uuid primary key,
  company_id uuid,
  public_ticket_token text
);
create table public.company_document_sequences (
  company_id uuid,
  document_type text,
  prefix text,
  last_number integer,
  padding integer,
  updated_at timestamptz,
  primary key (company_id, document_type)
);
create table public.financial_transactions (
  id uuid primary key,
  company_id uuid,
  approval_status text,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_by uuid,
  updated_at timestamptz
);
create table public.accounts_payable (
  id uuid primary key,
  company_id uuid,
  chart_of_account_id uuid,
  deleted_at timestamptz
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  plate text,
  vehicle_category text,
  axle_count integer,
  model text,
  year integer,
  status text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  code text,
  service_type text,
  service_date date,
  status text,
  vehicle_id uuid,
  plate text,
  brand text,
  model text,
  year integer,
  vehicle_type text,
  client_name text,
  phone text,
  service_categories text[],
  service_name text,
  service_amount numeric,
  freight_origin_address text,
  freight_destination_address text,
  freight_distance_km numeric,
  freight_toll_amount numeric,
  freight_toll_count integer,
  freight_toll_detail jsonb,
  freight_antt_cargo_type integer,
  freight_antt_axles integer,
  freight_antt_composicao_veicular boolean,
  freight_antt_alto_desempenho boolean,
  freight_antt_retorno_vazio boolean,
  freight_antt_minimum numeric,
  freight_antt_detail jsonb,
  freight_suggested_total numeric,
  freight_agreed_amount numeric,
  freight_per_diem_charge_to text,
  notes text
);
create table public._dev_schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

insert into public.companies values ('${A}', 'Empresa A'), ('${B}', 'Empresa B');
insert into public.company_members values
  ('${A}', '${MEMBER_A}', 'financeiro'),
  ('${A}', '${ADMIN_A}', 'admin'),
  ('${B}', '${MEMBER_B}', 'financeiro');
insert into public.parking_entries values ('${PARKING}', '${A}', null);
insert into public.financial_transactions values
  ('${FT}', '${A}', 'approved', null, null, null, null, null);
insert into public.accounts_payable values ('${PAYABLE}', '${A}', null, null);
insert into public.vehicles (company_id, plate, vehicle_category, axle_count, model, year, status)
values ('${A}', 'ABC1D23', 'Caminhao', 5, 'Demo', 2024, 'Ativo');

create or replace function public.auth_user_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select company_id from public.company_members where user_id = auth.uid()
$fn$;
create or replace function public.auth_user_has_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.company_members
    where user_id = auth.uid() and company_id = p_company_id
  )
$fn$;
create or replace function public.auth_user_is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.company_members
    where user_id = auth.uid() and company_id = p_company_id and role = 'admin'
  )
$fn$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end
$fn$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public._ap_can_approve(p_company_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  return public.auth_user_is_company_admin(p_company_id);
end
$fn$;
create or replace function public._ap_user_display_name()
returns text language sql security definer set search_path = public as $fn$
  select 'nome'
$fn$;
create or replace function public._ap_validate_ready_for_approval(p_payable_id uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
begin
  return p_payable_id;
end
$fn$;
create or replace function public._ap_assert_row_company_consistency()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.company_id = '${SENTINEL}'::uuid then
    raise exception 'trigger-disparou';
  end if;
  return new;
end
$fn$;
create trigger trg_ap_company_consistency
  before insert on public.accounts_payable
  for each row execute function public._ap_assert_row_company_consistency();
create or replace function public._ap_assert_allocation_company_consistency()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  return new;
end
$fn$;

create or replace function public.next_company_document_number(
  p_company_id uuid, p_document_type text, p_prefix text, p_padding integer
) returns text language plpgsql security definer set search_path = public as $fn$
declare v_next integer;
begin
  if not public.auth_user_has_company(p_company_id) then
    raise exception 'Sem acesso à empresa' using errcode = '42501';
  end if;
  insert into public.company_document_sequences
    (company_id, document_type, prefix, last_number, padding)
  values (p_company_id, p_document_type, coalesce(p_prefix, 'AP'), 0, coalesce(p_padding, 8))
  on conflict (company_id, document_type) do nothing;
  update public.company_document_sequences
  set last_number = last_number + 1
  where company_id = p_company_id and document_type = p_document_type
  returning last_number into v_next;
  return coalesce(p_prefix, 'AP') || '-' || lpad(v_next::text, coalesce(p_padding, 8), '0');
end
$fn$;

create or replace function public.restore_deleted_from_audit(p_event_id uuid, p_restoration_reason text)
returns uuid language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  return p_event_id;
end
$fn$;
create or replace function public.restore_soft_deleted_from_audit(p_event_id uuid, p_restoration_reason text)
returns uuid language sql security definer set search_path = public as $fn$
  select public.restore_deleted_from_audit(p_event_id, p_restoration_reason)
$fn$;

create or replace function public.ensure_patio_ticket_token(p_source text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_token text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  select company_id, public_ticket_token into v_company, v_token
  from public.parking_entries where id = p_id;
  if not found then
    raise exception 'Ordem de estacionamento não encontrada';
  end if;
  if not exists (
    select 1 from public.company_members
    where company_id = v_company and user_id = auth.uid()
  ) then
    raise exception 'Sem acesso à empresa' using errcode = '42501';
  end if;
  if v_token is null or length(v_token) < 32 then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.parking_entries set public_ticket_token = v_token where id = p_id;
  end if;
  return v_token;
end
$fn$;

create or replace function public.get_public_proposal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if p_token is null or length(trim(p_token)) < 32 then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true);
end
$fn$;
create or replace function public.get_public_driver_assignment(p_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select public.get_public_proposal(p_token)
$fn$;
create or replace function public.get_public_patio_ticket(p_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select public.get_public_proposal(p_token)
$fn$;
create or replace function public.respond_to_proposal(p_token text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if p_token is null or length(trim(p_token)) < 32 then
    raise exception 'Token inválido';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'Ação inválida';
  end if;
  return jsonb_build_object('ok', true);
end
$fn$;
create or replace function public.respond_to_driver_assignment(p_token text, p_action text)
returns jsonb language sql security definer set search_path = public as $fn$
  select public.respond_to_proposal(p_token, p_action)
$fn$;

create or replace function public.guard_financial_transaction_approval_status()
returns trigger language plpgsql security invoker set search_path = public as $fn$
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;
  if auth.uid() is null or not public.auth_user_is_company_admin(old.company_id) then
    raise exception 'Somente administrador da empresa pode alterar o status de aprovação.'
      using errcode = '42501';
  end if;
  return new;
end
$fn$;
create trigger trg_financial_transactions_approval_status
  before update on public.financial_transactions
  for each row execute function public.guard_financial_transaction_approval_status();

create or replace function public.reverse_accounts_payable_postings(p_payable_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_company uuid;
begin
  select company_id into v_company from public.accounts_payable where id = p_payable_id;
  if not public._ap_can_approve(v_company) then
    raise exception 'Sem permissão para estornar postagens' using errcode = '42501';
  end if;
  update public.financial_transactions
  set approval_status = 'cancelled'
  where company_id = v_company;
  return jsonb_build_object('ok', true);
end
$fn$;

grant select, update on public.financial_transactions to authenticated;
grant select, insert on public.accounts_payable to authenticated;
grant select on public.freight_rate_tables to anon, authenticated;
alter table public.freight_rate_tables enable row level security;
create policy freight_rate_tables_all on public.freight_rate_tables
  for select using (public.auth_user_has_company(company_id));
grant all on public._dev_schema_migrations to authenticated, service_role;
grant insert on auth.users to supabase_auth_admin;
grant insert on public.profiles to supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.seed_chart_of_accounts(p_company_id uuid)
returns integer language sql security definer set search_path = public as $fn$ select 0 $fn$;
create or replace function public.seed_freight_rate_defaults(p_company_id uuid)
returns void language sql security definer set search_path = public as $fn$ select $fn$;
create or replace function public.seed_demo_freight_os(p_company_id uuid)
returns table (os_id uuid, os_code text, distance_km numeric, agreed_amount numeric)
language sql security definer set search_path = public as $fn$
  select null::uuid, null::text, null::numeric, null::numeric where false
$fn$;
`;

describe("migration 091 no Postgres local", () => {
  it("isola empresas e preserva frete, páginas públicas, pátio, aprovação e estorno", async () => {
    const db = await loadDb();
    const who = await db.query("select current_user as u");
    assert.equal(who.rows[0].u, "postgres");
    await db.exec(fixture);
    await db.exec(`
      grant execute on function public.seed_chart_of_accounts(uuid) to public;
    `).catch(() => {});
    await db.exec(migration);

    const lines = [];
    const note = (label) => lines.push(label);

    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    const seeded = await db.query(
      `select public.seed_freight_rate_defaults('${A}'::uuid)`
    );
    assert.equal(seeded.rows.length, 1);
    const ratesA = await db.query(
      `select count(*)::int as n from public.freight_rate_tables where company_id = '${A}'`
    );
    assert.equal(ratesA.rows[0].n, 5);
    await db.query(`select public.seed_freight_rate_defaults('${A}'::uuid)`);
    const ratesAgain = await db.query(
      `select count(*)::int as n from public.freight_rate_tables where company_id = '${A}'`
    );
    assert.equal(ratesAgain.rows[0].n, 5);
    await failIf(
      db,
      `select public.seed_freight_rate_defaults('${B}'::uuid)`,
      /Sem permissão para inicializar dados desta empresa/
    );
    await setSession(db, null, null, null);
    const ratesB = await db.query(
      `select count(*)::int as n from public.freight_rate_tables where company_id = '${B}'`
    );
    assert.equal(ratesB.rows[0].n, 0);
    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    const chart = await db.query(
      `select public.seed_chart_of_accounts('${A}'::uuid) as n`
    );
    assert.ok(Number(chart.rows[0].n) > 0);
    await failIf(
      db,
      `select public.seed_chart_of_accounts('${B}'::uuid)`,
      /Sem permissão para inicializar dados desta empresa/
    );
    await setSession(db, null, null, null);
    const chartB = await db.query(
      `select count(*)::int as n from public.chart_of_accounts where company_id = '${B}'`
    );
    assert.equal(chartB.rows[0].n, 0);
    note("frete e plano: membro da A grava A e não grava B");

    await setSession(db, "anon", null, "anon");
    await failIf(
      db,
      `select public.seed_freight_rate_defaults('${A}'::uuid)`,
      /permission denied for function seed_freight_rate_defaults/
    );
    await failIf(
      db,
      `select public.seed_chart_of_accounts('${A}'::uuid)`,
      /permission denied for function seed_chart_of_accounts/
    );
    await failIf(
      db,
      `select public.seed_demo_freight_os('${A}'::uuid)`,
      /permission denied for function seed_demo_freight_os/
    );
    const proposal = await db.query(
      `select public.get_public_proposal('curto') as short, public.get_public_proposal('${TOKEN}') as long`
    );
    assert.equal(proposal.rows[0].short.found, false);
    assert.equal(proposal.rows[0].long.found, true);
    const driver = await db.query(
      `select public.get_public_driver_assignment('${TOKEN}') as row`
    );
    assert.equal(driver.rows[0].row.found, true);
    const patio = await db.query(
      `select public.get_public_patio_ticket('x') as row`
    );
    assert.equal(patio.rows[0].row.found, false);
    const accepted = await db.query(
      `select public.respond_to_proposal('${TOKEN}', 'accept') as row`
    );
    assert.equal(accepted.rows[0].row.ok, true);
    const driverReply = await db.query(
      `select public.respond_to_driver_assignment('${TOKEN}', 'reject') as row`
    );
    assert.equal(driverReply.rows[0].row.ok, true);
    await failIf(
      db,
      `select public.respond_to_proposal('curto', 'accept')`,
      /Token inválido/
    );
    await failIf(db, "select public.handle_new_user()", /permission denied/);
    await failIf(
      db,
      `select public._ap_validate_ready_for_approval('${PAYABLE}'::uuid)`,
      /permission denied/
    );
    await failIf(db, "select count(*) from public.freight_rate_tables", /permission denied for function auth_user_has_company/);
    note("anon: seeds bloqueadas, páginas públicas abertas, tabela de frete não vaza");

    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    const numberA = await db.query(
      `select public.next_company_document_number('${A}'::uuid, 'accounts_payable', 'AP', 8) as n`
    );
    assert.equal(numberA.rows[0].n, "AP-00000001");
    await failIf(
      db,
      `select public.next_company_document_number('${B}'::uuid, 'accounts_payable', 'AP', 8)`,
      /Sem acesso à empresa/
    );
    const token = await db.query(
      `select public.ensure_patio_ticket_token('parking', '${PARKING}'::uuid) as t`
    );
    assert.ok(String(token.rows[0].t).length >= 32);
    await setSession(db, "authenticated", MEMBER_B, "authenticated");
    await failIf(
      db,
      `select public.ensure_patio_ticket_token('parking', '${PARKING}'::uuid)`,
      /Sem acesso à empresa/
    );
    await setSession(db, "anon", null, "anon");
    await failIf(
      db,
      `select public.ensure_patio_ticket_token('parking', '${PARKING}'::uuid)`,
      /permission denied for function ensure_patio_ticket_token/
    );
    note("documento e ticket de pátio seguem a empresa do usuário");

    await setSession(db, "authenticated", ADMIN_A, "authenticated");
    await db.exec(
      `update public.financial_transactions set approval_status = 'cancelled' where id = '${FT}'`
    );
    const approved = await db.query(
      `select approval_status from public.financial_transactions where id = '${FT}'`
    );
    assert.equal(approved.rows[0].approval_status, "cancelled");
    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    await failIf(
      db,
      `update public.financial_transactions set approval_status = 'approved' where id = '${FT}'`,
      /Somente administrador/
    );
    await failIf(
      db,
      `select public._ap_can_approve('${A}'::uuid)`,
      /permission denied for function _ap_can_approve/
    );
    await setSession(db, "authenticated", ADMIN_A, "authenticated");
    const reversed = await db.query(
      `select public.reverse_accounts_payable_postings('${PAYABLE}'::uuid, 'teste') as r`
    );
    assert.equal(reversed.rows[0].r.ok, true);
    const afterReverse = await db.query(
      `select approval_status from public.financial_transactions where id = '${FT}'`
    );
    assert.equal(afterReverse.rows[0].approval_status, "cancelled");
    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    await failIf(
      db,
      `select public.reverse_accounts_payable_postings('${PAYABLE}'::uuid, 'teste')`,
      /Sem permissão para estornar postagens/
    );
    await failIf(
      db,
      `insert into public.accounts_payable (id, company_id) values (gen_random_uuid(), '${SENTINEL}'::uuid)`,
      /trigger-disparou/
    );
    note("aprovação, estorno e trigger interna continuam depois do revoke");

    await setSession(db, "supabase_auth_admin", null, null);
    await db.exec(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ('${MEMBER_B}', 'membro.b@example.com', '{"full_name":"Membro B"}'::jsonb)`
    );
    await setSession(db, null, null, null);
    const profile = await db.query(
      `select full_name from public.profiles where id = '${MEMBER_B}'`
    );
    assert.equal(profile.rows[0].full_name, "Membro B");
    note("cadastro de usuário dispara handle_new_user sem EXECUTE para anon");

    await setSession(db, null, null, null);
    await db.exec(
      `insert into public._dev_schema_migrations (filename) values ('091_pre_pilot_security.sql')`
    );
    await setSession(db, "authenticated", MEMBER_A, "authenticated");
    await failIf(
      db,
      `insert into public._dev_schema_migrations (filename) values ('forjado.sql')`,
      /permission denied for table _dev_schema_migrations/
    );
    await setSession(db, "service_role", null, "service_role");
    await db.exec(
      `insert into public._dev_schema_migrations (filename) values ('residual-service-role.sql')`
    );
    note("runner postgres grava o controle; authenticated não; service_role permanece");

    await setSession(db, null, null, null);
    const demo = await db.query(
      `select os_code from public.seed_demo_freight_os('${A}'::uuid)`
    );
    assert.match(demo.rows[0].os_code, /^OS/);
    await db.exec("grant execute on function public.seed_demo_freight_os(uuid) to authenticated");
    await setSession(db, "authenticated", ADMIN_A, "authenticated");
    await failIf(
      db,
      `select * from public.seed_demo_freight_os('${A}'::uuid)`,
      /bloqueada para usuários da aplicação/
    );
    await setSession(db, null, null, null);
    await db.exec("revoke all on function public.seed_demo_freight_os(uuid) from authenticated");
    const orders = await db.query("select count(*)::int as n from public.service_orders");
    assert.equal(orders.rows[0].n, 1);
    note("demo só pelo postgres direto");

    await setSession(db, null, null, null);
    const scripted = await db.query(
      `select public.seed_chart_of_accounts('${B}'::uuid) as n
         from (
           select set_config('request.jwt.claim.sub', '${MEMBER_B}', true),
                  set_config('request.jwt.claims', '${claims(MEMBER_B, "authenticated")}', true)
         ) cfg`
    );
    assert.ok(Number(scripted.rows[0].n) > 0);
    note("script multiempresa semeia com o jwt do administrador da empresa");

    const logPath = "/opt/cursor/artifacts/091-pglite-tests.log";
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, lines.map((line) => `PASS ${line}`).join("\n") + "\n");
    await db.close();
  });

  it("o script do editor recusa sessão que não é postgres e confirma os privilégios", async () => {
    const db = await loadDb();
    await db.exec(fixture);
    await db.exec(`
      create or replace function public.approve_accounts_payable(p_payable_id uuid, p_review_note text)
      returns jsonb language sql security definer set search_path = public as $fn$ select '{"ok":true}'::jsonb $fn$;
      create or replace function public.post_parking_revenue(p_entry_id uuid)
      returns jsonb language sql security definer set search_path = public as $fn$ select '{"ok":true}'::jsonb $fn$;
      create or replace function public.post_car_wash_revenue(p_service_id uuid)
      returns jsonb language sql security definer set search_path = public as $fn$ select '{"ok":true}'::jsonb $fn$;
      create or replace function public.delete_financial_transaction_audited(
        p_id uuid, p_reason text, p_reason_code text, p_screen_key text
      ) returns jsonb language sql security definer set search_path = public as $fn$ select '{"ok":true}'::jsonb $fn$;
      create or replace function public.correct_financial_transaction_audited(
        p_id uuid, p_reason text, p_patch jsonb, p_reason_code text, p_screen_key text
      ) returns jsonb language sql security definer set search_path = public as $fn$ select '{"ok":true}'::jsonb $fn$;
      revoke all on function public.approve_accounts_payable(uuid, text) from public, anon;
      revoke all on function public.reverse_accounts_payable_postings(uuid, text) from public, anon;
      revoke all on function public.post_parking_revenue(uuid) from public, anon;
      revoke all on function public.post_car_wash_revenue(uuid) from public, anon;
      revoke all on function public.delete_financial_transaction_audited(uuid, text, text, text) from public, anon;
      revoke all on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) from public, anon, service_role;
      grant execute on function public.approve_accounts_payable(uuid, text) to authenticated, service_role;
      grant execute on function public.reverse_accounts_payable_postings(uuid, text) to authenticated, service_role;
      grant execute on function public.post_parking_revenue(uuid) to authenticated, service_role;
      grant execute on function public.post_car_wash_revenue(uuid) to authenticated, service_role;
      grant execute on function public.delete_financial_transaction_audited(uuid, text, text, text) to authenticated, service_role;
      grant execute on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) to authenticated;
    `);
    await db.exec("set role authenticated");
    await failIf(db, editor, /aplicar como postgres/);
    await db.exec("reset role");
    await db.exec(editor);
    const anonSeed = await db.query(
      `select has_function_privilege('anon', 'public.seed_chart_of_accounts(uuid)', 'execute') as v`
    );
    assert.equal(anonSeed.rows[0].v, false);
    const publicSeed = await db.query(
      `select has_function_privilege('public', 'public.seed_freight_rate_defaults(uuid)', 'execute') as v`
    );
    assert.equal(publicSeed.rows[0].v, false);
    const authFreight = await db.query(
      `select has_function_privilege('authenticated', 'public.seed_freight_rate_defaults(uuid)', 'execute') as v`
    );
    assert.equal(authFreight.rows[0].v, true);
    const anonProposal = await db.query(
      `select has_function_privilege('anon', 'public.get_public_proposal(text)', 'execute') as v`
    );
    assert.equal(anonProposal.rows[0].v, true);
    const table = await db.query(
      `select has_table_privilege('authenticated', 'public._dev_schema_migrations', 'insert') as ins,
              c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = '_dev_schema_migrations'`
    );
    assert.equal(table.rows[0].ins, false);
    assert.equal(table.rows[0].rls, true);
    await db.close();
  });

  it("o rollback devolve o execute anterior", async () => {
    const db = await loadDb();
    await db.exec(fixture);
    await db.exec(migration);
    await db.exec(rollback);
    const anon = await db.query(
      `select has_function_privilege('anon', 'public.seed_demo_freight_os(uuid)', 'execute') as v`
    );
    assert.equal(anon.rows[0].v, true);
    const rls = await db.query(
      `select c.relrowsecurity as rls,
              has_table_privilege('authenticated', 'public._dev_schema_migrations', 'insert') as ins
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = '_dev_schema_migrations'`
    );
    assert.equal(rls.rows[0].rls, false);
    assert.equal(rls.rows[0].ins, true);
    await db.close();
  });
});

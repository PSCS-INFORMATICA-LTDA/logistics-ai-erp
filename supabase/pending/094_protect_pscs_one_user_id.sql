-- NÃO EXECUTAR.
-- Aplicação transacional da proteção de public.profiles.pscs_one_user_id
-- no Logistics DEV jmbajdpkvlrslirwzyze.
-- Marcadores DEV: public._dev_schema_migrations e as empresas
-- 92c4c90d-6856-4c41-a9a1-9eba6a7468f6 e bcd3c6c9-0e4a-4356-addd-4af925725576.
-- Não usar em PROD tqeenmswotxqainkyyct.
-- Ledger 93 passa a 94 na mesma transação. As 93 linhas anteriores permanecem.
-- O callback SSO grava o vínculo por service_role. O usuário autenticado não grava.

begin;

lock table public._dev_schema_migrations in access exclusive mode;

do $$
declare
  v_rows integer;
  v_names integer;
begin
  if current_user not in ('postgres', 'supabase_admin')
     or session_user not in ('postgres', 'supabase_admin') then
    raise exception 'apply_094_requires_postgres';
  end if;
  if current_setting('request.jwt.claim.role', true) is not null
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'apply_094_requires_postgres';
  end if;
  if to_regclass('public._dev_schema_migrations') is null then
    raise exception 'apply_094_dev_marker_missing';
  end if;
  if not exists (
    select 1 from public.companies
    where id = '92c4c90d-6856-4c41-a9a1-9eba6a7468f6'
  ) or not exists (
    select 1 from public.companies
    where id = 'bcd3c6c9-0e4a-4356-addd-4af925725576'
  ) then
    raise exception 'apply_094_dev_marker_missing';
  end if;

  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;
  if v_rows <> 93 or v_names <> 93 then
    raise exception 'apply_094_requires_ledger_93:%', v_rows;
  end if;
  if exists (
    select 1 from public._dev_schema_migrations
    where filename = '094_protect_pscs_one_user_id.sql'
  ) then
    raise exception 'apply_094_already_present';
  end if;

  create temp table apply_094_history on commit drop as
  select filename, applied_at
  from public._dev_schema_migrations;
end $$;

revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;
revoke insert on table public.profiles from public;
revoke insert on table public.profiles from anon;
revoke insert on table public.profiles from authenticated;

grant update (full_name, email) on table public.profiles to authenticated;
grant insert (id, full_name, email) on table public.profiles to authenticated;
grant select, insert, update on table public.profiles to service_role;

create or replace function public.protect_profiles_pscs_one_user_id()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.pscs_one_user_id is not null
       and current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'pscs_one_user_id_immutable'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.pscs_one_user_id is distinct from old.pscs_one_user_id
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'pscs_one_user_id_immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_pscs_one_user_id_guard on public.profiles;
create trigger trg_profiles_pscs_one_user_id_guard
  before insert or update of pscs_one_user_id on public.profiles
  for each row
  execute function public.protect_profiles_pscs_one_user_id();

insert into public._dev_schema_migrations (filename, applied_at)
values ('094_protect_pscs_one_user_id.sql', clock_timestamp());

do $$
declare
  v_rows integer;
  v_names integer;
begin
  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;
  if v_rows <> 94 or v_names <> 94 then
    raise exception 'apply_094_ledger_not_94:%', v_rows;
  end if;
  if exists (
    select 1
    from apply_094_history h
    left join public._dev_schema_migrations m
      on m.filename = h.filename
    where m.filename is null
       or m.applied_at is distinct from h.applied_at
  ) then
    raise exception 'apply_094_historical_row_changed';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'pscs_one_user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'INSERT')
     or has_column_privilege('anon', 'public.profiles', 'pscs_one_user_id', 'INSERT') then
    raise exception 'pscs_one_user_id_still_writable';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
     or not has_column_privilege('service_role', 'public.profiles', 'pscs_one_user_id', 'UPDATE')
     or not has_column_privilege('service_role', 'public.profiles', 'pscs_one_user_id', 'INSERT') then
    raise exception 'profile_legitimate_edit_closed';
  end if;
end $$;

commit;

-- NÃO EXECUTAR.
-- Rollback pós-commit da 094 no Logistics DEV jmbajdpkvlrslirwzyze.
-- Marcadores DEV: public._dev_schema_migrations e as empresas
-- 92c4c90d-6856-4c41-a9a1-9eba6a7468f6 e bcd3c6c9-0e4a-4356-addd-4af925725576.
-- Volta o ledger de 94 para 93 e devolve o UPDATE da tabela ao authenticated.
-- Não devolve UPDATE nem INSERT a anon ou PUBLIC.

begin;

lock table public._dev_schema_migrations in access exclusive mode;

do $$
declare
  v_rows integer;
  v_names integer;
  v_rows_after integer;
  v_names_after integer;
begin
  if current_user not in ('postgres', 'supabase_admin')
     or session_user not in ('postgres', 'supabase_admin') then
    raise exception 'rollback_094_requires_postgres';
  end if;
  if current_setting('request.jwt.claim.role', true) is not null
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'rollback_094_requires_postgres';
  end if;
  if to_regclass('public._dev_schema_migrations') is null then
    raise exception 'rollback_094_dev_marker_missing';
  end if;
  if not exists (
    select 1 from public.companies where id = '92c4c90d-6856-4c41-a9a1-9eba6a7468f6'
  ) or not exists (
    select 1 from public.companies where id = 'bcd3c6c9-0e4a-4356-addd-4af925725576'
  ) then
    raise exception 'rollback_094_dev_marker_missing';
  end if;

  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;
  if v_rows <> 94 or v_names <> 94 then
    raise exception 'rollback_094_requires_ledger_94:%', v_rows;
  end if;
  if not exists (
    select 1 from public._dev_schema_migrations
    where filename = '094_protect_pscs_one_user_id.sql'
  ) then
    raise exception 'rollback_094_row_missing';
  end if;

  create temp table rollback_094_history on commit drop as
  select filename, applied_at
  from public._dev_schema_migrations
  where filename <> '094_protect_pscs_one_user_id.sql';

  drop trigger if exists trg_profiles_pscs_one_user_id_guard on public.profiles;
  drop function if exists public.protect_profiles_pscs_one_user_id();

  revoke update (full_name, email) on table public.profiles from authenticated;
  revoke insert (id, full_name, email) on table public.profiles from authenticated;
  grant update on table public.profiles to authenticated;
  grant insert on table public.profiles to authenticated;

  delete from public._dev_schema_migrations
  where filename = '094_protect_pscs_one_user_id.sql';

  select count(*), count(distinct filename)
    into v_rows_after, v_names_after
  from public._dev_schema_migrations;
  if v_rows_after <> 93 or v_names_after <> 93 then
    raise exception 'rollback_094_ledger_not_93:%', v_rows_after;
  end if;
  if exists (
    select 1
    from rollback_094_history h
    full outer join public._dev_schema_migrations m
      on m.filename = h.filename
    where h.filename is null
       or m.filename is null
       or m.applied_at is distinct from h.applied_at
  ) then
    raise exception 'rollback_094_historical_row_changed';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE') then
    raise exception 'rollback_094_column_still_closed';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'pscs_one_user_id', 'UPDATE') then
    raise exception 'rollback_094_anon_reopened';
  end if;
end $$;

commit;

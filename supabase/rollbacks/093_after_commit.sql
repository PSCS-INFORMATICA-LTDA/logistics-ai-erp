-- NÃO EXECUTAR.
-- Rollback pós-commit da 093 no Logistics DEV jmbajdpkvlrslirwzyze.
-- Marcadores DEV: a tabela public._dev_schema_migrations e o par de empresas
-- 92c4c90d-6856-4c41-a9a1-9eba6a7468f6 e bcd3c6c9-0e4a-4356-addd-4af925725576.
-- Não devolve EXECUTE a anon nem a PUBLIC.
-- Não usar em PROD tqeenmswotxqainkyyct. Não mexe na 092 nem em financial_correction_events.
-- Não altera applied_at das outras linhas do ledger.

begin;

lock table public._dev_schema_migrations in access exclusive mode;

do $$
declare
  v_rows integer;
  v_names integer;
  v_helpers_open integer;
  v_search_path integer;
  v_stamp_min timestamptz;
  v_stamp_max timestamptz;
  v_stamp_count integer;
  v_rows_after integer;
  v_names_after integer;
  v_stamp_min_after timestamptz;
  v_stamp_max_after timestamptz;
  v_stamp_count_after integer;
  v_helpers_anon integer;
  v_helpers_auth integer;
  v_helpers_public integer;
begin
  if current_user not in ('postgres', 'supabase_admin')
     or session_user not in ('postgres', 'supabase_admin') then
    raise exception 'rollback_093_requires_postgres';
  end if;
  if current_setting('request.jwt.claim.role', true) is not null
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'rollback_093_requires_postgres';
  end if;

  if to_regclass('public._dev_schema_migrations') is null then
    raise exception 'rollback_093_dev_marker_missing';
  end if;
  if not exists (
    select 1 from public.companies
    where id = '92c4c90d-6856-4c41-a9a1-9eba6a7468f6'
  ) or not exists (
    select 1 from public.companies
    where id = 'bcd3c6c9-0e4a-4356-addd-4af925725576'
  ) then
    raise exception 'rollback_093_dev_marker_missing';
  end if;

  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;
  if v_rows <> 93 or v_names <> 93 then
    raise exception 'rollback_093_requires_ledger_93';
  end if;
  if not exists (
    select 1 from public._dev_schema_migrations
    where filename = '093_residual_search_path_and_helpers.sql'
  ) then
    raise exception 'rollback_093_row_missing';
  end if;

  select min(applied_at), max(applied_at), count(*)
    into v_stamp_min, v_stamp_max, v_stamp_count
  from public._dev_schema_migrations
  where filename <> '093_residual_search_path_and_helpers.sql';

  select count(*)
    into v_helpers_open
  from (
    values
      ('public._ap_assert_company_member(uuid)'::regprocedure),
      ('public._ap_post_competence(uuid)'::regprocedure),
      ('public._assert_service_order_member(uuid)'::regprocedure)
  ) as helper(proc)
  where has_function_privilege('anon', helper.proc, 'EXECUTE')
     or has_function_privilege('authenticated', helper.proc, 'EXECUTE')
     or has_function_privilege('public', helper.proc, 'EXECUTE');
  if v_helpers_open <> 0 then
    raise exception 'rollback_093_helpers_already_open';
  end if;

  select count(*)
    into v_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'set_updated_at',
      'normalize_driver_name',
      'sync_transaction_classification',
      'ensure_single_default_branch',
      'check_ownership_percentage',
      'sync_traffic_infraction_plate',
      'trg_deletion_audit_events_immutable',
      'compliance_documents_set_root',
      'service_order_driver_confirmed'
    )
    and exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg = 'search_path=public'
    );
  if v_search_path <> 9 then
    raise exception 'rollback_093_search_path_mismatch';
  end if;

  execute 'ALTER FUNCTION public.set_updated_at() RESET search_path';
  execute 'ALTER FUNCTION public.normalize_driver_name() RESET search_path';
  execute 'ALTER FUNCTION public.sync_transaction_classification() RESET search_path';
  execute 'ALTER FUNCTION public.ensure_single_default_branch() RESET search_path';
  execute 'ALTER FUNCTION public.check_ownership_percentage() RESET search_path';
  execute 'ALTER FUNCTION public.sync_traffic_infraction_plate() RESET search_path';
  execute 'ALTER FUNCTION public.trg_deletion_audit_events_immutable() RESET search_path';
  execute 'ALTER FUNCTION public.compliance_documents_set_root() RESET search_path';
  execute 'ALTER FUNCTION public.service_order_driver_confirmed(uuid, text) RESET search_path';

  execute 'GRANT EXECUTE ON FUNCTION public._ap_assert_company_member(uuid) TO authenticated';
  execute 'GRANT EXECUTE ON FUNCTION public._ap_post_competence(uuid) TO authenticated';
  execute 'GRANT EXECUTE ON FUNCTION public._assert_service_order_member(uuid) TO authenticated';

  delete from public._dev_schema_migrations
  where filename = '093_residual_search_path_and_helpers.sql';

  select count(*), count(distinct filename)
    into v_rows_after, v_names_after
  from public._dev_schema_migrations;
  if v_rows_after <> 92 or v_names_after <> 92 then
    raise exception 'rollback_093_ledger_not_92';
  end if;

  select min(applied_at), max(applied_at), count(*)
    into v_stamp_min_after, v_stamp_max_after, v_stamp_count_after
  from public._dev_schema_migrations;
  if v_stamp_min_after is distinct from v_stamp_min
     or v_stamp_max_after is distinct from v_stamp_max
     or v_stamp_count_after is distinct from v_stamp_count then
    raise exception 'rollback_093_timestamp_changed';
  end if;

  select count(*) filter (where has_function_privilege('anon', helper.proc, 'EXECUTE')),
         count(*) filter (where has_function_privilege('authenticated', helper.proc, 'EXECUTE')),
         count(*) filter (where has_function_privilege('public', helper.proc, 'EXECUTE'))
    into v_helpers_anon, v_helpers_auth, v_helpers_public
  from (
    values
      ('public._ap_assert_company_member(uuid)'::regprocedure),
      ('public._ap_post_competence(uuid)'::regprocedure),
      ('public._assert_service_order_member(uuid)'::regprocedure)
  ) as helper(proc);
  if v_helpers_anon <> 0 or v_helpers_auth <> 3 or v_helpers_public <> 0 then
    raise exception 'rollback_093_privilege_mismatch';
  end if;
end $$;

commit;

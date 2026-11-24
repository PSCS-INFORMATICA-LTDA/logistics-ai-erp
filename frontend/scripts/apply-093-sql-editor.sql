-- SQL Editor — Supabase DEV jmbajdpkvlrslirwzyze apenas.
-- Não aplicar nesta etapa. Executar o arquivo inteiro, uma vez, como postgres, só com autorização explícita.
-- Não aplicar em PROD tqeenmswotxqainkyyct. Não reaplicar a 092. Não usar o runner.
-- Uma transação: trava o ledger, exige 92 nomes distintos, aplica só a 093, registra o arquivo e confere 93.
-- Qualquer exceção aborta a transação. Permissão, search_path e ledger voltam ao estado anterior.

begin;

do $m093_pre$
begin
  if current_user is distinct from 'postgres' then
    raise exception '093: aplicar como postgres. Sessão atual: %', current_user
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.companies
    where id = '92c4c90d-6856-4c41-a9a1-9eba6a7468f6'
      and name = 'PSCS DEV Contas a Pagar'
  ) then
    raise exception '093: ambiente não é o DEV jmbajdpkvlrslirwzyze.';
  end if;
end
$m093_pre$;

lock table public._dev_schema_migrations in share row exclusive mode;

do $m093_ledger$
declare
  v_rows integer;
  v_names integer;
begin
  if exists (
    select 1 from public._dev_schema_migrations
    where filename = '093_residual_search_path_and_helpers.sql'
  ) then
    raise exception '093: a migration 093 já está registrada. Não reaplicar.';
  end if;

  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;

  if v_rows is distinct from 92 or v_names is distinct from 92 then
    raise exception '093: ledger divergente. Esperado 92 registros distintos. Encontrado % linhas e % nomes.', v_rows, v_names;
  end if;

  if not exists (
    select 1 from public._dev_schema_migrations
    where filename = '092_chart_seed_finance_guard.sql'
  ) then
    raise exception '093: a 092 precisa já estar registrada. Não reaplicar a 092.';
  end if;
end
$m093_ledger$;

create temp table _m093_ledger_before on commit drop as
select filename, applied_at
from public._dev_schema_migrations;

create temp table _m093_fn_before on commit drop as
select p.oid, p.prosrc, p.prosecdef
from (
  values
    ('public.set_updated_at()'),
    ('public.normalize_driver_name()'),
    ('public.sync_transaction_classification()'),
    ('public.ensure_single_default_branch()'),
    ('public.check_ownership_percentage()'),
    ('public.sync_traffic_infraction_plate()'),
    ('public.trg_deletion_audit_events_immutable()'),
    ('public.compliance_documents_set_root()'),
    ('public.service_order_driver_confirmed(uuid, text)'),
    ('public._ap_assert_company_member(uuid)'),
    ('public._ap_post_competence(uuid)'),
    ('public._assert_service_order_member(uuid)')
) as expected(signature)
join pg_proc p on p.oid = to_regprocedure(expected.signature);

do $m093_fn_present$
begin
  if (select count(*) from _m093_fn_before) <> 12 then
    raise exception '093: faltam funções esperadas. Encontradas %.', (select count(*) from _m093_fn_before);
  end if;
end
$m093_fn_present$;

alter function public.set_updated_at() set search_path = public;
alter function public.normalize_driver_name() set search_path = public;
alter function public.sync_transaction_classification() set search_path = public;
alter function public.ensure_single_default_branch() set search_path = public;
alter function public.check_ownership_percentage() set search_path = public;
alter function public.sync_traffic_infraction_plate() set search_path = public;
alter function public.trg_deletion_audit_events_immutable() set search_path = public;
alter function public.compliance_documents_set_root() set search_path = public;
alter function public.service_order_driver_confirmed(uuid, text) set search_path = public;

revoke all on function public._ap_assert_company_member(uuid) from public;
revoke all on function public._ap_assert_company_member(uuid) from anon;
revoke all on function public._ap_assert_company_member(uuid) from authenticated;

revoke all on function public._ap_post_competence(uuid) from public;
revoke all on function public._ap_post_competence(uuid) from anon;
revoke all on function public._ap_post_competence(uuid) from authenticated;

revoke all on function public._assert_service_order_member(uuid) from public;
revoke all on function public._assert_service_order_member(uuid) from anon;
revoke all on function public._assert_service_order_member(uuid) from authenticated;

insert into public._dev_schema_migrations (filename)
values ('093_residual_search_path_and_helpers.sql');

do $m093_post$
declare
  v_rows integer;
  v_names integer;
  v_helper text;
begin
  if exists (
    select 1
    from _m093_ledger_before b
    left join public._dev_schema_migrations m using (filename)
    where m.filename is null
       or m.applied_at is distinct from b.applied_at
  ) then
    raise exception '093: registro anterior do ledger foi alterado. Rollback.';
  end if;

  if (select count(*) from _m093_ledger_before) <> 92 then
    raise exception '093: a foto dos 92 registros não foi preservada.';
  end if;

  select count(*), count(distinct filename)
    into v_rows, v_names
  from public._dev_schema_migrations;

  if v_rows is distinct from 93 or v_names is distinct from 93 then
    raise exception '093: validação final falhou. Esperado 93 registros distintos. Encontrado % linhas e % nomes.', v_rows, v_names;
  end if;

  if exists (
    select 1
    from _m093_fn_before b
    join pg_proc p on p.oid = b.oid
    where p.prosrc is distinct from b.prosrc
       or p.prosecdef is distinct from b.prosecdef
  ) then
    raise exception '093: o corpo de uma função foi alterado. Rollback.';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.set_updated_at()'::regprocedure,
      'public.normalize_driver_name()'::regprocedure,
      'public.sync_transaction_classification()'::regprocedure,
      'public.ensure_single_default_branch()'::regprocedure,
      'public.check_ownership_percentage()'::regprocedure,
      'public.sync_traffic_infraction_plate()'::regprocedure,
      'public.trg_deletion_audit_events_immutable()'::regprocedure,
      'public.compliance_documents_set_root()'::regprocedure,
      'public.service_order_driver_confirmed(uuid, text)'::regprocedure
    )
    and (
      p.proconfig is null
      or not ('search_path=public' = any (p.proconfig))
    )
  ) then
    raise exception '093: search_path não ficou fixo em public. Rollback.';
  end if;

  foreach v_helper in array array[
    'public._ap_assert_company_member(uuid)',
    'public._ap_post_competence(uuid)',
    'public._assert_service_order_member(uuid)'
  ]
  loop
    if has_function_privilege('public', v_helper, 'execute')
       or has_function_privilege('anon', v_helper, 'execute')
       or has_function_privilege('authenticated', v_helper, 'execute')
       or not has_function_privilege('service_role', v_helper, 'execute')
       or not has_function_privilege('postgres', v_helper, 'execute')
    then
      raise exception '093: privilégio inesperado em %. Rollback.', v_helper;
    end if;
  end loop;
end
$m093_post$;

commit;

-- NÃO EXECUTAR.
-- Rollback pós-commit da 093 no Logistics DEV jmbajdpkvlrslirwzyze.
-- A 093 já está no ledger. Este script desfaz a função e remove a linha do ledger
-- na mesma transação. Não devolve EXECUTE a anon nem a PUBLIC.
-- Não usar em PROD tqeenmswotxqainkyyct. Não mexe na 092 nem em financial_correction_events.

begin;

do $$
declare
  v_count integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from null
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'rollback_093_requires_postgres';
  end if;

  select count(distinct filename)
    into v_count
  from public._dev_schema_migrations;

  if v_count <> 93 then
    raise exception 'rollback_093_requires_ledger_93';
  end if;

  if not exists (
    select 1
    from public._dev_schema_migrations
    where filename = '093_residual_search_path_and_helpers.sql'
  ) then
    raise exception 'rollback_093_row_missing';
  end if;
end $$;

ALTER FUNCTION public.set_updated_at() RESET search_path;
ALTER FUNCTION public.normalize_driver_name() RESET search_path;
ALTER FUNCTION public.sync_transaction_classification() RESET search_path;
ALTER FUNCTION public.ensure_single_default_branch() RESET search_path;
ALTER FUNCTION public.check_ownership_percentage() RESET search_path;
ALTER FUNCTION public.sync_traffic_infraction_plate() RESET search_path;
ALTER FUNCTION public.trg_deletion_audit_events_immutable() RESET search_path;
ALTER FUNCTION public.compliance_documents_set_root() RESET search_path;
ALTER FUNCTION public.service_order_driver_confirmed(uuid, text) RESET search_path;

GRANT EXECUTE ON FUNCTION public._ap_assert_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._ap_post_competence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._assert_service_order_member(uuid) TO authenticated;

delete from public._dev_schema_migrations
where filename = '093_residual_search_path_and_helpers.sql';

do $$
declare
  v_count integer;
begin
  select count(distinct filename)
    into v_count
  from public._dev_schema_migrations;
  if v_count <> 92 then
    raise exception 'rollback_093_ledger_not_92';
  end if;
end $$;

commit;

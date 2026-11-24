-- SQL Editor — Supabase DEV jmbajdpkvlrslirwzyze apenas.
-- Não aplicar nesta etapa. Executar o arquivo inteiro, uma vez, como postgres, só com autorização explícita.
-- Não aplicar em PROD tqeenmswotxqainkyyct.
-- Não reaplicar a 092.

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
  if not exists (
    select 1 from public._dev_schema_migrations
    where filename = '092_chart_seed_finance_guard.sql'
  ) then
    raise exception '093: a 092 precisa já estar registrada. Não reaplicar.';
  end if;
end
$m093_pre$;

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.normalize_driver_name() SET search_path = public;
ALTER FUNCTION public.sync_transaction_classification() SET search_path = public;
ALTER FUNCTION public.ensure_single_default_branch() SET search_path = public;
ALTER FUNCTION public.check_ownership_percentage() SET search_path = public;
ALTER FUNCTION public.sync_traffic_infraction_plate() SET search_path = public;
ALTER FUNCTION public.trg_deletion_audit_events_immutable() SET search_path = public;
ALTER FUNCTION public.compliance_documents_set_root() SET search_path = public;
ALTER FUNCTION public.service_order_driver_confirmed(uuid, text) SET search_path = public;

REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public._ap_post_competence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ap_post_competence(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._ap_post_competence(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public._assert_service_order_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._assert_service_order_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._assert_service_order_member(uuid) FROM authenticated;

commit;

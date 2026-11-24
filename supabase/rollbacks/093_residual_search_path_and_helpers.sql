-- Rollback da 093. Devolve search_path mutável e o EXECUTE de authenticated nos três helpers.
-- Não devolve EXECUTE a anon nem a PUBLIC.
-- Não executar sem autorização específica. Não usar em PROD tqeenmswotxqainkyyct.
-- Não mexe na 092 nem em financial_correction_events.

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

-- DEV only. Não aplicar sem autorização explícita no Supabase DEV jmbajdpkvlrslirwzyze.
-- Não aplicar em PROD tqeenmswotxqainkyyct.
-- Não reaplicar a 092. Não altera seed, ledger nem financial_correction_events.
-- Fixa o search_path das nove funções invocadoras.
-- Tira EXECUTE dos três helpers internos de anon, PUBLIC e authenticated.
-- O dono postgres continua podendo chamá-los de dentro das RPCs SECURITY DEFINER.
-- service_role permanece como está.

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

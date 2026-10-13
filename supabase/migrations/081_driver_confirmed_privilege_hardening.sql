-- Fail-closed: close, follow-up e reabertura de proposta só para authenticated.
-- _assert_service_order_member já recusa auth.uid() nulo; este revoke tira EXECUTE de anon/PUBLIC.
-- Não altera o contrato DRIVER_CONFIRMED.

REVOKE ALL ON FUNCTION public.complete_service_order(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_service_order(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_service_order(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.register_service_order_follow_up(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_service_order_follow_up(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_service_order_follow_up(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_proposal_client_response(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_proposal_client_response(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_proposal_client_response(UUID) TO authenticated;

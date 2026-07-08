-- Opcional: RPCs de aceite/recusa manual por order_id (legado).
-- O app usa respond_to_proposal (mesma função do link e-mail/WhatsApp) via proposal_token.
-- Execute apenas se quiser manter funções auxiliares no banco.

CREATE OR REPLACE FUNCTION public.accept_proposal_on_behalf_of_client(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  UPDATE public.service_orders
  SET
    proposal_response = 'accepted',
    proposal_accepted_at = NOW(),
    proposal_rejected_at = NULL,
    status = 'Aberto'
  WHERE id = p_order_id
    AND proposal_sent_at IS NOT NULL
    AND proposal_response = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta não enviada, já respondida ou ordem não encontrada';
  END IF;

  RETURN jsonb_build_object(
    'proposal_response', 'accepted',
    'status', 'Aberto',
    'proposal_accepted_at', (SELECT proposal_accepted_at FROM public.service_orders WHERE id = p_order_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_proposal_on_behalf_of_client(UUID) TO authenticated;

-- Recusa manual pelo staff (cliente confirmou por telefone)
CREATE OR REPLACE FUNCTION public.reject_proposal_on_behalf_of_client(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  UPDATE public.service_orders
  SET
    proposal_response = 'rejected',
    proposal_rejected_at = NOW(),
    proposal_accepted_at = NULL,
    status = 'Aguardando aprovação cliente'
  WHERE id = p_order_id
    AND proposal_sent_at IS NOT NULL
    AND proposal_response = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta não enviada, já respondida ou ordem não encontrada';
  END IF;

  RETURN jsonb_build_object(
    'proposal_response', 'rejected',
    'status', 'Aguardando aprovação cliente',
    'proposal_rejected_at', (SELECT proposal_rejected_at FROM public.service_orders WHERE id = p_order_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_proposal_on_behalf_of_client(UUID) TO authenticated;

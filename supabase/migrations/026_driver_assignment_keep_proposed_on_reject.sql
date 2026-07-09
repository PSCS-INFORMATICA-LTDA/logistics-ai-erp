-- Keep proposed_driver_id when motorista recusa, so a listagem mostra quem recusou
-- e Rafael pode designar outro motorista.

CREATE OR REPLACE FUNCTION public.respond_to_driver_assignment(p_token TEXT, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  IF p_action NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE driver_assignment_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Designação não encontrada';
  END IF;

  IF v_row.driver_assignment_sent_at IS NULL OR v_row.proposed_driver_id IS NULL THEN
    RAISE EXCEPTION 'Designação ainda não foi enviada ao motorista';
  END IF;

  IF v_row.driver_assignment_response <> 'pending' THEN
    RAISE EXCEPTION 'Designação já respondida';
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.service_orders
    SET
      driver_assignment_response = 'accepted',
      driver_assignment_accepted_at = NOW(),
      driver_id = proposed_driver_id
    WHERE id = v_row.id;
  ELSE
    UPDATE public.service_orders
    SET
      driver_assignment_response = 'rejected',
      driver_assignment_rejected_at = NOW()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'driver_assignment_response', (SELECT driver_assignment_response FROM public.service_orders WHERE id = v_row.id),
    'driver_id', (SELECT driver_id FROM public.service_orders WHERE id = v_row.id),
    'proposed_driver_id', (SELECT proposed_driver_id FROM public.service_orders WHERE id = v_row.id)
  );
END;
$$;

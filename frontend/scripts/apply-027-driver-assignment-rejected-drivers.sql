-- Cole no SQL Editor do Supabase após 024/025/026.
-- Histórico persistente de motoristas que recusaram designação.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS driver_assignment_rejected_driver_ids UUID[] NOT NULL DEFAULT '{}';

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
      driver_assignment_rejected_at = NOW(),
      driver_assignment_rejected_driver_ids = CASE
        WHEN v_row.proposed_driver_id IS NOT NULL
          AND NOT (v_row.proposed_driver_id = ANY(v_row.driver_assignment_rejected_driver_ids))
        THEN array_append(v_row.driver_assignment_rejected_driver_ids, v_row.proposed_driver_id)
        ELSE v_row.driver_assignment_rejected_driver_ids
      END
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'driver_assignment_response', (SELECT driver_assignment_response FROM public.service_orders WHERE id = v_row.id),
    'driver_id', (SELECT driver_id FROM public.service_orders WHERE id = v_row.id),
    'proposed_driver_id', (SELECT proposed_driver_id FROM public.service_orders WHERE id = v_row.id),
    'driver_assignment_rejected_driver_ids', (SELECT driver_assignment_rejected_driver_ids FROM public.service_orders WHERE id = v_row.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_driver_assignment(p_order_id UUID, p_driver_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_sent_at TIMESTAMPTZ;
  v_row public.service_orders%ROWTYPE;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'Motorista não informado';
  END IF;

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada';
  END IF;

  IF v_row.proposal_response <> 'accepted' THEN
    RAISE EXCEPTION 'A proposta precisa estar aceita pelo cliente antes de designar motorista';
  END IF;

  IF v_row.driver_id IS NOT NULL AND v_row.driver_assignment_response = 'accepted' THEN
    RAISE EXCEPTION 'Motorista já confirmado nesta ordem';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = p_driver_id
      AND d.company_id = v_row.company_id
      AND d.status = 'Ativo'
      AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Motorista inválido ou inativo';
  END IF;

  v_token := public.ensure_driver_assignment_token(p_order_id);

  UPDATE public.service_orders
  SET
    proposed_driver_id = p_driver_id,
    driver_assignment_sent_at = NOW(),
    driver_assignment_response = 'pending',
    driver_assignment_accepted_at = NULL,
    driver_assignment_rejected_at = NULL,
    driver_id = NULL
    -- driver_assignment_rejected_driver_ids: intentionally NOT cleared
  WHERE id = p_order_id;

  SELECT driver_assignment_sent_at INTO v_sent_at
  FROM public.service_orders
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'token', v_token,
    'driver_assignment_sent_at', v_sent_at,
    'proposed_driver_id', p_driver_id
  );
END;
$$;

-- Backfill OS001 (recusa com migration 024 antiga — proposed_driver_id ficou NULL):
-- SELECT id FROM public.drivers WHERE code = 'MOT001';
-- UPDATE public.service_orders
-- SET
--   proposed_driver_id = '<uuid-do-MOT001>',
--   driver_assignment_rejected_driver_ids = ARRAY['<uuid-do-MOT001>'::uuid]
-- WHERE code = 'OS001'
--   AND driver_assignment_response = 'rejected'
--   AND driver_assignment_rejected_driver_ids = '{}';

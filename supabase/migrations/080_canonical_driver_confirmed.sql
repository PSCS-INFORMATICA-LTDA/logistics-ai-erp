-- Contrato único DRIVER_CONFIRMED.
-- driver_id definido E driver_assignment_response = 'accepted'.
--
-- Substitui a exceção de apply-060 (pending + sem envio + sem proposed),
-- que estava só no banco e divergia do acompanhamento operacional.
-- A migration 029 não é editada. O script 060 não é a solução final.
--
-- Backfill estreito: OS cuja proposta já foi aceita e que só passavam no close
-- pela exceção legada passam a gravar o estado canônico. Proposta ainda
-- pendente com driver_id solto NÃO vira confirmação.

CREATE OR REPLACE FUNCTION public.service_order_driver_confirmed(
  p_driver_id UUID,
  p_driver_assignment_response TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_driver_id IS NOT NULL
    AND p_driver_assignment_response = 'accepted';
$$;

COMMENT ON FUNCTION public.service_order_driver_confirmed(UUID, TEXT) IS
  'DRIVER_CONFIRMED: driver_id definido e driver_assignment_response = accepted.';

REVOKE ALL ON FUNCTION public.service_order_driver_confirmed(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_order_driver_confirmed(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.service_order_driver_confirmed(UUID, TEXT) TO authenticated;

-- Promove só o legado que o close antigo liberava e cuja proposta já está aceita.
UPDATE public.service_orders
SET
  driver_assignment_response = 'accepted',
  driver_assignment_accepted_at = COALESCE(driver_assignment_accepted_at, NOW()),
  proposed_driver_id = COALESCE(proposed_driver_id, driver_id)
WHERE driver_id IS NOT NULL
  AND status IS DISTINCT FROM 'Cancelado'
  AND proposal_response = 'accepted'
  AND COALESCE(driver_assignment_response, 'pending') = 'pending'
  AND driver_assignment_sent_at IS NULL
  AND proposed_driver_id IS NULL;

CREATE OR REPLACE FUNCTION public.complete_service_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada';
  END IF;

  IF NOT public.service_order_driver_confirmed(v_row.driver_id, v_row.driver_assignment_response) THEN
    RAISE EXCEPTION 'Motorista ainda não confirmou a designação';
  END IF;

  IF v_row.status = 'Concluido' THEN
    RAISE EXCEPTION 'Ordem de serviço já concluída';
  END IF;

  UPDATE public.service_orders
  SET
    status = 'Concluido',
    service_completed_at = NOW(),
    proposal_response = CASE
      WHEN COALESCE(proposal_response, 'pending') = 'rejected' THEN proposal_response
      ELSE 'accepted'
    END,
    proposal_accepted_at = COALESCE(proposal_accepted_at, NOW()),
    driver_assignment_response = 'accepted',
    proposed_driver_id = COALESCE(proposed_driver_id, driver_id)
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'status', 'Concluido',
    'service_completed_at', (SELECT service_completed_at FROM public.service_orders WHERE id = p_order_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_service_order_follow_up(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
  v_count INTEGER;
  v_last_at TIMESTAMPTZ;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada';
  END IF;

  IF NOT public.service_order_driver_confirmed(v_row.driver_id, v_row.driver_assignment_response) THEN
    RAISE EXCEPTION 'Registre a confirmação do motorista antes do acompanhamento operacional';
  END IF;

  IF v_row.status = 'Concluido' THEN
    RAISE EXCEPTION 'Esta ordem já está concluída';
  END IF;

  UPDATE public.service_orders
  SET
    service_last_follow_up_at = NOW(),
    service_follow_up_count = service_follow_up_count + 1
  WHERE id = p_order_id
  RETURNING service_follow_up_count, service_last_follow_up_at
  INTO v_count, v_last_at;

  RETURN jsonb_build_object(
    'service_follow_up_count', v_count,
    'service_last_follow_up_at', v_last_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_proposal_client_response(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  UPDATE public.service_orders
  SET
    proposal_response = 'pending',
    proposal_accepted_at = NULL,
    proposal_rejected_at = NULL,
    status = 'Aguardando aprovação cliente',
    proposed_driver_id = NULL,
    driver_id = NULL,
    driver_assignment_response = 'pending',
    driver_assignment_token = NULL,
    driver_assignment_sent_at = NULL,
    driver_assignment_accepted_at = NULL,
    driver_assignment_rejected_at = NULL,
    driver_assignment_pay_amount = NULL,
    driver_assignment_assistant_pay_amount = NULL,
    driver_assignment_rejected_driver_ids = '{}'
  WHERE id = p_order_id
    AND proposal_sent_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta não enviada ou ordem não encontrada';
  END IF;

  RETURN jsonb_build_object(
    'proposal_response', 'pending',
    'status', 'Aguardando aprovação cliente',
    'driver_assignment_response', 'pending',
    'proposed_driver_id', NULL,
    'driver_assignment_sent_at', NULL,
    'driver_assignment_token', NULL,
    'driver_id', NULL,
    'driver_assignment_pay_amount', NULL,
    'driver_assignment_assistant_pay_amount', NULL,
    'driver_assignment_rejected_driver_ids', '{}'::uuid[]
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_service_order_driver_without_link(
  p_order_id UUID,
  p_driver_id UUID,
  p_driver_pay_amount NUMERIC DEFAULT NULL,
  p_assistant_pay_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'Motorista não informado';
  END IF;

  IF p_driver_pay_amount IS NOT NULL AND p_driver_pay_amount <= 0 THEN
    RAISE EXCEPTION 'Informe o valor a pagar ao motorista';
  END IF;

  IF p_assistant_pay_amount IS NOT NULL AND p_assistant_pay_amount < 0 THEN
    RAISE EXCEPTION 'Valor do ajudante inválido';
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

  IF v_row.status = 'Concluido' THEN
    RAISE EXCEPTION 'Ordem de serviço já concluída';
  END IF;

  IF public.service_order_driver_confirmed(v_row.driver_id, v_row.driver_assignment_response) THEN
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

  UPDATE public.service_orders
  SET
    driver_id = p_driver_id,
    proposed_driver_id = p_driver_id,
    driver_assignment_response = 'accepted',
    driver_assignment_accepted_at = NOW(),
    driver_assignment_rejected_at = NULL,
    driver_assignment_pay_amount = COALESCE(p_driver_pay_amount, driver_assignment_pay_amount),
    driver_assignment_assistant_pay_amount = CASE
      WHEN p_assistant_pay_amount IS NULL THEN driver_assignment_assistant_pay_amount
      WHEN p_assistant_pay_amount = 0 THEN NULL
      ELSE p_assistant_pay_amount
    END
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'driver_id', p_driver_id,
    'proposed_driver_id', p_driver_id,
    'driver_assignment_response', 'accepted',
    'driver_assignment_pay_amount', (
      SELECT driver_assignment_pay_amount FROM public.service_orders WHERE id = p_order_id
    ),
    'driver_assignment_assistant_pay_amount', (
      SELECT driver_assignment_assistant_pay_amount FROM public.service_orders WHERE id = p_order_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_service_order_driver_without_link(UUID, UUID, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_service_order_driver_without_link(UUID, UUID, NUMERIC, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_service_order_driver_without_link(UUID, UUID, NUMERIC, NUMERIC) TO authenticated;

GRANT EXECUTE ON FUNCTION public.complete_service_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_service_order_follow_up(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_proposal_client_response(UUID) TO authenticated;

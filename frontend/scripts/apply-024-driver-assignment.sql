-- Designação de motorista + endereço e e-mail no cadastro — cole no Supabase SQL Editor

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS proposed_driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_assignment_token TEXT,
  ADD COLUMN IF NOT EXISTS driver_assignment_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_assignment_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (driver_assignment_response IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS driver_assignment_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_assignment_rejected_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_driver_assignment_token
  ON public.service_orders (driver_assignment_token)
  WHERE driver_assignment_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_driver_assignment_token(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  SELECT driver_assignment_token INTO v_token
  FROM public.service_orders
  WHERE id = p_order_id;

  IF v_token IS NULL OR v_token = '' THEN
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    UPDATE public.service_orders
    SET driver_assignment_token = v_token
    WHERE id = p_order_id;
  END IF;

  RETURN v_token;
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

CREATE OR REPLACE FUNCTION public.get_public_driver_assignment(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
  v_driver_name TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE driver_assignment_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name INTO v_driver_name
  FROM public.drivers
  WHERE id = v_row.proposed_driver_id;

  RETURN jsonb_build_object(
    'found', true,
    'company_name', (SELECT COALESCE(trade_name, name) FROM public.companies WHERE id = v_row.company_id),
    'driver_name', v_driver_name,
    'driver_assignment_response', v_row.driver_assignment_response,
    'driver_assignment_sent_at', v_row.driver_assignment_sent_at,
    'can_respond', (
      v_row.driver_assignment_sent_at IS NOT NULL
      AND v_row.driver_assignment_response = 'pending'
      AND v_row.proposed_driver_id IS NOT NULL
    ),
    'order', jsonb_build_object(
      'code', v_row.code,
      'service_type', v_row.service_type,
      'service_date', v_row.service_date,
      'plate', v_row.plate,
      'client_name', v_row.client_name,
      'freight_origin_address', v_row.freight_origin_address,
      'freight_destination_address', v_row.freight_destination_address,
      'freight_agreed_amount', v_row.freight_agreed_amount,
      'service_amount', v_row.service_amount
    )
  );
END;
$$;

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
      proposed_driver_id = NULL
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'driver_assignment_response', (SELECT driver_assignment_response FROM public.service_orders WHERE id = v_row.id),
    'driver_id', (SELECT driver_id FROM public.service_orders WHERE id = v_row.id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_driver_assignment_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_driver_assignment(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_driver_assignment(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_driver_assignment(TEXT, TEXT) TO anon, authenticated;

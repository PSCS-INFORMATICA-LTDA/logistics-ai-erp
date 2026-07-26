-- Ticket público do pátio (estacionamento / lava) — link + QR + WhatsApp, sem login.

ALTER TABLE public.parking_entries
  ADD COLUMN IF NOT EXISTS public_ticket_token TEXT;

ALTER TABLE public.car_wash_services
  ADD COLUMN IF NOT EXISTS public_ticket_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_entries_public_ticket_token
  ON public.parking_entries (public_ticket_token)
  WHERE public_ticket_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_car_wash_public_ticket_token
  ON public.car_wash_services (public_ticket_token)
  WHERE public_ticket_token IS NOT NULL;

COMMENT ON COLUMN public.parking_entries.public_ticket_token IS
  'Token público do ticket (WhatsApp/QR), sem login.';
COMMENT ON COLUMN public.car_wash_services.public_ticket_token IS
  'Token público do ticket (WhatsApp/QR), sem login.';

CREATE OR REPLACE FUNCTION public.ensure_patio_ticket_token(
  p_source TEXT,
  p_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_company UUID;
BEGIN
  IF p_source IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_source = 'parking' THEN
    SELECT company_id, public_ticket_token
      INTO v_company, v_token
    FROM public.parking_entries
    WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ordem de estacionamento não encontrada';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = v_company AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Sem acesso à empresa';
    END IF;

    IF v_token IS NULL OR length(v_token) < 32 THEN
      v_token := replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '');
      UPDATE public.parking_entries
      SET public_ticket_token = v_token
      WHERE id = p_id;
    END IF;

    RETURN v_token;
  END IF;

  IF p_source = 'car_wash' THEN
    SELECT company_id, public_ticket_token
      INTO v_company, v_token
    FROM public.car_wash_services
    WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ordem de lava-rápido não encontrada';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = v_company AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Sem acesso à empresa';
    END IF;

    IF v_token IS NULL OR length(v_token) < 32 THEN
      v_token := replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '');
      UPDATE public.car_wash_services
      SET public_ticket_token = v_token
      WHERE id = p_id;
    END IF;

    RETURN v_token;
  END IF;

  RAISE EXCEPTION 'Origem inválida (use parking ou car_wash)';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_patio_ticket(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name TEXT;
  v_company_document TEXT;
  v_park public.parking_entries%ROWTYPE;
  v_wash public.car_wash_services%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_park
  FROM public.parking_entries
  WHERE public_ticket_token = trim(p_token);

  IF FOUND THEN
    SELECT COALESCE(c.trade_name, c.name), c.document
      INTO v_company_name, v_company_document
    FROM public.companies c
    WHERE c.id = v_park.company_id;

    RETURN jsonb_build_object(
      'found', true,
      'kind', 'estacionamento',
      'company_name', v_company_name,
      'company_document', v_company_document,
      'ticket', jsonb_build_object(
        'code', v_park.code,
        'plate', v_park.plate,
        'status', v_park.status,
        'billing_mode', v_park.billing_mode,
        'vehicle_type', v_park.vehicle_type,
        'client_name', v_park.client_name,
        'phone', v_park.phone,
        'entry_date', v_park.entry_date,
        'entry_time', v_park.entry_time,
        'exit_date', v_park.exit_date,
        'exit_time', v_park.exit_time,
        'period_end_date', v_park.period_end_date,
        'next_charge_date', v_park.next_charge_date,
        'daily_count', v_park.daily_count,
        'daily_rate', v_park.daily_rate,
        'total_amount', v_park.total_amount
      )
    );
  END IF;

  SELECT * INTO v_wash
  FROM public.car_wash_services
  WHERE public_ticket_token = trim(p_token);

  IF FOUND THEN
    SELECT COALESCE(c.trade_name, c.name), c.document
      INTO v_company_name, v_company_document
    FROM public.companies c
    WHERE c.id = v_wash.company_id;

    RETURN jsonb_build_object(
      'found', true,
      'kind', 'lava-rapido',
      'company_name', v_company_name,
      'company_document', v_company_document,
      'ticket', jsonb_build_object(
        'code', v_wash.code,
        'plate', v_wash.plate,
        'status', v_wash.status,
        'service_name', v_wash.service_name,
        'service_date', v_wash.service_date,
        'vehicle_type', v_wash.vehicle_type,
        'client_name', v_wash.client_name,
        'phone', v_wash.phone,
        'entry_date', v_wash.entry_date,
        'entry_time', v_wash.entry_time,
        'exit_date', v_wash.exit_date,
        'exit_time', v_wash.exit_time,
        'payment_method', v_wash.payment_method,
        'attendant', v_wash.attendant,
        'service_amount', v_wash.service_amount
      )
    );
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_patio_ticket_token(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_patio_ticket(TEXT) TO anon, authenticated;

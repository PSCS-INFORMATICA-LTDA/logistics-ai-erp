-- Nova designação após aceite e remoção dos valores comerciais do link público.
-- Não aplicar até a revisão. Não executar em PROD. Não altera ordens existentes.
--
-- Rollback: supabase/rollbacks/085_driver_reassignment_and_public_amounts.sql

CREATE TABLE IF NOT EXISTS public.service_order_driver_acceptance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  service_order_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  driver_assignment_response text NOT NULL,
  driver_assignment_accepted_at timestamptz,
  driver_assignment_pay_amount numeric,
  driver_assignment_assistant_pay_amount numeric,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid
);

ALTER TABLE public.service_order_driver_acceptance_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_order_driver_acceptance_history_select
  ON public.service_order_driver_acceptance_history;
CREATE POLICY service_order_driver_acceptance_history_select
  ON public.service_order_driver_acceptance_history
  FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()));

REVOKE ALL ON TABLE public.service_order_driver_acceptance_history FROM PUBLIC;
REVOKE ALL ON TABLE public.service_order_driver_acceptance_history FROM anon;
REVOKE ALL ON TABLE public.service_order_driver_acceptance_history FROM authenticated;
REVOKE ALL ON TABLE public.service_order_driver_acceptance_history FROM service_role;
GRANT SELECT ON TABLE public.service_order_driver_acceptance_history TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_service_order_direct_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated', 'service_role') THEN
    IF NEW.status = 'Concluido' AND OLD.status IS DISTINCT FROM 'Concluido' THEN
      RAISE EXCEPTION 'A conclusão da ordem só pode ser feita pelo fluxo oficial';
    END IF;

    IF OLD.status = 'Cancelado' AND NEW.status IS DISTINCT FROM 'Cancelado' THEN
      RAISE EXCEPTION 'Ordem cancelada não pode ser alterada por atualização direta';
    END IF;

    IF public.service_order_driver_confirmed(OLD.driver_id, OLD.driver_assignment_response)
       AND NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      RAISE EXCEPTION 'Motorista confirmado só pode ser substituído por uma nova designação';
    END IF;

    IF NEW.driver_assignment_response IS DISTINCT FROM OLD.driver_assignment_response
       OR NEW.driver_assignment_accepted_at IS DISTINCT FROM OLD.driver_assignment_accepted_at
       OR NEW.driver_assignment_rejected_at IS DISTINCT FROM OLD.driver_assignment_rejected_at
       OR NEW.driver_assignment_sent_at IS DISTINCT FROM OLD.driver_assignment_sent_at
       OR NEW.driver_assignment_token IS DISTINCT FROM OLD.driver_assignment_token
       OR NEW.proposed_driver_id IS DISTINCT FROM OLD.proposed_driver_id
       OR NEW.driver_assignment_rejected_driver_ids IS DISTINCT FROM OLD.driver_assignment_rejected_driver_ids
    THEN
      RAISE EXCEPTION 'A designação do motorista só pode ser alterada pelo fluxo oficial';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM authenticated;

CREATE OR REPLACE FUNCTION public.reassign_accepted_service_order_driver(
  p_order_id uuid,
  p_driver_id uuid,
  p_driver_pay_amount numeric,
  p_assistant_pay_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
  v_token text;
  v_history_id uuid;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'Motorista não informado';
  END IF;

  IF p_driver_pay_amount IS NULL OR p_driver_pay_amount <= 0 THEN
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

  IF v_row.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Ordem de serviço cancelada';
  END IF;

  IF v_row.status = 'Concluido' THEN
    RAISE EXCEPTION 'Ordem de serviço já concluída';
  END IF;

  IF NOT public.service_order_driver_confirmed(v_row.driver_id, v_row.driver_assignment_response) THEN
    RAISE EXCEPTION 'Não há motorista confirmado para substituir';
  END IF;

  IF p_driver_id = v_row.driver_id THEN
    RAISE EXCEPTION 'Escolha outro motorista para a nova designação';
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

  INSERT INTO public.service_order_driver_acceptance_history (
    company_id,
    service_order_id,
    driver_id,
    driver_assignment_response,
    driver_assignment_accepted_at,
    driver_assignment_pay_amount,
    driver_assignment_assistant_pay_amount,
    replaced_by
  ) VALUES (
    v_row.company_id,
    v_row.id,
    v_row.driver_id,
    v_row.driver_assignment_response,
    v_row.driver_assignment_accepted_at,
    v_row.driver_assignment_pay_amount,
    v_row.driver_assignment_assistant_pay_amount,
    auth.uid()
  )
  RETURNING id INTO v_history_id;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  UPDATE public.service_orders
  SET
    driver_assignment_token = v_token,
    proposed_driver_id = p_driver_id,
    driver_id = NULL,
    driver_assignment_response = 'pending',
    driver_assignment_sent_at = now(),
    driver_assignment_accepted_at = NULL,
    driver_assignment_rejected_at = NULL,
    driver_assignment_pay_amount = p_driver_pay_amount,
    driver_assignment_assistant_pay_amount = NULLIF(p_assistant_pay_amount, 0)
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'history_id', v_history_id,
    'previous_driver_id', v_row.driver_id,
    'previous_accepted_at', v_row.driver_assignment_accepted_at,
    'token', v_token,
    'proposed_driver_id', p_driver_id,
    'driver_id', NULL,
    'driver_assignment_response', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_accepted_service_order_driver(uuid, uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_accepted_service_order_driver(uuid, uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_accepted_service_order_driver(uuid, uuid, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_driver_assignment(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    'driver_assignment_pay_amount', v_row.driver_assignment_pay_amount,
    'driver_assignment_assistant_pay_amount', v_row.driver_assignment_assistant_pay_amount,
    'can_respond', (
      v_row.driver_assignment_sent_at IS NOT NULL
      AND v_row.driver_assignment_response = 'pending'
      AND v_row.proposed_driver_id IS NOT NULL
    ),
    'order', jsonb_build_object(
      'code', v_row.code,
      'service_type', v_row.service_type,
      'service_date', v_row.service_date,
      'entry_date', v_row.entry_date,
      'entry_time', v_row.entry_time,
      'exit_date', v_row.exit_date,
      'exit_time', v_row.exit_time,
      'plate', v_row.plate,
      'client_name', v_row.client_name,
      'freight_origin_address', v_row.freight_origin_address,
      'freight_destination_address', v_row.freight_destination_address,
      'freight_distance_km', v_row.freight_distance_km,
      'freight_toll_amount', v_row.freight_toll_amount
    )
  );
END;
$function$;

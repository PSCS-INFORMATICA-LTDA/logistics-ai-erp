-- Rollback da migration 085.
-- Restaura o gatilho da 084 e o JSON público da 083.
-- Remove a função de nova designação.
-- Preserva a tabela de histórico quando ela já tem registros.
-- Não devolve TRUNCATE nem EXECUTE de seed_drivers.

DROP FUNCTION IF EXISTS public.reassign_accepted_service_order_driver(uuid, uuid, numeric, numeric);

DO $$
BEGIN
  IF to_regclass('public.service_order_driver_acceptance_history') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.service_order_driver_acceptance_history) THEN
    RAISE NOTICE 'Histórico preservado; a tabela não foi removida.';
    RETURN;
  END IF;

  DROP TABLE public.service_order_driver_acceptance_history;
END $$;

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
      'freight_toll_amount', v_row.freight_toll_amount,
      'freight_agreed_amount', v_row.freight_agreed_amount,
      'service_amount', v_row.service_amount
    )
  );
END;
$function$;

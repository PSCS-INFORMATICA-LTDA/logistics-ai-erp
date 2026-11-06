-- Segurança da OS, sem mudar assinatura das funções públicas.
-- Não aplicar até a revisão. Não executar em PROD.
--
-- Rollback seguro: remover só o gatilho e a função de guarda, e restaurar
-- complete_service_order, respond_to_driver_assignment e
-- confirm_service_order_driver_without_link a partir da migration 080
-- e do corpo anterior à 084.
-- Não devolver TRUNCATE a authenticated ou service_role.
-- Não devolver EXECUTE de seed_drivers a anon, PUBLIC ou authenticated.
--
-- Histórico aplicado no DEV (jmbajdpkvlrslirwzyze), versão 20261105145223:
-- o REVOKE de seed_drivers era incondicional. A função existe no DEV, então
-- o efeito daquela execução é o mesmo deste arquivo. Não reaplicar no DEV.
-- PROD (tqeenmswotxqainkyyct) não tem public.seed_drivers(uuid). O REVOKE
-- incondicional aborta 084 antes dos gatilhos. A revisão abaixo só torna
-- essa revogação condicional. Os outros REVOKE/GRANT de 080–085 permanecem:
-- o alvo já existe em PROD ou é criado antes do comando, na mesma cadeia.
--
-- Se o formulário não conseguir marcar Concluido ou reabrir uma ordem
-- Cancelado, a alternativa é o fluxo oficial: complete_service_order para
-- concluir, e uma RPC futura para reabrir. Não desfazer o gatilho para isso.

REVOKE TRUNCATE ON TABLE public.service_orders FROM PUBLIC;
REVOKE TRUNCATE ON TABLE public.service_orders FROM anon;
REVOKE TRUNCATE ON TABLE public.service_orders FROM authenticated;
REVOKE TRUNCATE ON TABLE public.service_orders FROM service_role;

REVOKE ALL ON FUNCTION public._assert_service_order_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._assert_service_order_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._assert_service_order_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ensure_driver_assignment_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_driver_assignment_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_driver_assignment_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ensure_proposal_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_proposal_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_proposal_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_driver_payment_paid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_driver_payment_paid(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_driver_payment_paid(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_proposal_sent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_proposal_sent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_proposal_sent(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_proposal_follow_up(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_proposal_follow_up(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_proposal_follow_up(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_driver_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_driver_assignment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_driver_assignment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.send_driver_assignment(uuid, uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_driver_assignment(uuid, uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_driver_assignment(uuid, uuid, numeric, numeric) TO authenticated;

-- O aplicativo não chama seed_drivers. A função grava motoristas na empresa
-- recebida sem conferir o usuário. Quando existir, fica restrita ao service_role.
-- to_regprocedure devolve NULL se a assinatura não existe e não aborta a transação.
-- BEGIN seed_drivers revoke
DO $revoke_seed_drivers$
BEGIN
  IF to_regprocedure('public.seed_drivers(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.seed_drivers(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.seed_drivers(uuid) FROM anon;
    REVOKE ALL ON FUNCTION public.seed_drivers(uuid) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO service_role;
  END IF;
END
$revoke_seed_drivers$;
-- END seed_drivers revoke

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

REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_service_order_direct_confirmation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_service_orders_guard_direct_confirmation ON public.service_orders;
CREATE TRIGGER trg_service_orders_guard_direct_confirmation
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_order_direct_confirmation();

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

  IF v_row.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Ordem de serviço cancelada';
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

CREATE OR REPLACE FUNCTION public.respond_to_driver_assignment(p_token text, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF v_row.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Ordem de serviço cancelada';
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

  IF v_row.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Ordem de serviço cancelada';
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

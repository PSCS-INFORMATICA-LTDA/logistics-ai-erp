-- Complementar à 086. Não aplicar neste comando.
-- A baixa do motorista e os RPCs financeiros sem checagem de papel
-- deixam de ser executáveis por anon ou por operacional.
-- Admin e financeiro da própria empresa continuam autorizados.
-- Não reaplicar 086.

CREATE OR REPLACE FUNCTION public.mark_driver_payment_paid(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.service_orders%ROWTYPE;
  v_motorista_account_id UUID;
  v_ajudante_account_id UUID;
  v_driver_tx_id UUID;
  v_assistant_tx_id UUID;
  v_assistant_amount NUMERIC;
  v_driver_name TEXT;
BEGIN
  PERFORM public._assert_service_order_member(p_order_id);

  IF NOT public.auth_user_can_access_company_finance(
    (SELECT company_id FROM public.service_orders WHERE id = p_order_id)
  ) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada';
  END IF;

  IF v_row.driver_id IS NULL OR v_row.driver_assignment_response <> 'accepted' THEN
    RAISE EXCEPTION 'Motorista ainda não confirmou a designação';
  END IF;

  IF v_row.driver_assignment_pay_amount IS NULL OR v_row.driver_assignment_pay_amount <= 0 THEN
    RAISE EXCEPTION 'Esta OS não possui valor de pagamento ao motorista';
  END IF;

  IF v_row.driver_payment_paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento já registrado para esta OS';
  END IF;

  SELECT id INTO v_motorista_account_id
  FROM public.chart_of_accounts
  WHERE company_id = v_row.company_id
    AND name = 'Motorista'
    AND status = 'Ativo'
  LIMIT 1;

  IF v_motorista_account_id IS NULL THEN
    RAISE EXCEPTION 'Conta DRE «Motorista» não encontrada. Importe o plano de contas (Contas DRE).';
  END IF;

  SELECT id INTO v_ajudante_account_id
  FROM public.chart_of_accounts
  WHERE company_id = v_row.company_id
    AND name = 'Ajudante'
    AND status = 'Ativo'
  LIMIT 1;

  SELECT name INTO v_driver_name FROM public.drivers WHERE id = v_row.driver_id;

  v_assistant_amount := COALESCE(v_row.driver_assignment_assistant_pay_amount, 0);

  INSERT INTO public.financial_transactions (
    company_id,
    transaction_date,
    amount,
    chart_of_account_id,
    classification,
    transaction_type,
    service_date,
    driver_id,
    service_order_id,
    description,
    approval_status,
    submitted_at
  )
  VALUES (
    v_row.company_id,
    CURRENT_DATE,
    v_row.driver_assignment_pay_amount,
    v_motorista_account_id,
    'Operacional',
    'Despesa',
    v_row.service_date,
    v_row.driver_id,
    v_row.id,
    format('OS %s — pagamento motorista (%s)', v_row.code, COALESCE(v_driver_name, '—')),
    'approved',
    NOW()
  )
  RETURNING id INTO v_driver_tx_id;

  IF v_assistant_amount > 0 THEN
    IF v_ajudante_account_id IS NULL THEN
      RAISE EXCEPTION 'Conta DRE «Ajudante» não encontrada. Importe o plano de contas (Contas DRE).';
    END IF;

    INSERT INTO public.financial_transactions (
      company_id,
      transaction_date,
      amount,
      chart_of_account_id,
      classification,
      transaction_type,
      service_date,
      driver_id,
      service_order_id,
      description,
      approval_status,
      submitted_at
    )
    VALUES (
      v_row.company_id,
      CURRENT_DATE,
      v_assistant_amount,
      v_ajudante_account_id,
      'Operacional',
      'Despesa',
      v_row.service_date,
      v_row.driver_id,
      v_row.id,
      format('OS %s — pagamento ajudante (%s)', v_row.code, COALESCE(v_driver_name, '—')),
      'approved',
      NOW()
    )
    RETURNING id INTO v_assistant_tx_id;
  END IF;

  UPDATE public.service_orders
  SET
    driver_payment_paid_at = NOW(),
    driver_payment_driver_transaction_id = v_driver_tx_id,
    driver_payment_assistant_transaction_id = v_assistant_tx_id
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'driver_payment_paid_at', NOW(),
    'order_id', p_order_id,
    'driver_transaction_id', v_driver_tx_id,
    'assistant_transaction_id', v_assistant_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_driver_payment_paid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_driver_payment_paid(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_driver_payment_paid(uuid) TO authenticated;

-- Helpers internos: a função pública passa a exigir papel financeiro
-- e a implementação antiga deixa de ser chamável pelo cliente.
ALTER FUNCTION public._ap_post_competence(uuid) RENAME TO _ap_post_competence_impl;
ALTER FUNCTION public.recalc_accounts_payable_balances(uuid) RENAME TO recalc_accounts_payable_balances_impl;
ALTER FUNCTION public.seed_dashboard_demo(uuid) RENAME TO seed_dashboard_demo_impl;

CREATE FUNCTION public._ap_post_competence(p_payable_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.accounts_payable
  WHERE id = p_payable_id;

  IF NOT public.auth_user_can_access_company_finance(v_company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;

  RETURN public._ap_post_competence_impl(p_payable_id);
END;
$$;

CREATE FUNCTION public.recalc_accounts_payable_balances(p_payable_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.accounts_payable
  WHERE id = p_payable_id;

  IF NOT public.auth_user_can_access_company_finance(v_company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;

  PERFORM public.recalc_accounts_payable_balances_impl(p_payable_id);
END;
$$;

CREATE FUNCTION public.seed_dashboard_demo(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso administrativo à empresa';
  END IF;

  RETURN public.seed_dashboard_demo_impl(p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public._ap_post_competence_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ap_post_competence_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._ap_post_competence_impl(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._ap_post_competence_impl(uuid) TO postgres;

REVOKE ALL ON FUNCTION public.recalc_accounts_payable_balances_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_accounts_payable_balances_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recalc_accounts_payable_balances_impl(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_accounts_payable_balances_impl(uuid) TO postgres;

REVOKE ALL ON FUNCTION public.seed_dashboard_demo_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_dashboard_demo_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.seed_dashboard_demo_impl(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seed_dashboard_demo_impl(uuid) TO postgres;

REVOKE ALL ON FUNCTION public._ap_post_competence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ap_post_competence(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._ap_post_competence(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.recalc_accounts_payable_balances(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_accounts_payable_balances(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalc_accounts_payable_balances(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.seed_dashboard_demo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_dashboard_demo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.seed_dashboard_demo(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_patio_dre_accounts(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_can_access_company_finance(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;

  INSERT INTO public.chart_of_accounts (company_id, name, classification, transaction_type, status)
  VALUES
    (p_company_id, 'Receita Estacionamento', 'Receitas', 'Receita', 'Ativo'),
    (p_company_id, 'Receita Lava Rápido', 'Receitas', 'Receita', 'Ativo')
  ON CONFLICT (company_id, name) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_vehicle_expense_accounts(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_can_access_company_finance(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;

  INSERT INTO public.chart_of_accounts (company_id, name, classification, transaction_type, status)
  VALUES
    (p_company_id, 'Pneus', 'Operacional', 'Despesa', 'Ativo'),
    (p_company_id, 'Pedágio', 'Administrativo', 'Despesa', 'Ativo'),
    (p_company_id, 'Posto de Combustível', 'Administrativo', 'Despesa', 'Ativo'),
    (p_company_id, 'Manutenção de bens', 'Operacional', 'Despesa', 'Ativo')
  ON CONFLICT (company_id, name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_patio_dre_accounts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_patio_dre_accounts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_patio_dre_accounts(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ensure_vehicle_expense_accounts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_vehicle_expense_accounts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_vehicle_expense_accounts(uuid) TO authenticated;

-- Estas funções já validam empresa e papel financeiro via _ap_assert_company_member.
-- O GRANT residual de anon é removido. authenticated permanece.
REVOKE ALL ON FUNCTION public.approve_accounts_payable(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_accounts_payable(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_accounts_payable(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_accounts_payable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_accounts_payable_payment(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_postings(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seed_patio_defaults(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seed_patio_rotativo_defaults(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_accounts_payable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_accounts_payable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_accounts_payable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_accounts_payable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_accounts_payable_payment(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_postings(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_patio_defaults(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_patio_rotativo_defaults(uuid) TO authenticated;

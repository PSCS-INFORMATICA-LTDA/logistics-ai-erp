-- RPCs e triggers Contas a Pagar Fase 1
-- Aprovação SOMENTE via RPC transacional (não UPDATE solto do frontend para approved+post).

-- ---------------------------------------------------------------------------
-- Helpers multiempresa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_assert_company_member(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR NOT public.auth_user_has_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso à empresa';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._ap_user_display_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public._ap_can_approve(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT COALESCE(ap_approver_mode, 'admin')
  INTO v_mode
  FROM public.company_financial_approval_settings
  WHERE company_id = p_company_id;

  v_mode := COALESCE(v_mode, 'admin');

  -- MVP: admin da empresa (admin_or_master / master_only tratados como admin no banco;
  -- Máster adicional fica na UI quando necessário).
  IF v_mode IN ('admin', 'admin_or_master', 'master_only') THEN
    RETURN public.auth_user_is_company_admin(p_company_id);
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_accounts_payable_balances(p_payable_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid NUMERIC(14,2);
  v_net NUMERIC(14,2);
  v_status TEXT;
  v_approval TEXT;
  r RECORD;
  v_inst_paid NUMERIC(14,2);
BEGIN
  SELECT net_amount, approval_status, status
  INTO v_net, v_approval, v_status
  FROM public.accounts_payable
  WHERE id = p_payable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Título AP não encontrado';
  END IF;

  IF v_status = 'cancelled' OR v_status = 'suspended' THEN
    -- ainda recalcula paid/open para consistência
    NULL;
  END IF;

  FOR r IN
    SELECT id, amount
    FROM public.accounts_payable_installments
    WHERE accounts_payable_id = p_payable_id
      AND status <> 'cancelled'
  LOOP
    SELECT COALESCE(SUM(principal_amount), 0)
    INTO v_inst_paid
    FROM public.accounts_payable_payments
    WHERE installment_id = r.id
      AND reversed_at IS NULL;

    UPDATE public.accounts_payable_installments
    SET paid_amount = v_inst_paid,
        open_balance = r.amount - v_inst_paid,
        status = CASE
          WHEN v_inst_paid <= 0 THEN 'open'
          WHEN v_inst_paid >= r.amount THEN 'paid'
          ELSE 'partially_paid'
        END,
        updated_at = NOW()
    WHERE id = r.id;
  END LOOP;

  SELECT COALESCE(SUM(principal_amount), 0)
  INTO v_paid
  FROM public.accounts_payable_payments
  WHERE accounts_payable_id = p_payable_id
    AND reversed_at IS NULL;

  IF v_status NOT IN ('cancelled', 'suspended') AND v_approval = 'approved' THEN
    v_status := CASE
      WHEN v_paid <= 0 THEN 'open'
      WHEN v_paid >= v_net THEN 'paid'
      ELSE 'partially_paid'
    END;
  END IF;

  UPDATE public.accounts_payable
  SET paid_amount = v_paid,
      open_balance = v_net - v_paid,
      status = v_status,
      updated_at = NOW()
  WHERE id = p_payable_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Validação pré-aprovação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_validate_ready_for_approval(p_payable_id UUID)
RETURNS public.accounts_payable
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_sum_inst NUMERIC(14,2);
  v_sum_alloc NUMERIC(14,2);
  v_cnt_inst INTEGER;
  v_cnt_alloc INTEGER;
  v_chart_company UUID;
  v_coa UUID;
  r RECORD;
BEGIN
  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Título AP não encontrado';
  END IF;

  PERFORM public._ap_assert_company_member(v_ap.company_id);

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_cnt_inst, v_sum_inst
  FROM public.accounts_payable_installments
  WHERE accounts_payable_id = p_payable_id
    AND status <> 'cancelled';

  IF v_cnt_inst < 1 THEN
    RAISE EXCEPTION 'Título sem parcelas';
  END IF;
  IF v_sum_inst <> v_ap.net_amount THEN
    RAISE EXCEPTION 'Soma das parcelas (%) diferente de net_amount (%)', v_sum_inst, v_ap.net_amount;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts_payable_installments
    WHERE accounts_payable_id = p_payable_id
      AND status <> 'cancelled'
      AND (amount IS NULL OR amount <= 0 OR due_date IS NULL)
  ) THEN
    RAISE EXCEPTION 'Parcela com valor ou vencimento inválido';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_cnt_alloc, v_sum_alloc
  FROM public.accounts_payable_allocations
  WHERE accounts_payable_id = p_payable_id;

  IF v_cnt_alloc < 1 THEN
    RAISE EXCEPTION 'Título sem rateio';
  END IF;
  IF v_sum_alloc <> v_ap.net_amount THEN
    RAISE EXCEPTION 'Soma dos rateios (%) diferente de net_amount (%)', v_sum_alloc, v_ap.net_amount;
  END IF;

  -- Conta DRE do cabeçalho
  SELECT company_id INTO v_chart_company
  FROM public.chart_of_accounts WHERE id = v_ap.chart_of_account_id;
  IF v_chart_company IS DISTINCT FROM v_ap.company_id THEN
    RAISE EXCEPTION 'Conta DRE de outra empresa';
  END IF;

  -- Favorecidos / dimensões mesma empresa
  IF v_ap.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_ap.supplier_id AND s.company_id = v_ap.company_id AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Fornecedor inválido ou de outra empresa'; END IF;

  IF v_ap.driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_ap.driver_id AND d.company_id = v_ap.company_id AND d.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Motorista inválido ou de outra empresa'; END IF;

  IF v_ap.partner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partners p
    WHERE p.id = v_ap.partner_id AND p.company_id = v_ap.company_id AND p.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Sócio inválido ou de outra empresa'; END IF;

  IF v_ap.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = v_ap.client_id AND c.company_id = v_ap.company_id AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Cliente inválido ou de outra empresa'; END IF;

  IF v_ap.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_ap.branch_id AND b.company_id = v_ap.company_id
  ) THEN RAISE EXCEPTION 'Filial inválida ou de outra empresa'; END IF;

  FOR r IN
    SELECT * FROM public.accounts_payable_allocations WHERE accounts_payable_id = p_payable_id
  LOOP
    IF r.company_id IS DISTINCT FROM v_ap.company_id THEN
      RAISE EXCEPTION 'Rateio com company_id divergente';
    END IF;
    v_coa := COALESCE(r.chart_of_account_id, v_ap.chart_of_account_id);
    IF v_coa IS NULL THEN
      RAISE EXCEPTION 'Rateio sem conta DRE efetiva';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts ca
      WHERE ca.id = v_coa AND ca.company_id = v_ap.company_id AND ca.transaction_type = 'Despesa'
    ) THEN
      RAISE EXCEPTION 'Conta DRE efetiva inválida no rateio';
    END IF;
    IF r.vehicle_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = r.vehicle_id AND v.company_id = v_ap.company_id AND v.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Veículo do rateio inválido'; END IF;
    IF r.driver_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = r.driver_id AND d.company_id = v_ap.company_id AND d.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Motorista do rateio inválido'; END IF;
    IF r.service_order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.service_orders so
      WHERE so.id = r.service_order_id AND so.company_id = v_ap.company_id
    ) THEN RAISE EXCEPTION 'OS do rateio inválida'; END IF;
    IF r.branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = r.branch_id AND b.company_id = v_ap.company_id
    ) THEN RAISE EXCEPTION 'Filial do rateio inválida'; END IF;
  END LOOP;

  RETURN v_ap;
END;
$$;

-- ---------------------------------------------------------------------------
-- Postagem DRE (interna)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_post_competence(p_payable_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  r RECORD;
  v_coa UUID;
  v_class TEXT;
  v_ft_id UUID;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_ap FROM public.accounts_payable WHERE id = p_payable_id FOR UPDATE;

  FOR r IN
    SELECT * FROM public.accounts_payable_allocations
    WHERE accounts_payable_id = p_payable_id
    ORDER BY line_no
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.accounts_payable_postings p
      WHERE p.allocation_id = r.id
        AND p.posting_type = 'competence'
        AND p.reversed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Postagem já existe para rateio %', r.id;
    END IF;

    v_coa := COALESCE(r.chart_of_account_id, v_ap.chart_of_account_id);
    SELECT classification INTO v_class
    FROM public.chart_of_accounts WHERE id = v_coa;

    INSERT INTO public.financial_transactions (
      company_id,
      branch_id,
      transaction_date,
      amount,
      chart_of_account_id,
      classification,
      transaction_type,
      client_id,
      supplier_id,
      driver_id,
      operational_vehicle_id,
      allocation_vehicle_id,
      service_order_id,
      description,
      entry_source,
      approval_status,
      created_by,
      updated_by
    ) VALUES (
      v_ap.company_id,
      COALESCE(r.branch_id, v_ap.branch_id),
      v_ap.competence_date,
      r.amount,
      v_coa,
      COALESCE(v_class, 'Operacional'),
      'Despesa',
      v_ap.client_id,
      v_ap.supplier_id,
      COALESCE(r.driver_id, v_ap.driver_id),
      r.vehicle_id,
      r.vehicle_id,
      r.service_order_id,
      v_ap.internal_number || ' — ' || v_ap.description,
      'accounts_payable',
      'approved',
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_ft_id;

    INSERT INTO public.accounts_payable_postings (
      company_id,
      accounts_payable_id,
      allocation_id,
      financial_transaction_id,
      posting_type,
      created_by,
      updated_by
    ) VALUES (
      v_ap.company_id,
      v_ap.id,
      r.id,
      v_ft_id,
      'competence',
      auth.uid(),
      auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Aprovar AP (RPC pública)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_accounts_payable(
  p_payable_id UUID,
  p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_settings public.company_financial_approval_settings%ROWTYPE;
  v_posted INTEGER;
BEGIN
  v_ap := public._ap_validate_ready_for_approval(p_payable_id);

  IF v_ap.approval_status = 'approved' THEN
    RAISE EXCEPTION 'Título já aprovado';
  END IF;
  IF v_ap.status = 'cancelled' THEN
    RAISE EXCEPTION 'Título cancelado';
  END IF;
  IF v_ap.approval_status NOT IN ('draft', 'submitted', 'rejected') THEN
    RAISE EXCEPTION 'Status de aprovação inválido para aprovar';
  END IF;

  SELECT * INTO v_settings
  FROM public.company_financial_approval_settings
  WHERE company_id = v_ap.company_id;

  IF COALESCE(v_settings.ap_approval_enabled, FALSE) THEN
    IF v_ap.approval_status <> 'submitted'
       AND NOT (
         v_settings.ap_auto_approve_below_amount IS NOT NULL
         AND v_ap.net_amount < v_settings.ap_auto_approve_below_amount
       )
    THEN
      IF v_ap.approval_status = 'draft' THEN
        RAISE EXCEPTION 'Envie o título para aprovação antes de aprovar';
      END IF;
    END IF;
    IF NOT public._ap_can_approve(v_ap.company_id) THEN
      RAISE EXCEPTION 'Usuário sem permissão para aprovar Contas a Pagar';
    END IF;
  ELSE
    -- aprovação desligada: qualquer membro da empresa pode “aprovar/finalizar”
    PERFORM public._ap_assert_company_member(v_ap.company_id);
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'approved',
      status = CASE WHEN status IN ('suspended', 'cancelled') THEN status ELSE 'open' END,
      reviewed_by = auth.uid(),
      reviewed_by_name = public._ap_user_display_name(),
      reviewed_at = NOW(),
      review_note = NULLIF(btrim(COALESCE(p_review_note, '')), ''),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payable_id;

  v_posted := public._ap_post_competence(p_payable_id);

  RETURN jsonb_build_object(
    'ok', true,
    'accounts_payable_id', p_payable_id,
    'postings', v_posted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_accounts_payable(p_payable_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_enabled BOOLEAN;
  v_auto NUMERIC(14,2);
BEGIN
  v_ap := public._ap_validate_ready_for_approval(p_payable_id);

  IF v_ap.approval_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Somente rascunho ou rejeitado pode ser enviado';
  END IF;

  SELECT COALESCE(ap_approval_enabled, FALSE), ap_auto_approve_below_amount
  INTO v_enabled, v_auto
  FROM public.company_financial_approval_settings
  WHERE company_id = v_ap.company_id;

  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN public.approve_accounts_payable(p_payable_id, 'Aprovação automática (desligada na empresa)');
  END IF;

  IF v_auto IS NOT NULL AND v_ap.net_amount < v_auto THEN
    UPDATE public.accounts_payable
    SET approval_status = 'submitted',
        submitted_by = auth.uid(),
        submitted_at = NOW(),
        updated_by = auth.uid()
    WHERE id = p_payable_id;
    RETURN public.approve_accounts_payable(p_payable_id, 'Auto-aprovado por alçada');
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'submitted',
      submitted_by = auth.uid(),
      submitted_at = NOW(),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true, 'approval_status', 'submitted');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_accounts_payable(
  p_payable_id UUID,
  p_review_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
BEGIN
  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);
  IF NOT public._ap_can_approve(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem permissão para rejeitar';
  END IF;
  IF v_ap.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Somente títulos enviados podem ser rejeitados';
  END IF;
  IF p_review_note IS NULL OR btrim(p_review_note) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição';
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_by_name = public._ap_user_display_name(),
      reviewed_at = NOW(),
      review_note = btrim(p_review_note),
      updated_by = auth.uid()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true, 'approval_status', 'rejected');
END;
$$;

-- ---------------------------------------------------------------------------
-- Pagamento + estorno
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_accounts_payable_payment(
  p_installment_id UUID,
  p_financial_account_id UUID,
  p_paid_at DATE,
  p_principal_amount NUMERIC,
  p_interest_amount NUMERIC DEFAULT 0,
  p_penalty_amount NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'Pix',
  p_bank_ref TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst public.accounts_payable_installments%ROWTYPE;
  v_ap public.accounts_payable%ROWTYPE;
  v_acc public.company_financial_accounts%ROWTYPE;
  v_total NUMERIC(14,2);
  v_pay_id UUID;
BEGIN
  SELECT * INTO v_inst
  FROM public.accounts_payable_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = v_inst.accounts_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado'; END IF;

  PERFORM public._ap_assert_company_member(v_ap.company_id);

  IF v_ap.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Só é possível pagar título aprovado';
  END IF;
  IF v_ap.status IN ('cancelled', 'suspended') THEN
    RAISE EXCEPTION 'Título cancelado ou suspenso';
  END IF;
  IF v_inst.status = 'cancelled' THEN
    RAISE EXCEPTION 'Parcela cancelada';
  END IF;

  SELECT * INTO v_acc
  FROM public.company_financial_accounts
  WHERE id = p_financial_account_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta financeira não encontrada'; END IF;
  IF v_acc.company_id IS DISTINCT FROM v_ap.company_id
     OR v_inst.company_id IS DISTINCT FROM v_ap.company_id THEN
    RAISE EXCEPTION 'Empresa divergente entre título, parcela e conta financeira';
  END IF;
  IF NOT v_acc.is_active THEN
    RAISE EXCEPTION 'Conta financeira inativa';
  END IF;

  p_principal_amount := COALESCE(p_principal_amount, 0);
  p_interest_amount := COALESCE(p_interest_amount, 0);
  p_penalty_amount := COALESCE(p_penalty_amount, 0);
  p_discount_amount := COALESCE(p_discount_amount, 0);

  IF p_principal_amount < 0 OR p_interest_amount < 0
     OR p_penalty_amount < 0 OR p_discount_amount < 0 THEN
    RAISE EXCEPTION 'Valores do pagamento não podem ser negativos';
  END IF;
  IF p_principal_amount <= 0 THEN
    RAISE EXCEPTION 'principal_amount deve ser maior que zero';
  END IF;
  IF p_principal_amount > v_inst.open_balance THEN
    RAISE EXCEPTION 'principal_amount (%) excede saldo da parcela (%)',
      p_principal_amount, v_inst.open_balance;
  END IF;

  v_total := p_principal_amount + p_interest_amount + p_penalty_amount - p_discount_amount;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total_paid_amount deve ser maior que zero (desconto não pode zerar/negativar a saída)';
  END IF;

  INSERT INTO public.accounts_payable_payments (
    company_id,
    accounts_payable_id,
    installment_id,
    paid_at,
    principal_amount,
    interest_amount,
    penalty_amount,
    discount_amount,
    total_paid_amount,
    financial_account_id,
    payment_method,
    bank_ref,
    notes,
    created_by,
    updated_by
  ) VALUES (
    v_ap.company_id,
    v_ap.id,
    v_inst.id,
    COALESCE(p_paid_at, CURRENT_DATE),
    p_principal_amount,
    p_interest_amount,
    p_penalty_amount,
    p_discount_amount,
    v_total,
    v_acc.id,
    COALESCE(NULLIF(btrim(p_payment_method), ''), 'Pix'),
    p_bank_ref,
    p_notes,
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO v_pay_id;

  PERFORM public.recalc_accounts_payable_balances(v_ap.id);

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'total_paid_amount', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_accounts_payable_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.accounts_payable_payments%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo do estorno obrigatório';
  END IF;

  SELECT * INTO v_pay
  FROM public.accounts_payable_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_pay.company_id);
  IF v_pay.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento já estornado';
  END IF;

  UPDATE public.accounts_payable_payments
  SET reversed_at = NOW(),
      reversal_reason = btrim(p_reason),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payment_id;

  PERFORM public.recalc_accounts_payable_balances(v_pay.accounts_payable_id);

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id);
END;
$$;

-- Estorno de postagens DRE: cancela FT (amount > 0 no schema; não gera receita)
CREATE OR REPLACE FUNCTION public.reverse_accounts_payable_postings(
  p_payable_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo obrigatório';
  END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);
  IF NOT public._ap_can_approve(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem permissão para estornar postagens';
  END IF;

  FOR r IN
    SELECT * FROM public.accounts_payable_postings
    WHERE accounts_payable_id = p_payable_id
      AND posting_type = 'competence'
      AND reversed_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.financial_transactions
    SET approval_status = 'cancelled',
        review_note = COALESCE(review_note || ' | ', '') || 'Estorno AP: ' || btrim(p_reason),
        reviewed_at = NOW(),
        reviewed_by = auth.uid(),
        updated_by = auth.uid(),
        updated_at = NOW()
    WHERE id = r.financial_transaction_id;

    UPDATE public.accounts_payable_postings
    SET reversed_at = NOW(),
        reversal_reason = btrim(p_reason),
        updated_by = auth.uid()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reversed_postings', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_accounts_payable(
  p_payable_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_active_pay INTEGER;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo do cancelamento obrigatório';
  END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);

  SELECT COUNT(*) INTO v_active_pay
  FROM public.accounts_payable_payments
  WHERE accounts_payable_id = p_payable_id AND reversed_at IS NULL;
  IF v_active_pay > 0 THEN
    RAISE EXCEPTION 'Estorne os pagamentos ativos antes de cancelar o título';
  END IF;

  IF v_ap.approval_status = 'approved' THEN
    PERFORM public.reverse_accounts_payable_postings(p_payable_id, p_reason);
  END IF;

  UPDATE public.accounts_payable_installments
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancellation_reason = btrim(p_reason),
      updated_by = auth.uid()
  WHERE accounts_payable_id = p_payable_id
    AND status <> 'cancelled';

  UPDATE public.accounts_payable
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancellation_reason = btrim(p_reason),
      updated_by = auth.uid()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_accounts_payable(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_accounts_payable(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_accounts_payable(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_accounts_payable(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.register_accounts_payable_payment(UUID, UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_accounts_payable_payment(UUID, UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_payment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_payment(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_postings(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_postings(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_accounts_payable(UUID, TEXT) TO authenticated;

-- DEV only. Não aplicar em PROD nesta etapa.
-- Papel financeiro e admin da própria empresa acessam o financeiro.
-- Operacional e socio deixam de passar por policies permissivas de membership.
-- chart_of_accounts continua legível por qualquer membro: a OS usa o plano de contas.
-- vw_ownership_base deixa de ser security definer e deixa de ser legível por anon.

CREATE OR REPLACE FUNCTION public.auth_user_can_access_company_finance(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_company_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.company_members m
      WHERE m.user_id = auth.uid()
        AND m.company_id = p_company_id
        AND m.role IN ('admin', 'financeiro')
    );
$$;

COMMENT ON FUNCTION public.auth_user_can_access_company_finance(uuid) IS
  'True quando auth.uid() é admin ou financeiro da empresa informada.';

REVOKE ALL ON FUNCTION public.auth_user_can_access_company_finance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_can_access_company_finance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.auth_user_can_access_company_finance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._ap_assert_company_member(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_company_id IS NULL
     OR NOT public.auth_user_can_access_company_finance(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ap_assert_company_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._ap_assert_company_member(uuid) TO authenticated;

-- Substitui as policies permissivas. Policies antigas em OR continuariam abertas.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.polname, c.relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'accounts_payable',
        'accounts_payable_allocations',
        'accounts_payable_installments',
        'accounts_payable_payments',
        'accounts_payable_postings',
        'company_financial_accounts',
        'financial_transactions',
        'cash_flow_entries'
      )
      AND pol.polname NOT IN (
        'accounts_payable_payments_delete',
        'accounts_payable_postings_delete'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.relname);
  END LOOP;
END $$;

CREATE POLICY accounts_payable_select ON public.accounts_payable
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id) AND deleted_at IS NULL);
CREATE POLICY accounts_payable_insert ON public.accounts_payable
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_update ON public.accounts_payable
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_delete ON public.accounts_payable
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY accounts_payable_allocations_select ON public.accounts_payable_allocations
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_allocations_insert ON public.accounts_payable_allocations
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_allocations_update ON public.accounts_payable_allocations
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_allocations_delete ON public.accounts_payable_allocations
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY accounts_payable_installments_select ON public.accounts_payable_installments
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_installments_insert ON public.accounts_payable_installments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_installments_update ON public.accounts_payable_installments
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_installments_delete ON public.accounts_payable_installments
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY accounts_payable_payments_select ON public.accounts_payable_payments
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_payments_insert ON public.accounts_payable_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_payments_update ON public.accounts_payable_payments
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY accounts_payable_postings_select ON public.accounts_payable_postings
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_postings_insert ON public.accounts_payable_postings
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY accounts_payable_postings_update ON public.accounts_payable_postings
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY company_financial_accounts_select ON public.company_financial_accounts
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id) AND deleted_at IS NULL);
CREATE POLICY company_financial_accounts_insert ON public.company_financial_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY company_financial_accounts_update ON public.company_financial_accounts
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY company_financial_accounts_delete ON public.company_financial_accounts
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY financial_transactions_select_select ON public.financial_transactions
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY financial_transactions_insert_insert ON public.financial_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY financial_transactions_update_update ON public.financial_transactions
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY financial_transactions_delete_delete ON public.financial_transactions
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE POLICY cash_flow_entries_select_select ON public.cash_flow_entries
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY cash_flow_entries_insert_insert ON public.cash_flow_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY cash_flow_entries_update_update ON public.cash_flow_entries
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY cash_flow_entries_delete_delete ON public.cash_flow_entries
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

DROP POLICY IF EXISTS chart_of_accounts_insert_insert ON public.chart_of_accounts;
DROP POLICY IF EXISTS chart_of_accounts_update_update ON public.chart_of_accounts;
DROP POLICY IF EXISTS chart_of_accounts_delete_delete ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_insert_insert ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY chart_of_accounts_update_update ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id))
  WITH CHECK (public.auth_user_can_access_company_finance(company_id));
CREATE POLICY chart_of_accounts_delete_delete ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

DROP POLICY IF EXISTS company_fin_approval_settings_select ON public.company_financial_approval_settings;
CREATE POLICY company_fin_approval_settings_select ON public.company_financial_approval_settings
  FOR SELECT TO authenticated
  USING (public.auth_user_can_access_company_finance(company_id));

CREATE OR REPLACE FUNCTION public.soft_delete_accounts_payable(p_payable_id uuid)
RETURNS public.accounts_payable
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_active_pays int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Título não encontrado.';
  END IF;

  IF NOT public.auth_user_can_access_company_finance(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa.';
  END IF;

  IF v_ap.deleted_at IS NOT NULL THEN
    RETURN v_ap;
  END IF;

  SELECT COUNT(*) INTO v_active_pays
  FROM public.accounts_payable_payments
  WHERE accounts_payable_id = p_payable_id
    AND reversed_at IS NULL;

  IF v_active_pays > 0 THEN
    RAISE EXCEPTION 'Título com pagamento ativo não pode ser excluído. Estorne antes.';
  END IF;

  IF NOT (
    v_ap.approval_status = 'draft'
    OR v_ap.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Só é possível excluir rascunho ou título cancelado sem pagamento ativo.';
  END IF;

  UPDATE public.accounts_payable
  SET deleted_at = NOW()
  WHERE id = p_payable_id
  RETURNING * INTO v_ap;

  RETURN v_ap;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_company_financial_account(p_account_id uuid)
RETURNS public.company_financial_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.company_financial_accounts%ROWTYPE;
  v_pay_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_acc
  FROM public.company_financial_accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta financeira não encontrada.';
  END IF;

  IF NOT public.auth_user_can_access_company_finance(v_acc.company_id) THEN
    RAISE EXCEPTION 'Sem acesso financeiro à empresa.';
  END IF;

  IF v_acc.deleted_at IS NOT NULL THEN
    RETURN v_acc;
  END IF;

  SELECT COUNT(*) INTO v_pay_count
  FROM public.accounts_payable_payments
  WHERE financial_account_id = p_account_id;

  IF v_pay_count > 0 THEN
    RAISE EXCEPTION
      'Conta já utilizada em pagamento. Não é possível excluir — inative a conta.';
  END IF;

  UPDATE public.company_financial_accounts
  SET deleted_at = NOW(), is_active = FALSE
  WHERE id = p_account_id
  RETURNING * INTO v_acc;

  RETURN v_acc;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_accounts_payable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_accounts_payable(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_accounts_payable(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_company_financial_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_company_financial_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_company_financial_account(uuid) TO authenticated;

ALTER VIEW public.vw_ownership_base SET (security_invoker = true);

REVOKE ALL ON TABLE public.vw_ownership_base FROM PUBLIC;
REVOKE ALL ON TABLE public.vw_ownership_base FROM anon;
GRANT SELECT ON TABLE public.vw_ownership_base TO authenticated;

COMMENT ON VIEW public.vw_ownership_base IS
  'Resultado atribuído por sócio e veículo. security_invoker: RLS das tabelas base filtra a empresa. anon não tem SELECT.';

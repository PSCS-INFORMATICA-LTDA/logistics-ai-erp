-- Contas a Pagar — soft-delete via RPC (sem SELECT genérico de excluídos)
-- Migration: 077_ap_soft_delete_rpc.sql
--
-- Postgres 17 aplica policies SELECT ao NEW ROW de UPDATE. A 075 liberou SELECT
-- de soft-deleted para permitir o UPDATE client-side — risco de vazamento em
-- consultas sem filtro deleted_at. Esta migration:
-- 1) remove as policies amplas da 075;
-- 2) cria RPCs SECURITY DEFINER para soft-delete (bypass RLS controlado);
-- 3) restauração continua em restore_deleted_from_audit (076, já DEFINER).
-- Idempotente. Aplicar somente no DEV nesta etapa.

DROP POLICY IF EXISTS accounts_payable_select_deleted ON public.accounts_payable;
DROP POLICY IF EXISTS company_financial_accounts_select_deleted
  ON public.company_financial_accounts;

CREATE OR REPLACE FUNCTION public.soft_delete_accounts_payable(p_payable_id UUID)
RETURNS public.accounts_payable
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_active_pays INT;
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

  IF NOT public.auth_user_has_company(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem acesso à empresa.';
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

CREATE OR REPLACE FUNCTION public.soft_delete_company_financial_account(
  p_account_id UUID
)
RETURNS public.company_financial_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.company_financial_accounts%ROWTYPE;
  v_pay_count INT;
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

  IF NOT public.auth_user_has_company(v_acc.company_id) THEN
    RAISE EXCEPTION 'Sem acesso à empresa.';
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

REVOKE ALL ON FUNCTION public.soft_delete_accounts_payable(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_accounts_payable(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_company_financial_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_company_financial_account(UUID)
  TO authenticated;

COMMENT ON FUNCTION public.soft_delete_accounts_payable(UUID) IS
  'Soft-delete controlado de Contas a Pagar (SECURITY DEFINER). Não libera SELECT de excluídos.';

COMMENT ON FUNCTION public.soft_delete_company_financial_account(UUID) IS
  'Soft-delete controlado de conta financeira (SECURITY DEFINER).';

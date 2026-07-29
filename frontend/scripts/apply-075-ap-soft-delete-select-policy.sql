-- Espelho aplicável via apply-dev-migrations / psql (somente DEV).
-- Ver: supabase/migrations/075_ap_soft_delete_select_policy.sql

DROP POLICY IF EXISTS accounts_payable_select_deleted ON public.accounts_payable;
CREATE POLICY accounts_payable_select_deleted ON public.accounts_payable
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NOT NULL);

DROP POLICY IF EXISTS company_financial_accounts_select_deleted ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_select_deleted ON public.company_financial_accounts
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NOT NULL);

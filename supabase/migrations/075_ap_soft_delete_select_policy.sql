-- Contas a Pagar / Contas financeiras — soft-delete compatível com Postgres 17 RLS
-- Migration: 075_ap_soft_delete_select_policy.sql
--
-- No Postgres 17 (Supabase), policies FOR SELECT com `deleted_at IS NULL` também são
-- aplicadas ao NEW ROW de UPDATE. Isso impede soft-delete via UPDATE deleted_at.
-- Correção: policy SELECT adicional (PERMISSIVE OR) para linhas já excluídas
-- da mesma empresa. Listagens do app continuam filtrando deleted_at IS NULL.
-- Idempotente. Não alterar produção nesta etapa.

DROP POLICY IF EXISTS accounts_payable_select_deleted ON public.accounts_payable;
CREATE POLICY accounts_payable_select_deleted ON public.accounts_payable
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NOT NULL);

DROP POLICY IF EXISTS company_financial_accounts_select_deleted ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_select_deleted ON public.company_financial_accounts
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NOT NULL);

-- Aplicar no SQL Editor do Supabase (produção / desenvolvimento)
-- Equivalente: supabase/migrations/038_vehicle_expenses.sql

CREATE OR REPLACE FUNCTION public.ensure_vehicle_expense_accounts(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chart_of_accounts (company_id, name, classification, transaction_type, status)
  VALUES
    (p_company_id, 'Pneus', 'Operacional', 'Despesa', 'Ativo'),
    (p_company_id, 'Pedágio', 'Administrativo', 'Despesa', 'Ativo'),
    (p_company_id, 'Posto de Combustível', 'Administrativo', 'Despesa', 'Ativo'),
    (p_company_id, 'Manutenção de bens', 'Operacional', 'Despesa', 'Ativo')
  ON CONFLICT (company_id, name) DO NOTHING;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.ensure_vehicle_expense_accounts(r.id);
  END LOOP;
END;
$$;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS entry_source TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_vehicle_expense
  ON public.financial_transactions (company_id, allocation_vehicle_id, transaction_date DESC)
  WHERE allocation_vehicle_id IS NOT NULL AND transaction_type = 'Despesa';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_vehicle_expense_os_date_account
  ON public.financial_transactions (
    company_id,
    transaction_date,
    service_order_id,
    chart_of_account_id
  )
  WHERE service_order_id IS NOT NULL
    AND transaction_type = 'Despesa'
    AND entry_source = 'vehicle_expense';

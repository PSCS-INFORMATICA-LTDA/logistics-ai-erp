-- Aplicar no SQL Editor do Supabase (produção / desenvolvimento)
-- Equivalente: supabase/migrations/039_company_ledger.sql

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS entry_source TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_company_ledger
  ON public.financial_transactions (company_id, transaction_date DESC)
  WHERE entry_source = 'company_ledger';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_company_ledger_date_account_amount
  ON public.financial_transactions (
    company_id,
    transaction_date,
    chart_of_account_id,
    amount
  )
  WHERE entry_source = 'company_ledger'
    AND transaction_type IN ('Receita', 'Despesa');

-- Lançamentos manuais da empresa (DRE geral)
-- Migration: 039_company_ledger.sql

-- Garante coluna entry_source (já usada em despesas de veículo)
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS entry_source TEXT;

COMMENT ON COLUMN public.financial_transactions.entry_source IS
  'Origem: company_ledger, vehicle_expense, driver_payment, …';

CREATE INDEX IF NOT EXISTS idx_financial_transactions_company_ledger
  ON public.financial_transactions (company_id, transaction_date DESC)
  WHERE entry_source = 'company_ledger';

-- Anti-duplicata suave: mesma data + conta + valor em lançamento manual da empresa
CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_company_ledger_date_account_amount
  ON public.financial_transactions (
    company_id,
    transaction_date,
    chart_of_account_id,
    amount
  )
  WHERE entry_source = 'company_ledger'
    AND transaction_type IN ('Receita', 'Despesa');

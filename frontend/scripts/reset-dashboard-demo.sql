-- reset-dashboard-demo.sql
-- Remove APENAS lançamentos DEMO do Dashboard ([DEMO-DASH] / entry_source = dashboard_demo).
-- Não é limpeza total do sistema — isso fica para um update futuro.

-- Todas as empresas:
DELETE FROM public.financial_transactions
WHERE entry_source = 'dashboard_demo'
   OR description LIKE '[DEMO-DASH]%';

-- Ou só uma empresa (descomente e troque o UUID):
-- DELETE FROM public.financial_transactions
-- WHERE company_id = '00000000-0000-0000-0000-000000000000'
--   AND (entry_source = 'dashboard_demo' OR description LIKE '[DEMO-DASH]%');

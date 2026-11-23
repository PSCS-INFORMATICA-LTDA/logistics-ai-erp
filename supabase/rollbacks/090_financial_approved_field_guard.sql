-- Rollback DEV da 090. Manual e só com autorização.
-- Não aplicar em PROD.
-- Não remove as triggers da 088 nem da 089.
-- Devolve EXECUTE de service_role nas duas funções internas, como estava depois da 089.

drop trigger if exists trg_financial_transactions_approved_fields
  on public.financial_transactions;

drop function if exists public.correct_financial_transaction_audited(uuid, text, jsonb, text, text);
drop function if exists public.guard_financial_transaction_approved_fields();

drop table if exists public.financial_correction_events;

grant execute on function public._ap_post_competence_impl(uuid) to service_role;
grant execute on function public.seed_dashboard_demo_impl(uuid) to service_role;

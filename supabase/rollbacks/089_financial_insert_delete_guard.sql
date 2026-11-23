-- Rollback DEV da 089. Manual e só com autorização.
-- Não aplicar em PROD.
-- Reabre o INSERT com approved por omissão e o DELETE direto.
-- Não mexe na trigger da 088.

drop trigger if exists trg_financial_transactions_direct_delete
  on public.financial_transactions;

drop trigger if exists trg_financial_transactions_approval_insert
  on public.financial_transactions;

drop function if exists public.reset_dashboard_demo_financial(uuid);
drop function if exists public.delete_financial_transaction_audited(uuid, text, text, text);
drop function if exists public.post_car_wash_revenue(uuid);
drop function if exists public.post_parking_revenue(uuid);
drop function if exists public.guard_financial_transaction_direct_delete();
drop function if exists public.guard_financial_transaction_approval_insert();

alter table public.financial_transactions
  alter column approval_status set default 'approved';

create or replace function public._ap_post_competence(p_payable_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id
    into v_company_id
  from public.accounts_payable
  where id = p_payable_id;

  if not public.auth_user_can_access_company_finance(v_company_id) then
    raise exception 'Sem acesso financeiro à empresa';
  end if;

  return public._ap_post_competence_impl(p_payable_id);
end;
$$;

revoke all on function public._ap_post_competence(uuid) from public;
revoke all on function public._ap_post_competence(uuid) from anon;
grant execute on function public._ap_post_competence(uuid) to authenticated;

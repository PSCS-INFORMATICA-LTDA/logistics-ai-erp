-- Aplicar no SQL Editor do Supabase DEV (jmbajdpkvlrslirwzyze) somente com autorização explícita.
-- Não aplicar em PROD (tqeenmswotxqainkyyct).
-- Fonte: supabase/migrations/088_financial_approval_status_guard.sql
--
-- Rollback no DEV, manual e autorizado:
--   drop trigger if exists trg_financial_transactions_approval_status
--     on public.financial_transactions;
--   drop function if exists public.guard_financial_transaction_approval_status();

create or replace function public.guard_financial_transaction_approval_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  status_changed boolean;
  company_changed boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  status_changed := new.approval_status is distinct from old.approval_status;
  company_changed := new.company_id is distinct from old.company_id;

  if not status_changed and not company_changed then
    return new;
  end if;

  if company_changed
     and (
       auth.uid() is null
       or not public.auth_user_is_company_admin(old.company_id)
       or not public.auth_user_is_company_admin(new.company_id)
     ) then
    raise exception
      'A empresa do lançamento só pode ser alterada por administrador das duas empresas.'
      using errcode = '42501';
  end if;

  if status_changed
     and (
       auth.uid() is null
       or not public.auth_user_is_company_admin(old.company_id)
     ) then
    raise exception
      'Somente administrador da empresa pode alterar o status de aprovação.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_financial_transaction_approval_status() is
  'BEFORE UPDATE: approval_status só muda se auth.uid() for admin da empresa atual. company_id só muda se for admin da empresa atual e da destino. Sem bypass por Senha Máster ou service role.';

revoke all on function public.guard_financial_transaction_approval_status() from public;
revoke all on function public.guard_financial_transaction_approval_status() from anon;
revoke all on function public.guard_financial_transaction_approval_status() from authenticated;

drop trigger if exists trg_financial_transactions_approval_status
  on public.financial_transactions;

create trigger trg_financial_transactions_approval_status
  before update on public.financial_transactions
  for each row
  execute function public.guard_financial_transaction_approval_status();

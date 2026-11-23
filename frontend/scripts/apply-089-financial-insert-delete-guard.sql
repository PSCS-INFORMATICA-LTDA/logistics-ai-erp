-- Aplicar no SQL Editor do Supabase DEV (jmbajdpkvlrslirwzyze) somente com autorização explícita.
-- Não aplicar em PROD (tqeenmswotxqainkyyct).
-- Fonte: supabase/migrations/089_financial_insert_delete_guard.sql
-- Não executar outras migrations neste script.
--
-- Resíduo conhecido, não restaurar:
-- QA-OS-ND-001 (06017813-bde8-4802-afda-8936ad81f042)
-- updated_at 2026-11-23 16:15:59.856477+00
--
alter table public.financial_transactions
  alter column approval_status set default 'submitted';

comment on column public.financial_transactions.approval_status is
  'draft|submitted|approved|rejected|cancelled. Omissão na criação grava submitted. Só approved entra em DRE, dashboard e rateio.';

create or replace function public.guard_financial_transaction_approval_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit numeric;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.approval_status is null then
    new.approval_status := 'submitted';
  end if;

  if new.approval_status is distinct from 'approved' then
    return new;
  end if;

  if public.auth_user_is_company_admin(new.company_id) then
    return new;
  end if;

  -- Baixa do motorista, postagem de contas a pagar, seed DEMO e restauração
  -- de exclusão são SECURITY DEFINER de posse do postgres. O PostgREST entra
  -- como authenticated ou service_role e não se passa por esses papéis.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.entry_source in ('company_ledger', 'vehicle_expense') then
    select s.auto_approve_below_amount
      into v_limit
    from public.company_financial_approval_settings s
    where s.company_id = new.company_id;

    if v_limit is not null and new.amount <= v_limit then
      return new;
    end if;
  end if;

  raise exception
    'Somente administrador da empresa pode criar lançamento já aprovado.'
    using errcode = '42501';
end;
$$;

comment on function public.guard_financial_transaction_approval_insert() is
  'BEFORE INSERT: approved só para admin, para função interna do postgres, ou para lançamento manual dentro da alçada auto_approve_below_amount. Omissão da coluna fica submitted.';

revoke all on function public.guard_financial_transaction_approval_insert() from public;
revoke all on function public.guard_financial_transaction_approval_insert() from anon;
revoke all on function public.guard_financial_transaction_approval_insert() from authenticated;

drop trigger if exists trg_financial_transactions_approval_insert
  on public.financial_transactions;

create trigger trg_financial_transactions_approval_insert
  before insert on public.financial_transactions
  for each row
  execute function public.guard_financial_transaction_approval_insert();

-- O wrapper público da 087 só checa papel financeiro. Sem este predicado,
-- um financeiro chamaria a postagem de um título ainda não aprovado e a
-- função interna gravaria o lançamento já approved.
create or replace function public._ap_post_competence(p_payable_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_approval_status text;
begin
  select company_id, approval_status
    into v_company_id, v_approval_status
  from public.accounts_payable
  where id = p_payable_id
  for update;

  if not public.auth_user_can_access_company_finance(v_company_id) then
    raise exception 'Sem acesso financeiro à empresa'
      using errcode = '42501';
  end if;

  if v_approval_status is distinct from 'approved' then
    raise exception 'O lançamento no DRE só ocorre para título já aprovado.'
      using errcode = '42501';
  end if;

  return public._ap_post_competence_impl(p_payable_id);
end;
$$;

revoke all on function public._ap_post_competence(uuid) from public;
revoke all on function public._ap_post_competence(uuid) from anon;
grant execute on function public._ap_post_competence(uuid) to authenticated;

create or replace function public.post_parking_revenue(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.parking_entries%rowtype;
  v_account_id uuid;
  v_classification text;
  v_tx_id uuid;
begin
  select * into v_entry
  from public.parking_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Entrada de estacionamento não encontrada';
  end if;

  if not public.auth_user_can_access_company_finance(v_entry.company_id) then
    raise exception 'Sem acesso financeiro à empresa'
      using errcode = '42501';
  end if;

  if v_entry.financial_transaction_id is not null then
    return v_entry.financial_transaction_id;
  end if;

  if v_entry.total_amount is null or v_entry.total_amount <= 0 then
    raise exception 'Valor total inválido.';
  end if;

  select id, classification
    into v_account_id, v_classification
  from public.chart_of_accounts
  where company_id = v_entry.company_id
    and name = 'Receita Estacionamento'
    and status = 'Ativo'
  limit 1;

  if v_account_id is null then
    raise exception 'Conta DRE «Receita Estacionamento» não encontrada.';
  end if;

  insert into public.financial_transactions (
    company_id,
    transaction_date,
    amount,
    chart_of_account_id,
    classification,
    transaction_type,
    description,
    entry_source,
    approval_status,
    submitted_at
  ) values (
    v_entry.company_id,
    coalesce(v_entry.exit_date, v_entry.entry_date),
    v_entry.total_amount,
    v_account_id,
    coalesce(v_classification, 'Receitas'),
    'Receita',
    format('Estacionamento %s — %s', v_entry.code, v_entry.plate),
    'parking',
    'approved',
    now()
  )
  returning id into v_tx_id;

  update public.parking_entries
  set financial_transaction_id = v_tx_id
  where id = v_entry.id;

  return v_tx_id;
end;
$$;

create or replace function public.post_car_wash_revenue(p_service_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.car_wash_services%rowtype;
  v_account_id uuid;
  v_classification text;
  v_tx_id uuid;
begin
  select * into v_row
  from public.car_wash_services
  where id = p_service_id
  for update;

  if not found then
    raise exception 'Serviço de lava-rápido não encontrado';
  end if;

  if not public.auth_user_can_access_company_finance(v_row.company_id) then
    raise exception 'Sem acesso financeiro à empresa'
      using errcode = '42501';
  end if;

  if v_row.financial_transaction_id is not null then
    return v_row.financial_transaction_id;
  end if;

  if v_row.service_amount is null or v_row.service_amount <= 0 then
    raise exception 'Valor do serviço inválido.';
  end if;

  select id, classification
    into v_account_id, v_classification
  from public.chart_of_accounts
  where company_id = v_row.company_id
    and name = 'Receita Lava Rápido'
    and status = 'Ativo'
  limit 1;

  if v_account_id is null then
    raise exception 'Conta DRE «Receita Lava Rápido» não encontrada.';
  end if;

  insert into public.financial_transactions (
    company_id,
    transaction_date,
    amount,
    chart_of_account_id,
    classification,
    transaction_type,
    description,
    entry_source,
    approval_status,
    submitted_at
  ) values (
    v_row.company_id,
    v_row.service_date,
    v_row.service_amount,
    v_account_id,
    coalesce(v_classification, 'Receitas'),
    'Receita',
    format('Lava-rápido %s — %s — %s', v_row.code, v_row.plate, v_row.service_name),
    'car_wash',
    'approved',
    now()
  )
  returning id into v_tx_id;

  update public.car_wash_services
  set financial_transaction_id = v_tx_id
  where id = v_row.id;

  return v_tx_id;
end;
$$;

revoke all on function public.post_parking_revenue(uuid) from public;
revoke all on function public.post_parking_revenue(uuid) from anon;
grant execute on function public.post_parking_revenue(uuid) to authenticated;

revoke all on function public.post_car_wash_revenue(uuid) from public;
revoke all on function public.post_car_wash_revenue(uuid) from anon;
grant execute on function public.post_car_wash_revenue(uuid) to authenticated;

comment on function public.post_parking_revenue(uuid) is
  'Receita de estacionamento já vinculada à entrada. Grava approved só a partir do registro do pátio, não de um INSERT livre.';

comment on function public.post_car_wash_revenue(uuid) is
  'Receita de lava-rápido já vinculada ao serviço. Grava approved só a partir do registro do pátio, não de um INSERT livre.';

create or replace function public.guard_financial_transaction_direct_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_setting('app.ft_audited_delete', true) = 'on' then
    return old;
  end if;

  raise exception
    'Exclusão direta de lançamento financeiro não é permitida. A exclusão precisa de administrador e de auditoria.'
    using errcode = '42501';
end;
$$;

comment on function public.guard_financial_transaction_direct_delete() is
  'BEFORE DELETE: bloqueia exclusão direta. A flag local só é ligada por delete_financial_transaction_audited e pelo reset DEMO auditado.';

revoke all on function public.guard_financial_transaction_direct_delete() from public;
revoke all on function public.guard_financial_transaction_direct_delete() from anon;
revoke all on function public.guard_financial_transaction_direct_delete() from authenticated;

drop trigger if exists trg_financial_transactions_direct_delete
  on public.financial_transactions;

create trigger trg_financial_transactions_direct_delete
  before delete on public.financial_transactions
  for each row
  execute function public.guard_financial_transaction_direct_delete();

create or replace function public.delete_financial_transaction_audited(
  p_id uuid,
  p_reason text,
  p_reason_code text default null,
  p_screen_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.financial_transactions%rowtype;
  v_reason text;
  v_email text;
  v_name text;
  v_audit_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão ausente.'
      using errcode = '42501';
  end if;

  select * into v_row
  from public.financial_transactions
  where id = p_id
  for update;

  if not found then
    raise exception 'Lançamento não encontrado';
  end if;

  if not public.auth_user_is_company_admin(v_row.company_id) then
    raise exception 'Somente administrador da empresa pode excluir lançamento financeiro.'
      using errcode = '42501';
  end if;

  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  if char_length(v_reason) < 8 then
    raise exception 'Informe um motivo com pelo menos 8 caracteres.'
      using errcode = '22023';
  end if;

  select u.email,
         coalesce(
           nullif(u.raw_user_meta_data->>'full_name', ''),
           nullif(u.raw_user_meta_data->>'name', ''),
           split_part(u.email, '@', 1)
         )
    into v_email, v_name
  from auth.users u
  where u.id = auth.uid();

  insert into public.deletion_audit_events (
    company_id,
    actor_user_id,
    actor_name,
    actor_email,
    screen_key,
    entity_type,
    entity_id,
    entity_code,
    summary,
    reason,
    reason_code,
    delete_mode,
    payload_json
  ) values (
    v_row.company_id,
    auth.uid(),
    v_name,
    v_email,
    nullif(btrim(coalesce(p_screen_key, '')), ''),
    'financial_transactions',
    v_row.id::text,
    null,
    left(concat_ws(' · ', v_row.description, v_row.transaction_date::text, v_row.amount::text), 500),
    v_reason,
    nullif(btrim(coalesce(p_reason_code, '')), ''),
    'hard',
    to_jsonb(v_row)
  )
  returning id into v_audit_id;

  perform set_config('app.ft_audited_delete', 'on', true);

  delete from public.financial_transactions
  where id = v_row.id;

  return v_audit_id;
end;
$$;

revoke all on function public.delete_financial_transaction_audited(uuid, text, text, text) from public;
revoke all on function public.delete_financial_transaction_audited(uuid, text, text, text) from anon;
grant execute on function public.delete_financial_transaction_audited(uuid, text, text, text) to authenticated;

comment on function public.delete_financial_transaction_audited(uuid, text, text, text) is
  'Exclusão de lançamento somente para admin, com motivo e snapshot em deletion_audit_events na mesma transação.';

create or replace function public.reset_dashboard_demo_financial(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_email text;
  v_name text;
begin
  if auth.uid() is null or not public.auth_user_is_company_admin(p_company_id) then
    raise exception 'Somente administrador da empresa pode limpar a base DEMO.'
      using errcode = '42501';
  end if;

  perform set_config('app.ft_audited_delete', 'on', true);

  delete from public.financial_transactions
  where company_id = p_company_id
    and (
      entry_source = 'dashboard_demo'
      or description ilike '[DEMO-DASH]%'
    );

  get diagnostics v_count = row_count;

  if v_count > 0 then
    select u.email,
           coalesce(
             nullif(u.raw_user_meta_data->>'full_name', ''),
             nullif(u.raw_user_meta_data->>'name', ''),
             split_part(u.email, '@', 1)
           )
      into v_email, v_name
    from auth.users u
    where u.id = auth.uid();

    insert into public.deletion_audit_events (
      company_id,
      actor_user_id,
      actor_name,
      actor_email,
      screen_key,
      entity_type,
      entity_id,
      summary,
      reason,
      reason_code,
      delete_mode,
      payload_json
    ) values (
      p_company_id,
      auth.uid(),
      v_name,
      v_email,
      'dashboard.demo',
      'financial_transactions',
      'dashboard_demo',
      format('%s lançamentos DEMO removidos', v_count),
      'Limpeza da base DEMO do dashboard pelo administrador.',
      'teste',
      'hard',
      jsonb_build_object('deleted', v_count, 'entry_source', 'dashboard_demo')
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.reset_dashboard_demo_financial(uuid) from public;
revoke all on function public.reset_dashboard_demo_financial(uuid) from anon;
grant execute on function public.reset_dashboard_demo_financial(uuid) to authenticated;

comment on function public.reset_dashboard_demo_financial(uuid) is
  'Remove só lançamentos DEMO do dashboard, com um evento de auditoria. Não apaga lançamento operacional.';

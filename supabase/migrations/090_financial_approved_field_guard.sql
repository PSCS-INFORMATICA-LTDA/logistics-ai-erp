-- DEV only. Não aplicar sem autorização explícita no Supabase DEV jmbajdpkvlrslirwzyze.
-- Não aplicar em PROD. Não reaplicar 088 nem 089.
-- Depende das migrations 086, 087, 088 e 089 já existentes.
--
-- Congela os campos econômicos de um lançamento quando o status anterior
-- é approved, ou quando o update o torna approved. approval_status e os
-- campos de revisão continuam com a trigger da 088.
--
-- A flag app.ft_audited_correction não basta. O update sensível só passa
-- com as três condições juntas, dentro de correct_financial_transaction_audited:
--   current_user = postgres (dono da função SECURITY DEFINER)
--   session_user = authenticator ou authenticated (papel da conexão; o
--     PostgREST entra como authenticator e faz SET ROLE)
--   o valor da flag é o id da linha, não um liga/desliga genérico
-- Um set_config feito pelo usuário, pelo service_role ou pelo SQL Editor
-- como postgres não reúne as três.
--
-- Rollback: supabase/rollbacks/090_financial_approved_field_guard.sql

create table if not exists public.financial_correction_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_id uuid not null,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  screen_key text,
  reason text not null,
  reason_code text,
  old_values jsonb not null,
  new_values jsonb not null,
  occurred_at timestamptz not null default now()
);

comment on table public.financial_correction_events is
  'Correção auditada de lançamento já aprovado. Não é exclusão e não entra na restauração do histórico de exclusões.';

alter table public.financial_correction_events enable row level security;

drop policy if exists financial_correction_events_select on public.financial_correction_events;
create policy financial_correction_events_select
  on public.financial_correction_events
  for select
  to authenticated
  using (public.auth_user_is_company_admin(company_id));

revoke all on table public.financial_correction_events from public;
revoke all on table public.financial_correction_events from anon;
grant select on table public.financial_correction_events to authenticated;

create or replace function public.guard_financial_transaction_approved_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $m090_guard$
declare
  sensitive_changed boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  sensitive_changed :=
    new.amount is distinct from old.amount
    or new.entry_source is distinct from old.entry_source
    or new.description is distinct from old.description
    or new.transaction_type is distinct from old.transaction_type
    or new.transaction_date is distinct from old.transaction_date
    or new.service_date is distinct from old.service_date
    or new.chart_of_account_id is distinct from old.chart_of_account_id
    or new.classification is distinct from old.classification
    or new.company_id is distinct from old.company_id
    or new.branch_id is distinct from old.branch_id
    or new.client_id is distinct from old.client_id
    or new.supplier_id is distinct from old.supplier_id
    or new.driver_id is distinct from old.driver_id
    or new.service_order_id is distinct from old.service_order_id
    or new.allocation_vehicle_id is distinct from old.allocation_vehicle_id
    or new.operational_vehicle_id is distinct from old.operational_vehicle_id
    or new.legacy_number is distinct from old.legacy_number
    or new.submitted_by is distinct from old.submitted_by
    or new.submitted_at is distinct from old.submitted_at
    or new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by;

  if not sensitive_changed then
    return new;
  end if;

  -- Status novo approved também congela o valor. Aprovar e alterar o
  -- montante no mesmo update não passa por fora da correção auditada.
  if old.approval_status is distinct from 'approved'
     and new.approval_status is distinct from 'approved' then
    return new;
  end if;

  if current_user = 'postgres'
     and session_user in ('authenticator', 'authenticated')
     and current_setting('app.ft_audited_correction', true) is not distinct from old.id::text
  then
    return new;
  end if;

  raise exception
    'Lançamento aprovado não aceita alteração direta de valor, origem ou vínculo. A correção precisa de administrador e de auditoria.'
    using errcode = '42501';
end;
$m090_guard$;

comment on function public.guard_financial_transaction_approved_fields() is
  'BEFORE UPDATE: campo econômico de lançamento approved, ou que está virando approved, só muda na correção auditada. A flag sozinha não libera.';

revoke all on function public.guard_financial_transaction_approved_fields() from public;
revoke all on function public.guard_financial_transaction_approved_fields() from anon;
revoke all on function public.guard_financial_transaction_approved_fields() from authenticated;
revoke all on function public.guard_financial_transaction_approved_fields() from service_role;

drop trigger if exists trg_financial_transactions_approved_fields
  on public.financial_transactions;

create trigger trg_financial_transactions_approved_fields
  before update on public.financial_transactions
  for each row
  execute function public.guard_financial_transaction_approved_fields();

create or replace function public.correct_financial_transaction_audited(
  p_id uuid,
  p_reason text,
  p_patch jsonb,
  p_reason_code text default null,
  p_screen_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $m090_fn$
declare
  v_row public.financial_transactions%rowtype;
  v_new public.financial_transactions%rowtype;
  v_reason text;
  v_key text;
  v_email text;
  v_name text;
  v_class text;
  v_chart uuid;
  v_company uuid;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
  v_audit_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão ausente.'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A correção precisa de um objeto com os campos novos.'
      using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch)
  loop
    if v_key not in (
      'amount',
      'entry_source',
      'description',
      'transaction_type',
      'transaction_date',
      'service_date',
      'chart_of_account_id',
      'classification',
      'company_id',
      'branch_id',
      'client_id',
      'supplier_id',
      'driver_id',
      'service_order_id',
      'allocation_vehicle_id',
      'operational_vehicle_id',
      'legacy_number'
    ) then
      raise exception 'O campo % não entra na correção auditada.', v_key
        using errcode = '22023';
    end if;
  end loop;

  select * into v_row
  from public.financial_transactions
  where id = p_id
  for update;

  if not found then
    raise exception 'Lançamento não encontrado';
  end if;

  if v_row.approval_status is distinct from 'approved' then
    raise exception 'Só um lançamento já aprovado usa a correção auditada.'
      using errcode = '42501';
  end if;

  if not public.auth_user_is_company_admin(v_row.company_id) then
    raise exception 'Somente administrador da empresa pode corrigir lançamento aprovado.'
      using errcode = '42501';
  end if;

  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  if char_length(v_reason) < 8 then
    raise exception 'Informe um motivo com pelo menos 8 caracteres.'
      using errcode = '22023';
  end if;

  v_new := v_row;

  if p_patch ? 'amount' then
    v_new.amount := (p_patch->>'amount')::numeric;
    if v_new.amount is null or v_new.amount <= 0 then
      raise exception 'O valor precisa ser maior que zero.'
        using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'company_id' then
    v_company := (p_patch->>'company_id')::uuid;
    if v_company is null then
      raise exception 'A empresa do lançamento é obrigatória.'
        using errcode = '22023';
    end if;
    if v_company is distinct from v_row.company_id
       and not public.auth_user_is_company_admin(v_company) then
      raise exception 'A empresa do lançamento só pode ser alterada por administrador das duas empresas.'
        using errcode = '42501';
    end if;
    v_new.company_id := v_company;
  end if;

  if p_patch ? 'chart_of_account_id' then
    v_chart := (p_patch->>'chart_of_account_id')::uuid;
    select classification into v_class
    from public.chart_of_accounts
    where id = v_chart
      and company_id = v_new.company_id;
    if v_class is null then
      raise exception 'Conta DRE inválida para a empresa do lançamento.'
        using errcode = '22023';
    end if;
    v_new.chart_of_account_id := v_chart;
    v_new.classification := v_class;
  end if;

  if p_patch ? 'classification' and not (p_patch ? 'chart_of_account_id') then
    v_new.classification := p_patch->>'classification';
  end if;

  if p_patch ? 'entry_source' then
    v_new.entry_source := nullif(btrim(p_patch->>'entry_source'), '');
  end if;
  if p_patch ? 'description' then
    v_new.description := nullif(btrim(p_patch->>'description'), '');
  end if;
  if p_patch ? 'transaction_type' then
    v_new.transaction_type := p_patch->>'transaction_type';
  end if;
  if p_patch ? 'transaction_date' then
    v_new.transaction_date := (p_patch->>'transaction_date')::date;
  end if;
  if p_patch ? 'service_date' then
    v_new.service_date := nullif(p_patch->>'service_date', '')::date;
  end if;
  if p_patch ? 'branch_id' then
    v_new.branch_id := nullif(p_patch->>'branch_id', '')::uuid;
  end if;
  if p_patch ? 'client_id' then
    v_new.client_id := nullif(p_patch->>'client_id', '')::uuid;
  end if;
  if p_patch ? 'supplier_id' then
    v_new.supplier_id := nullif(p_patch->>'supplier_id', '')::uuid;
  end if;
  if p_patch ? 'driver_id' then
    v_new.driver_id := nullif(p_patch->>'driver_id', '')::uuid;
  end if;
  if p_patch ? 'service_order_id' then
    v_new.service_order_id := nullif(p_patch->>'service_order_id', '')::uuid;
  end if;
  if p_patch ? 'allocation_vehicle_id' then
    v_new.allocation_vehicle_id := nullif(p_patch->>'allocation_vehicle_id', '')::uuid;
  end if;
  if p_patch ? 'operational_vehicle_id' then
    v_new.operational_vehicle_id := nullif(p_patch->>'operational_vehicle_id', '')::uuid;
  end if;
  if p_patch ? 'legacy_number' then
    v_new.legacy_number := nullif(btrim(p_patch->>'legacy_number'), '');
  end if;

  if v_new.company_id is distinct from v_row.company_id
     or v_new.chart_of_account_id is distinct from v_row.chart_of_account_id then
    perform 1
    from public.chart_of_accounts
    where id = v_new.chart_of_account_id
      and company_id = v_new.company_id;
    if not found then
      raise exception 'Conta DRE inválida para a empresa do lançamento.'
        using errcode = '22023';
    end if;
  end if;

  if v_new.entry_source = 'dashboard_demo'
     or coalesce(v_new.description, '') ilike '[DEMO-DASH]%' then
    raise exception 'A correção auditada não converte o lançamento em base DEMO.'
      using errcode = '22023';
  end if;

  if v_new.amount is distinct from v_row.amount then
    v_old_json := v_old_json || jsonb_build_object('amount', v_row.amount);
    v_new_json := v_new_json || jsonb_build_object('amount', v_new.amount);
  end if;
  if v_new.entry_source is distinct from v_row.entry_source then
    v_old_json := v_old_json || jsonb_build_object('entry_source', v_row.entry_source);
    v_new_json := v_new_json || jsonb_build_object('entry_source', v_new.entry_source);
  end if;
  if v_new.description is distinct from v_row.description then
    v_old_json := v_old_json || jsonb_build_object('description', v_row.description);
    v_new_json := v_new_json || jsonb_build_object('description', v_new.description);
  end if;
  if v_new.transaction_type is distinct from v_row.transaction_type then
    v_old_json := v_old_json || jsonb_build_object('transaction_type', v_row.transaction_type);
    v_new_json := v_new_json || jsonb_build_object('transaction_type', v_new.transaction_type);
  end if;
  if v_new.transaction_date is distinct from v_row.transaction_date then
    v_old_json := v_old_json || jsonb_build_object('transaction_date', v_row.transaction_date);
    v_new_json := v_new_json || jsonb_build_object('transaction_date', v_new.transaction_date);
  end if;
  if v_new.service_date is distinct from v_row.service_date then
    v_old_json := v_old_json || jsonb_build_object('service_date', v_row.service_date);
    v_new_json := v_new_json || jsonb_build_object('service_date', v_new.service_date);
  end if;
  if v_new.chart_of_account_id is distinct from v_row.chart_of_account_id then
    v_old_json := v_old_json || jsonb_build_object('chart_of_account_id', v_row.chart_of_account_id);
    v_new_json := v_new_json || jsonb_build_object('chart_of_account_id', v_new.chart_of_account_id);
  end if;
  if v_new.classification is distinct from v_row.classification then
    v_old_json := v_old_json || jsonb_build_object('classification', v_row.classification);
    v_new_json := v_new_json || jsonb_build_object('classification', v_new.classification);
  end if;
  if v_new.company_id is distinct from v_row.company_id then
    v_old_json := v_old_json || jsonb_build_object('company_id', v_row.company_id);
    v_new_json := v_new_json || jsonb_build_object('company_id', v_new.company_id);
  end if;
  if v_new.branch_id is distinct from v_row.branch_id then
    v_old_json := v_old_json || jsonb_build_object('branch_id', v_row.branch_id);
    v_new_json := v_new_json || jsonb_build_object('branch_id', v_new.branch_id);
  end if;
  if v_new.client_id is distinct from v_row.client_id then
    v_old_json := v_old_json || jsonb_build_object('client_id', v_row.client_id);
    v_new_json := v_new_json || jsonb_build_object('client_id', v_new.client_id);
  end if;
  if v_new.supplier_id is distinct from v_row.supplier_id then
    v_old_json := v_old_json || jsonb_build_object('supplier_id', v_row.supplier_id);
    v_new_json := v_new_json || jsonb_build_object('supplier_id', v_new.supplier_id);
  end if;
  if v_new.driver_id is distinct from v_row.driver_id then
    v_old_json := v_old_json || jsonb_build_object('driver_id', v_row.driver_id);
    v_new_json := v_new_json || jsonb_build_object('driver_id', v_new.driver_id);
  end if;
  if v_new.service_order_id is distinct from v_row.service_order_id then
    v_old_json := v_old_json || jsonb_build_object('service_order_id', v_row.service_order_id);
    v_new_json := v_new_json || jsonb_build_object('service_order_id', v_new.service_order_id);
  end if;
  if v_new.allocation_vehicle_id is distinct from v_row.allocation_vehicle_id then
    v_old_json := v_old_json || jsonb_build_object('allocation_vehicle_id', v_row.allocation_vehicle_id);
    v_new_json := v_new_json || jsonb_build_object('allocation_vehicle_id', v_new.allocation_vehicle_id);
  end if;
  if v_new.operational_vehicle_id is distinct from v_row.operational_vehicle_id then
    v_old_json := v_old_json || jsonb_build_object('operational_vehicle_id', v_row.operational_vehicle_id);
    v_new_json := v_new_json || jsonb_build_object('operational_vehicle_id', v_new.operational_vehicle_id);
  end if;
  if v_new.legacy_number is distinct from v_row.legacy_number then
    v_old_json := v_old_json || jsonb_build_object('legacy_number', v_row.legacy_number);
    v_new_json := v_new_json || jsonb_build_object('legacy_number', v_new.legacy_number);
  end if;

  if v_old_json = '{}'::jsonb then
    raise exception 'Nenhum campo econômico foi alterado.'
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

  insert into public.financial_correction_events (
    company_id,
    transaction_id,
    actor_user_id,
    actor_name,
    actor_email,
    screen_key,
    reason,
    reason_code,
    old_values,
    new_values
  ) values (
    v_row.company_id,
    v_row.id,
    auth.uid(),
    v_name,
    v_email,
    nullif(btrim(coalesce(p_screen_key, '')), ''),
    v_reason,
    nullif(btrim(coalesce(p_reason_code, '')), ''),
    v_old_json,
    v_new_json
  )
  returning id into v_audit_id;

  perform set_config('app.ft_audited_correction', v_row.id::text, true);

  update public.financial_transactions
  set
    amount = v_new.amount,
    entry_source = v_new.entry_source,
    description = v_new.description,
    transaction_type = v_new.transaction_type,
    transaction_date = v_new.transaction_date,
    service_date = v_new.service_date,
    chart_of_account_id = v_new.chart_of_account_id,
    classification = v_new.classification,
    company_id = v_new.company_id,
    branch_id = v_new.branch_id,
    client_id = v_new.client_id,
    supplier_id = v_new.supplier_id,
    driver_id = v_new.driver_id,
    service_order_id = v_new.service_order_id,
    allocation_vehicle_id = v_new.allocation_vehicle_id,
    operational_vehicle_id = v_new.operational_vehicle_id,
    legacy_number = v_new.legacy_number,
    updated_by = auth.uid()
  where id = v_row.id;

  return v_audit_id;
end;
$m090_fn$;

comment on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) is
  'Correção de lançamento approved só para administrador, com motivo e snapshot antes/depois na mesma transação.';

revoke all on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) from public;
revoke all on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) from anon;
revoke all on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) from service_role;
grant execute on function public.correct_financial_transaction_audited(uuid, text, jsonb, text, text) to authenticated;

-- O wrapper público continua chamável. A implementação deixa de ser um
-- atalho do service_role para gravar approved sem a checagem do wrapper.
revoke all on function public._ap_post_competence_impl(uuid) from service_role;
revoke all on function public.seed_dashboard_demo_impl(uuid) from service_role;

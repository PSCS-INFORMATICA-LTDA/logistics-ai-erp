-- Cópia das funções conferidas no DEV para o teste local do script de reconciliação.
-- Não é migration e não deve ser executada no banco remoto.

create or replace function public.company_has_no_members(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
  );
$$;

CREATE OR REPLACE FUNCTION public.get_public_driver_assignment(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.service_orders%ROWTYPE;
  v_driver_name TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_row
  FROM public.service_orders
  WHERE driver_assignment_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name INTO v_driver_name
  FROM public.drivers
  WHERE id = v_row.proposed_driver_id;

  RETURN jsonb_build_object(
    'found', true,
    'company_name', (SELECT COALESCE(trade_name, name) FROM public.companies WHERE id = v_row.company_id),
    'driver_name', v_driver_name,
    'driver_assignment_response', v_row.driver_assignment_response,
    'driver_assignment_sent_at', v_row.driver_assignment_sent_at,
    'driver_assignment_pay_amount', v_row.driver_assignment_pay_amount,
    'driver_assignment_assistant_pay_amount', v_row.driver_assignment_assistant_pay_amount,
    'can_respond', (
      v_row.driver_assignment_sent_at IS NOT NULL
      AND v_row.driver_assignment_response = 'pending'
      AND v_row.proposed_driver_id IS NOT NULL
    ),
    'order', jsonb_build_object(
      'code', v_row.code,
      'service_type', v_row.service_type,
      'service_date', v_row.service_date,
      'entry_date', v_row.entry_date,
      'entry_time', v_row.entry_time,
      'exit_date', v_row.exit_date,
      'exit_time', v_row.exit_time,
      'plate', v_row.plate,
      'client_name', v_row.client_name,
      'freight_origin_address', v_row.freight_origin_address,
      'freight_destination_address', v_row.freight_destination_address,
      'freight_distance_km', v_row.freight_distance_km,
      'freight_toll_amount', v_row.freight_toll_amount
    )
  );
END;
$function$;

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
  v_persisted public.financial_transactions%rowtype;
  v_reread public.financial_transactions%rowtype;
  v_reason text;
  v_key text;
  v_email text;
  v_name text;
  v_class text;
  v_chart uuid;
  v_company uuid;
  v_set text;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
  v_returned_json jsonb;
  v_reread_json jsonb;
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
  elsif v_new.company_id is distinct from v_row.company_id then
    perform 1
    from public.chart_of_accounts
    where id = v_new.chart_of_account_id
      and company_id = v_new.company_id;
    if not found then
      raise exception 'Conta DRE inválida para a empresa do lançamento.'
        using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'classification' and not (p_patch ? 'chart_of_account_id') then
    v_new.classification := p_patch->>'classification';
    if v_new.classification is null or btrim(v_new.classification) = '' then
      raise exception 'A classificação é obrigatória.'
        using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'entry_source' then
    v_new.entry_source := nullif(btrim(p_patch->>'entry_source'), '');
  end if;
  if p_patch ? 'description' then
    v_new.description := nullif(btrim(p_patch->>'description'), '');
  end if;
  if p_patch ? 'transaction_type' and not (p_patch ? 'chart_of_account_id') then
    v_new.transaction_type := p_patch->>'transaction_type';
    if v_new.transaction_type not in ('Receita', 'Despesa', 'Outros') then
      raise exception 'Tipo de lançamento inválido.'
        using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'transaction_date' then
    v_new.transaction_date := (p_patch->>'transaction_date')::date;
    if v_new.transaction_date is null then
      raise exception 'A data do lançamento é obrigatória.'
        using errcode = '22023';
    end if;
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

  if v_new.branch_id is not null and not exists (
    select 1 from public.branches
    where id = v_new.branch_id and company_id = v_new.company_id
  ) then
    raise exception 'A filial não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.client_id is not null and not exists (
    select 1 from public.clients
    where id = v_new.client_id and company_id = v_new.company_id
  ) then
    raise exception 'O cliente não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = v_new.supplier_id and company_id = v_new.company_id
  ) then
    raise exception 'O fornecedor não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.driver_id is not null and not exists (
    select 1 from public.drivers
    where id = v_new.driver_id and company_id = v_new.company_id
  ) then
    raise exception 'O motorista não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.service_order_id is not null and not exists (
    select 1 from public.service_orders
    where id = v_new.service_order_id and company_id = v_new.company_id
  ) then
    raise exception 'A ordem de serviço não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.allocation_vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where id = v_new.allocation_vehicle_id and company_id = v_new.company_id
  ) then
    raise exception 'O veículo de rateio não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;
  if v_new.operational_vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where id = v_new.operational_vehicle_id and company_id = v_new.company_id
  ) then
    raise exception 'O veículo operacional não pertence à empresa do lançamento.'
      using errcode = '22023';
  end if;

  if v_new.entry_source = 'dashboard_demo'
     or coalesce(v_new.description, '') ilike '[DEMO-DASH]%' then
    raise exception 'A correção auditada não converte o lançamento em base DEMO.'
      using errcode = '22023';
  end if;

  -- A conta só entra no SET quando a correção a troca. Assim uma correção de
  -- descrição não dispara a trigger de classificação. Quando a conta entra,
  -- essa trigger reescreve classification e transaction_type; o RETURNING
  -- captura esse resultado, e não o valor pedido no patch.
  v_set := format('updated_by = %L', auth.uid());
  if p_patch ? 'amount' then
    v_set := v_set || format(', amount = %L', v_new.amount);
  end if;
  if p_patch ? 'entry_source' then
    v_set := v_set || format(', entry_source = %L', v_new.entry_source);
  end if;
  if p_patch ? 'description' then
    v_set := v_set || format(', description = %L', v_new.description);
  end if;
  if p_patch ? 'transaction_type' and not (p_patch ? 'chart_of_account_id') then
    v_set := v_set || format(', transaction_type = %L', v_new.transaction_type);
  end if;
  if p_patch ? 'transaction_date' then
    v_set := v_set || format(', transaction_date = %L', v_new.transaction_date);
  end if;
  if p_patch ? 'service_date' then
    v_set := v_set || format(', service_date = %L', v_new.service_date);
  end if;
  if p_patch ? 'chart_of_account_id' then
    v_set := v_set || format(', chart_of_account_id = %L', v_new.chart_of_account_id);
  end if;
  if p_patch ? 'classification' and not (p_patch ? 'chart_of_account_id') then
    v_set := v_set || format(', classification = %L', v_new.classification);
  end if;
  if p_patch ? 'company_id' then
    v_set := v_set || format(', company_id = %L', v_new.company_id);
  end if;
  if p_patch ? 'branch_id' then
    v_set := v_set || format(', branch_id = %L', v_new.branch_id);
  end if;
  if p_patch ? 'client_id' then
    v_set := v_set || format(', client_id = %L', v_new.client_id);
  end if;
  if p_patch ? 'supplier_id' then
    v_set := v_set || format(', supplier_id = %L', v_new.supplier_id);
  end if;
  if p_patch ? 'driver_id' then
    v_set := v_set || format(', driver_id = %L', v_new.driver_id);
  end if;
  if p_patch ? 'service_order_id' then
    v_set := v_set || format(', service_order_id = %L', v_new.service_order_id);
  end if;
  if p_patch ? 'allocation_vehicle_id' then
    v_set := v_set || format(', allocation_vehicle_id = %L', v_new.allocation_vehicle_id);
  end if;
  if p_patch ? 'operational_vehicle_id' then
    v_set := v_set || format(', operational_vehicle_id = %L', v_new.operational_vehicle_id);
  end if;
  if p_patch ? 'legacy_number' then
    v_set := v_set || format(', legacy_number = %L', v_new.legacy_number);
  end if;

  perform set_config('app.ft_audited_correction', v_row.id::text, true);

  execute format(
    'update public.financial_transactions set %s where id = %L returning *',
    v_set,
    v_row.id
  ) into v_persisted;

  if v_persisted.id is null then
    raise exception 'Lançamento não encontrado';
  end if;

  select * into v_reread
  from public.financial_transactions
  where id = v_row.id;

  v_returned_json := jsonb_build_object(
    'id', v_persisted.id,
    'amount', v_persisted.amount,
    'entry_source', v_persisted.entry_source,
    'description', v_persisted.description,
    'transaction_type', v_persisted.transaction_type,
    'transaction_date', v_persisted.transaction_date,
    'service_date', v_persisted.service_date,
    'chart_of_account_id', v_persisted.chart_of_account_id,
    'classification', v_persisted.classification,
    'company_id', v_persisted.company_id,
    'branch_id', v_persisted.branch_id,
    'client_id', v_persisted.client_id,
    'supplier_id', v_persisted.supplier_id,
    'driver_id', v_persisted.driver_id,
    'service_order_id', v_persisted.service_order_id,
    'allocation_vehicle_id', v_persisted.allocation_vehicle_id,
    'operational_vehicle_id', v_persisted.operational_vehicle_id,
    'legacy_number', v_persisted.legacy_number,
    'submitted_by', v_persisted.submitted_by,
    'submitted_at', v_persisted.submitted_at,
    'created_at', v_persisted.created_at,
    'created_by', v_persisted.created_by
  );
  v_reread_json := jsonb_build_object(
    'id', v_reread.id,
    'amount', v_reread.amount,
    'entry_source', v_reread.entry_source,
    'description', v_reread.description,
    'transaction_type', v_reread.transaction_type,
    'transaction_date', v_reread.transaction_date,
    'service_date', v_reread.service_date,
    'chart_of_account_id', v_reread.chart_of_account_id,
    'classification', v_reread.classification,
    'company_id', v_reread.company_id,
    'branch_id', v_reread.branch_id,
    'client_id', v_reread.client_id,
    'supplier_id', v_reread.supplier_id,
    'driver_id', v_reread.driver_id,
    'service_order_id', v_reread.service_order_id,
    'allocation_vehicle_id', v_reread.allocation_vehicle_id,
    'operational_vehicle_id', v_reread.operational_vehicle_id,
    'legacy_number', v_reread.legacy_number,
    'submitted_by', v_reread.submitted_by,
    'submitted_at', v_reread.submitted_at,
    'created_at', v_reread.created_at,
    'created_by', v_reread.created_by
  );
  if v_returned_json is distinct from v_reread_json then
    raise exception 'O estado lido depois do update divergiu do RETURNING.'
      using errcode = '40001';
  end if;

  if v_persisted.entry_source = 'dashboard_demo'
     or coalesce(v_persisted.description, '') ilike '[DEMO-DASH]%' then
    raise exception 'A correção auditada não converte o lançamento em base DEMO.'
      using errcode = '22023';
  end if;

  if v_persisted.amount is distinct from v_row.amount then
    v_old_json := v_old_json || jsonb_build_object('amount', v_row.amount);
    v_new_json := v_new_json || jsonb_build_object('amount', v_persisted.amount);
  end if;
  if v_persisted.entry_source is distinct from v_row.entry_source then
    v_old_json := v_old_json || jsonb_build_object('entry_source', v_row.entry_source);
    v_new_json := v_new_json || jsonb_build_object('entry_source', v_persisted.entry_source);
  end if;
  if v_persisted.description is distinct from v_row.description then
    v_old_json := v_old_json || jsonb_build_object('description', v_row.description);
    v_new_json := v_new_json || jsonb_build_object('description', v_persisted.description);
  end if;
  if v_persisted.transaction_type is distinct from v_row.transaction_type then
    v_old_json := v_old_json || jsonb_build_object('transaction_type', v_row.transaction_type);
    v_new_json := v_new_json || jsonb_build_object('transaction_type', v_persisted.transaction_type);
  end if;
  if v_persisted.transaction_date is distinct from v_row.transaction_date then
    v_old_json := v_old_json || jsonb_build_object('transaction_date', v_row.transaction_date);
    v_new_json := v_new_json || jsonb_build_object('transaction_date', v_persisted.transaction_date);
  end if;
  if v_persisted.service_date is distinct from v_row.service_date then
    v_old_json := v_old_json || jsonb_build_object('service_date', v_row.service_date);
    v_new_json := v_new_json || jsonb_build_object('service_date', v_persisted.service_date);
  end if;
  if v_persisted.chart_of_account_id is distinct from v_row.chart_of_account_id then
    v_old_json := v_old_json || jsonb_build_object('chart_of_account_id', v_row.chart_of_account_id);
    v_new_json := v_new_json || jsonb_build_object('chart_of_account_id', v_persisted.chart_of_account_id);
  end if;
  if v_persisted.classification is distinct from v_row.classification then
    v_old_json := v_old_json || jsonb_build_object('classification', v_row.classification);
    v_new_json := v_new_json || jsonb_build_object('classification', v_persisted.classification);
  end if;
  if v_persisted.company_id is distinct from v_row.company_id then
    v_old_json := v_old_json || jsonb_build_object('company_id', v_row.company_id);
    v_new_json := v_new_json || jsonb_build_object('company_id', v_persisted.company_id);
  end if;
  if v_persisted.branch_id is distinct from v_row.branch_id then
    v_old_json := v_old_json || jsonb_build_object('branch_id', v_row.branch_id);
    v_new_json := v_new_json || jsonb_build_object('branch_id', v_persisted.branch_id);
  end if;
  if v_persisted.client_id is distinct from v_row.client_id then
    v_old_json := v_old_json || jsonb_build_object('client_id', v_row.client_id);
    v_new_json := v_new_json || jsonb_build_object('client_id', v_persisted.client_id);
  end if;
  if v_persisted.supplier_id is distinct from v_row.supplier_id then
    v_old_json := v_old_json || jsonb_build_object('supplier_id', v_row.supplier_id);
    v_new_json := v_new_json || jsonb_build_object('supplier_id', v_persisted.supplier_id);
  end if;
  if v_persisted.driver_id is distinct from v_row.driver_id then
    v_old_json := v_old_json || jsonb_build_object('driver_id', v_row.driver_id);
    v_new_json := v_new_json || jsonb_build_object('driver_id', v_persisted.driver_id);
  end if;
  if v_persisted.service_order_id is distinct from v_row.service_order_id then
    v_old_json := v_old_json || jsonb_build_object('service_order_id', v_row.service_order_id);
    v_new_json := v_new_json || jsonb_build_object('service_order_id', v_persisted.service_order_id);
  end if;
  if v_persisted.allocation_vehicle_id is distinct from v_row.allocation_vehicle_id then
    v_old_json := v_old_json || jsonb_build_object('allocation_vehicle_id', v_row.allocation_vehicle_id);
    v_new_json := v_new_json || jsonb_build_object('allocation_vehicle_id', v_persisted.allocation_vehicle_id);
  end if;
  if v_persisted.operational_vehicle_id is distinct from v_row.operational_vehicle_id then
    v_old_json := v_old_json || jsonb_build_object('operational_vehicle_id', v_row.operational_vehicle_id);
    v_new_json := v_new_json || jsonb_build_object('operational_vehicle_id', v_persisted.operational_vehicle_id);
  end if;
  if v_persisted.legacy_number is distinct from v_row.legacy_number then
    v_old_json := v_old_json || jsonb_build_object('legacy_number', v_row.legacy_number);
    v_new_json := v_new_json || jsonb_build_object('legacy_number', v_persisted.legacy_number);
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

  return v_audit_id;
end;
$m090_fn$;

CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_company_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seed_chart$
DECLARE
    v_inserted INTEGER;
BEGIN
  -- Membro da empresa, não somente administrador. A calculadora da OS e
  -- Parâmetros de frete chamam a inicialização para o usuário logado.
  -- O insert direto do plano e da tarifa já é permitido a qualquer membro.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_user_has_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para inicializar dados desta empresa'
      USING ERRCODE = '42501';
  END IF;

    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Empresa não encontrada: %', p_company_id;
    END IF;

    INSERT INTO public.chart_of_accounts (company_id, name, classification, transaction_type, status)
    SELECT p_company_id, v.name, v.classification, v.transaction_type, 'Ativo'
    FROM (VALUES
        ('Água', 'Ocupação', 'Despesa'),
        ('Ajudante', 'Operacional', 'Despesa'),
        ('Alimentação', 'Administrativo', 'Despesa'),
        ('Aluguel', 'Ocupação', 'Despesa'),
        ('Andaimes - Aquisição', 'Administrativo', 'Despesa'),
        ('Andaimes - Locação', 'Receitas', 'Receita'),
        ('Aquisição de bens', 'Operacional', 'Despesa'),
        ('Assinaturas', 'TI', 'Despesa'),
        ('Bebidas - Geladeira', 'Administrativo', 'Despesa'),
        ('Benefícios', 'RH', 'Despesa'),
        ('Brindes', 'Marketing', 'Despesa'),
        ('Caminhão agregado', 'Operacional', 'Despesa'),
        ('Cartórios/Tabelião', 'Administrativo', 'Despesa'),
        ('Comissão', 'Lavagens', 'Despesa'),
        ('Consórcio', 'Administrativo', 'Despesa'),
        ('Coordenador', 'Administrativo', 'Despesa'),
        ('Correios', 'Administrativo', 'Despesa'),
        ('Cursos e treinamentos', 'RH', 'Despesa'),
        ('Custo caminhão refrigerado', 'Operacional', 'Despesa'),
        ('Custo micro Ônibus agregado', 'Operacional', 'Despesa'),
        ('Custo ônibus agregado', 'Operacional', 'Despesa'),
        ('Desconto de Multas - Motoristas', 'Receitas', 'Receita'),
        ('Despesas bancárias', 'Finanças', 'Despesa'),
        ('Despesas com transporte', 'Operacional', 'Despesa'),
        ('Documentação Caminhão', 'Administrativo', 'Despesa'),
        ('Documentação Vans', 'Administrativo', 'Despesa'),
        ('Empréstimos e financiamentos', 'Finanças', 'Despesa'),
        ('Endomarketing', 'Marketing', 'Despesa'),
        ('Energia elétrica', 'Ocupação', 'Despesa'),
        ('Estacionamento', 'Administrativo', 'Despesa'),
        ('Fornecedor de marketing', 'Marketing', 'Despesa'),
        ('Fornecedor de TI', 'TI', 'Despesa'),
        ('Fornecimento de àgua', 'Ocupação', 'Despesa'),
        ('Gráfica e copiadora', 'Administrativo', 'Despesa'),
        ('Hospedagem', 'Administrativo', 'Despesa'),
        ('Impostos', 'Taxas e Tributos', 'Despesa'),
        ('Internet', 'TI', 'Despesa'),
        ('KM', 'Administrativo', 'Despesa'),
        ('Limpeza e conservação', 'Ocupação', 'Despesa'),
        ('Manutenção de bens', 'Operacional', 'Despesa'),
        ('Manutenção e reforma', 'Ocupação', 'Despesa'),
        ('Materiais de lava rápido', 'Administrativo', 'Despesa'),
        ('Materiais de TI', 'TI', 'Despesa'),
        ('Material de escritório', 'Administrativo', 'Despesa'),
        ('Material de limpeza e cozinha', 'Ocupação', 'Despesa'),
        ('Motoboy', 'Administrativo', 'Despesa'),
        ('Motorista', 'Operacional', 'Despesa'),
        ('Móveis e utensílios', 'Ocupação', 'Despesa'),
        ('Multas e juros', 'Finanças', 'Despesa'),
        ('Pagamento de BV', 'Administrativo', 'Despesa'),
        ('Pedágio', 'Administrativo', 'Despesa'),
        ('Posto de Combustível', 'Administrativo', 'Despesa'),
        ('Prospecção', 'Marketing', 'Despesa'),
        ('Receita Caminhão', 'Receitas', 'Receita'),
        ('Receita Caminhão Refrigerado', 'Receitas', 'Receita'),
        ('Receita diversas', 'Receitas', 'Receita'),
        ('Receita Estacionamento', 'Receitas', 'Receita'),
        ('Receita Lava Rápido', 'Receitas', 'Receita'),
        ('Receita micro ônibus agregado', 'Receitas', 'Receita'),
        ('Receita ônibus agregado', 'Receitas', 'Receita'),
        ('Receita Van', 'Receitas', 'Receita'),
        ('Reembolso', 'Administrativo', 'Despesa'),
        ('Salários', 'RH', 'Despesa'),
        ('Saldo Inicial', 'Receitas', 'Receita'),
        ('Seguros', 'Ocupação', 'Despesa'),
        ('Serviços contábeis', 'Finanças', 'Despesa'),
        ('Serviços de consultoria', 'Operacional', 'Despesa'),
        ('Taxas e emolumentos', 'Administrativo', 'Despesa'),
        ('Táxi/Uber', 'Administrativo', 'Despesa'),
        ('Telefonia', 'TI', 'Despesa'),
        ('Transferências bancárias', 'Movimentações', 'Outros'),
        ('Transporte público', 'Administrativo', 'Despesa'),
        ('Van agregada', 'Operacional', 'Despesa'),
        ('Venda de bebidas e salgadinhos', 'Receitas', 'Receita'),
        ('Vendas Bebidas - Geladeira', 'Receitas', 'Receita'),
        ('Vendas Litle Tress', 'Receitas', 'Receita'),
        ('Caminhão 1', 'Receitas', 'Receita'),
        ('Caminhão 2', 'Receitas', 'Receita'),
        ('Caminhão 3', 'Receitas', 'Receita'),
        ('Van 1', 'Receitas', 'Receita'),
        ('Van 2', 'Receitas', 'Receita')
    ) AS v(name, classification, transaction_type)
    ON CONFLICT (company_id, name) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$seed_chart$;

CREATE OR REPLACE FUNCTION public.seed_demo_freight_os(p_company_id UUID)
RETURNS TABLE (
  os_id UUID,
  os_code TEXT,
  distance_km NUMERIC,
  agreed_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seed_demo$
DECLARE
    v_vehicle RECORD;
    v_code TEXT;
    v_count INTEGER;
    v_distance NUMERIC := 867.42;
    v_antt NUMERIC := 5974.15;
    v_toll NUMERIC := 280.60;
    v_suggested NUMERIC := 6254.75;
    v_agreed NUMERIC := 6755.13;
    v_tolls JSONB := '[
        {"order":1,"name":"Imigrantes","city":"São Bernardo do Campo","state":"SP","amount":42.50},
        {"order":2,"name":"Praça de Registro","city":"Registro","state":"SP","amount":38.90},
        {"order":3,"name":"Praça de Caraguatatuba","city":"Caraguatatuba","state":"SP","amount":41.20},
        {"order":4,"name":"Praça de Rio Bonito","city":"Rio Bonito","state":"RJ","amount":36.80},
        {"order":5,"name":"Praça de Campos","city":"Campos dos Goytacazes","state":"RJ","amount":44.10},
        {"order":6,"name":"Praça de Linhares","city":"Linhares","state":"ES","amount":39.50},
        {"order":7,"name":"Praça de Serra","city":"Serra","state":"ES","amount":37.60}
    ]'::JSONB;
    v_antt_detail JSONB := '{
        "pisoMinimo": 5974.15,
        "parteDeslocamento": 5339.07,
        "parteCargaDescarga": 635.08,
        "tabela": "A",
        "eixosUtilizado": 5,
        "fonte": "Resolução ANTT 6.076/2026 (local)",
        "aviso": "OS fictícia para demonstração do PDF"
    }'::JSONB;
    v_inserted RECORD;
BEGIN
  IF auth.uid() IS NOT NULL
     OR coalesce(current_setting('request.jwt.claim.role', true), '')
        IN ('anon', 'authenticated', 'service_role')
  THEN
    RAISE EXCEPTION 'seed_demo_freight_os bloqueada para usuários da aplicação'
      USING ERRCODE = '42501';
  END IF;

    SELECT id, plate, vehicle_category, axle_count, model, year
    INTO v_vehicle
    FROM public.vehicles
    WHERE company_id = p_company_id
      AND status = 'Ativo'
      AND deleted_at IS NULL
    ORDER BY
        CASE WHEN vehicle_category = 'Caminhao' THEN 0 ELSE 1 END,
        created_at ASC
    LIMIT 1;

    IF v_vehicle.id IS NULL THEN
        RAISE EXCEPTION 'Nenhum veículo ativo encontrado. Cadastre um caminhão em Cadastros → Veículos.';
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.service_orders
    WHERE company_id = p_company_id;

    v_code := 'OS' || LPAD((v_count + 1)::TEXT, 3, '0');

    INSERT INTO public.service_orders (
        company_id, code, service_type, service_date, status,
        vehicle_id, plate, brand, model, year, vehicle_type,
        client_name, phone, service_categories, service_name, service_amount,
        freight_origin_address, freight_destination_address, freight_distance_km,
        freight_toll_amount, freight_toll_count, freight_toll_detail,
        freight_antt_cargo_type, freight_antt_axles,
        freight_antt_composicao_veicular, freight_antt_alto_desempenho, freight_antt_retorno_vazio,
        freight_antt_minimum, freight_antt_detail,
        freight_suggested_total, freight_agreed_amount, freight_per_diem_charge_to, notes
    ) VALUES (
        p_company_id, v_code, 'Frete', CURRENT_DATE, 'Aberto',
        v_vehicle.id,
        UPPER(REPLACE(REPLACE(v_vehicle.plate, ' ', ''), '-', '')),
        NULL, v_vehicle.model, v_vehicle.year, v_vehicle.vehicle_category,
        'Distribuidora Atlântica Ltda (DEMO)', '(11) 98348-1803',
        ARRAY['Frete']::TEXT[], 'Frete', v_agreed,
        'São Paulo, SP', 'Vitória, ES', v_distance,
        v_toll, 7, v_tolls,
        5, COALESCE(v_vehicle.axle_count, 5),
        TRUE, FALSE, FALSE,
        v_antt, v_antt_detail,
        v_suggested, v_agreed, 'Cliente',
        'OS fictícia para demonstração do PDF — São Paulo (SP) → Vitória (ES).'
    )
    RETURNING id, code INTO v_inserted;

    os_id := v_inserted.id;
    os_code := v_inserted.code;
    distance_km := v_distance;
    agreed_amount := v_agreed;
    RETURN NEXT;
END;
$seed_demo$;
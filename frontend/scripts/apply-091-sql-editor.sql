-- SQL Editor — Supabase DEV jmbajdpkvlrslirwzyze apenas.
-- Executar o arquivo inteiro, uma vez, como postgres.
-- Não copiar de mensagem de chat: o recorte no meio de uma função gera ERROR 42601.
-- Não aplicar em PROD tqeenmswotxqainkyyct.
--
-- A lógica é a da migration 091. BEGIN/COMMIT: se qualquer pré ou
-- pós-condição falhar, nada fica aplicado.

begin;

do $m091_pre$
begin
  if current_user is distinct from 'postgres' then
    raise exception '091: aplicar como postgres. Sessão atual: %', current_user
      using errcode = '42501';
  end if;

  if to_regclass('public._dev_schema_migrations') is null then
    raise exception '091: public._dev_schema_migrations ausente. Interromper.';
  end if;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'seed_chart_of_accounts',
        'seed_freight_rate_defaults',
        'seed_demo_freight_os',
        'auth_user_has_company',
        'auth_user_is_company_admin',
        'handle_new_user',
        'get_public_proposal',
        'get_public_driver_assignment',
        'get_public_patio_ticket',
        'respond_to_proposal',
        'respond_to_driver_assignment',
        'approve_accounts_payable',
        'reverse_accounts_payable_postings',
        'post_parking_revenue',
        'post_car_wash_revenue',
        'delete_financial_transaction_audited',
        'correct_financial_transaction_audited',
        'ensure_patio_ticket_token',
        'next_company_document_number'
      )
  ) <> 19 then
    raise exception '091: função esperada da aplicação ausente. Interromper.';
  end if;
end
$m091_pre$;

-- DEV only. Não aplicar em PROD tqeenmswotxqainkyyct.
-- Não executar este arquivo sem autorização explícita no Supabase DEV
-- jmbajdpkvlrslirwzyze.
--
-- Fecha o bloqueio do piloto encontrado na auditoria de 23/11/2026, 19h10 BRT:
-- seeds SECURITY DEFINER gravavam qualquer company_id, e PUBLIC deixava o anon
-- executar funções internas. As cinco RPCs públicas de proposta, motorista e
-- pátio permanecem. O runner Postgres continua dono de _dev_schema_migrations.
--
-- Rollback: supabase/rollbacks/091_pre_pilot_security.sql
-- SQL Editor: frontend/scripts/apply-091-sql-editor.sql

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

COMMENT ON FUNCTION public.seed_chart_of_accounts(UUID) IS
  'Popula o plano de contas da empresa se auth.uid() for membro dela.';

CREATE OR REPLACE FUNCTION public.seed_freight_rate_defaults(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seed_freight$
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

  IF EXISTS (SELECT 1 FROM public.freight_rate_tables WHERE company_id = p_company_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.freight_rate_tables
    (company_id, code, modality, vehicle_category, rate_per_km, round_trip_from_km, valid_from, status, notes)
  VALUES
    (p_company_id, 'TF001', 'Transporte', 'Van', 3.20, 500, CURRENT_DATE, 'Ativo', 'Tarifa padrão van'),
    (p_company_id, 'TF002', 'Transporte', 'MicroOnibus', 4.00, 500, CURRENT_DATE, 'Ativo', 'Tarifa micro-ônibus'),
    (p_company_id, 'TF003', 'Frete', 'Caminhao', 7.00, 500, CURRENT_DATE, 'Ativo', 'Tarifa caminhão — ida/volta ≥ 500 km'),
    (p_company_id, 'TF004', 'Frete', 'Van', 5.00, 500, CURRENT_DATE, 'Ativo', 'Frete utilitário'),
    (p_company_id, 'TF005', 'Transporte', 'Onibus', 5.50, 500, CURRENT_DATE, 'Ativo', 'Tarifa ônibus');
END;
$seed_freight$;

COMMENT ON FUNCTION public.seed_freight_rate_defaults(UUID) IS
  'Cria as tarifas padrão da empresa se auth.uid() for membro dela.';

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

COMMENT ON FUNCTION public.seed_demo_freight_os(UUID) IS
  'OS fictícia só pelo Postgres direto. Usuários da aplicação não executam.';


-- Seeds da aplicação: só authenticated. O corpo exige membro da empresa.
-- PUBLIC e anon perdem o EXECUTE efetivo. service_role também: não tem auth.uid().
REVOKE ALL ON FUNCTION public.seed_chart_of_accounts(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_chart_of_accounts(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.seed_freight_rate_defaults(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_freight_rate_defaults(uuid) TO authenticated;

-- Demo continua fora da API até existir autorização própria.
REVOKE ALL ON FUNCTION public.seed_demo_freight_os(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Helpers de RLS: authenticated e service_role. Anon deixa de herdar PUBLIC.
REVOKE ALL ON FUNCTION public.auth_user_company_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_user_has_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_user_is_company_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_company_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_has_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_is_company_admin(uuid) TO authenticated, service_role;

-- Chamadas autenticadas que já conferem sessão ou empresa.
REVOKE ALL ON FUNCTION public.next_company_document_number(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_deleted_from_audit(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_soft_deleted_from_audit(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_patio_ticket_token(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_company_document_number(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_deleted_from_audit(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_soft_deleted_from_audit(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_patio_ticket_token(text, uuid) TO authenticated, service_role;

-- Internas e trigger. O dono postgres continua executando a trigger e as RPCs
-- SECURITY DEFINER que as chamam. supabase_auth_admin mantém o cadastro.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._ap_assert_allocation_company_consistency() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._ap_assert_row_company_consistency() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._ap_can_approve(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._ap_user_display_name() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._ap_validate_ready_for_approval(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $grant_auth_admin$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
  END IF;
END
$grant_auth_admin$;

-- Páginas públicas. Não revogar.
GRANT EXECUTE ON FUNCTION public.get_public_proposal(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_driver_assignment(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_patio_ticket(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_driver_assignment(text, text) TO anon, authenticated, service_role;

-- Controle do runner. anon já não tinha GRANT. authenticated perde DML.
-- RLS sem policy é a segunda trava. O dono postgres segue inserindo o filename.
DO $dev_migrations$
BEGIN
  IF to_regclass('public._dev_schema_migrations') IS NULL THEN
    RAISE EXCEPTION '091: public._dev_schema_migrations ausente. Interromper.';
  END IF;

  REVOKE ALL ON TABLE public._dev_schema_migrations FROM PUBLIC, anon, authenticated;
  ALTER TABLE public._dev_schema_migrations ENABLE ROW LEVEL SECURITY;
END
$dev_migrations$;

COMMENT ON TABLE public._dev_schema_migrations IS
  'Controle do runner DEV. Sem policy: authenticated não lê nem grava. O dono postgres grava.';
do $m091_post$
declare
  r record;
begin
  if current_user is distinct from 'postgres' then
    raise exception '091: pós-checagem fora de postgres. Sessão: %', current_user
      using errcode = '42501';
  end if;

  for r in
    select *
    from (values
      ('public.seed_chart_of_accounts(uuid)', false, true, false, false),
      ('public.seed_freight_rate_defaults(uuid)', false, true, false, false),
      ('public.seed_demo_freight_os(uuid)', false, false, false, false),
      ('public.auth_user_company_ids()', false, true, true, false),
      ('public.auth_user_has_company(uuid)', false, true, true, false),
      ('public.auth_user_is_company_admin(uuid)', false, true, true, false),
      ('public.next_company_document_number(uuid, text, text, integer)', false, true, true, false),
      ('public.restore_deleted_from_audit(uuid, text)', false, true, true, false),
      ('public.restore_soft_deleted_from_audit(uuid, text)', false, true, true, false),
      ('public.ensure_patio_ticket_token(text, uuid)', false, true, true, false),
      ('public.handle_new_user()', false, false, false, false),
      ('public._ap_assert_allocation_company_consistency()', false, false, false, false),
      ('public._ap_assert_row_company_consistency()', false, false, false, false),
      ('public._ap_can_approve(uuid)', false, false, false, false),
      ('public._ap_user_display_name()', false, false, false, false),
      ('public._ap_validate_ready_for_approval(uuid)', false, false, false, false),
      ('public.get_public_proposal(text)', true, true, true, true),
      ('public.get_public_driver_assignment(text)', true, true, true, true),
      ('public.get_public_patio_ticket(text)', true, true, true, true),
      ('public.respond_to_proposal(text, text)', true, true, true, true),
      ('public.respond_to_driver_assignment(text, text)', true, true, true, true),
      ('public.approve_accounts_payable(uuid, text)', false, true, true, false),
      ('public.reverse_accounts_payable_postings(uuid, text)', false, true, true, false),
      ('public.post_parking_revenue(uuid)', false, true, true, false),
      ('public.post_car_wash_revenue(uuid)', false, true, true, false),
      ('public.delete_financial_transaction_audited(uuid, text, text, text)', false, true, true, false),
      ('public.correct_financial_transaction_audited(uuid, text, jsonb, text, text)', false, true, false, false)
    ) as v(sig, anon_ok, auth_ok, svc_ok, public_ok)
  loop
    if has_function_privilege('anon', r.sig, 'execute') is distinct from r.anon_ok then
      raise exception '091: anon em % = %', r.sig, has_function_privilege('anon', r.sig, 'execute');
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') is distinct from r.auth_ok then
      raise exception '091: authenticated em % = %', r.sig, has_function_privilege('authenticated', r.sig, 'execute');
    end if;
    if has_function_privilege('service_role', r.sig, 'execute') is distinct from r.svc_ok then
      raise exception '091: service_role em % = %', r.sig, has_function_privilege('service_role', r.sig, 'execute');
    end if;
    if has_function_privilege('public', r.sig, 'execute') is distinct from r.public_ok then
      raise exception '091: PUBLIC em % = %', r.sig, has_function_privilege('public', r.sig, 'execute');
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin')
     and not has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'execute') then
    raise exception '091: supabase_auth_admin perdeu handle_new_user';
  end if;

  if position('auth_user_has_company' in (
       select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seed_chart_of_accounts'
     )) > position('insert into' in lower((
       select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seed_chart_of_accounts'
     )))
     or position('auth.uid()' in (
       select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seed_freight_rate_defaults'
     )) > position('insert into' in lower((
       select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seed_freight_rate_defaults'
     )))
  then
    raise exception '091: a checagem de empresa ficou depois da gravação. Interromper.';
  end if;

  if position('bloqueada para usuários da aplicação' in (
       select prosrc from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seed_demo_freight_os'
     )) = 0
  then
    raise exception '091: seed_demo_freight_os sem o bloqueio da aplicação. Interromper.';
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = '_dev_schema_migrations'
  ) then
    raise exception '091: RLS de _dev_schema_migrations desligado. Interromper.';
  end if;

  if has_table_privilege('anon', 'public._dev_schema_migrations', 'select')
     or has_table_privilege('authenticated', 'public._dev_schema_migrations', 'select')
     or has_table_privilege('authenticated', 'public._dev_schema_migrations', 'insert')
     or has_table_privilege('authenticated', 'public._dev_schema_migrations', 'update')
     or has_table_privilege('authenticated', 'public._dev_schema_migrations', 'delete')
  then
    raise exception '091: anon ou authenticated ainda acessa _dev_schema_migrations. Interromper.';
  end if;

  if not has_table_privilege('postgres', 'public._dev_schema_migrations', 'insert') then
    raise exception '091: postgres não insere em _dev_schema_migrations. Interromper.';
  end if;
end
$m091_post$;

commit;

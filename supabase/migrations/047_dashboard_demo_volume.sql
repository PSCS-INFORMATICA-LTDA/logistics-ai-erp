-- apply-047: Base DEMO volumosa do Dashboard (últimos 4 meses, diária)
-- Substitui public.seed_dashboard_demo (CREATE OR REPLACE).
-- Frete manhã/tarde nas placas; estacionamento + lava todo dia; participaçoes 50/50.
-- Execute no SQL Editor do Supabase. Limpeza: reset-dashboard-demo.sql

CREATE OR REPLACE FUNCTION public.seed_dashboard_demo(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec_van UUID;
  v_rec_cam UUID;
  v_rec_est UUID;
  v_rec_lava UUID;
  v_desp_comb UUID;
  v_desp_ped UUID;
  v_desp_est UUID;
  v_desp_lava UUID;
  v_swu UUID;
  v_ghr UUID;
  v_tls UUID;
  v_suy UUID;
  v_rafael UUID;
  v_malu UUID;
  v_grx UUID;
  v_start DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date;
  v_end DATE := CURRENT_DATE;
  d DATE;
  dow INT;
  amt_morning NUMERIC;
  amt_afternoon NUMERIC;
  n_freight INT := 0;
BEGIN
  SELECT id INTO v_rec_van FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Receita Van' LIMIT 1;
  SELECT id INTO v_rec_cam FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Receita Caminhão' LIMIT 1;
  SELECT id INTO v_rec_est FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Receita Estacionamento' LIMIT 1;
  SELECT id INTO v_rec_lava FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Receita Lava Rápido' LIMIT 1;
  SELECT id INTO v_desp_comb FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Posto de Combustível' LIMIT 1;
  SELECT id INTO v_desp_ped FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Pedágio' LIMIT 1;
  SELECT id INTO v_desp_est FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Estacionamento' LIMIT 1;
  SELECT id INTO v_desp_lava FROM chart_of_accounts
    WHERE company_id = p_company_id AND name = 'Materiais de lava rápido' LIMIT 1;

  IF v_rec_van IS NULL OR v_rec_est IS NULL OR v_rec_lava IS NULL THEN
    RAISE EXCEPTION 'Contas DRE necessárias não encontradas. Rode seeds de chart_of_accounts / patio.';
  END IF;

  SELECT id INTO v_swu FROM vehicles
    WHERE company_id = p_company_id AND plate = 'SWU9H17' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_ghr FROM vehicles
    WHERE company_id = p_company_id AND plate = 'GHR2C77' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_tls FROM vehicles
    WHERE company_id = p_company_id AND plate = 'TLS6D65' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_suy FROM vehicles
    WHERE company_id = p_company_id AND plate = 'SUY3I05' AND deleted_at IS NULL LIMIT 1;

  -- 4ª placa se ainda não existir (frota DEMO)
  IF v_suy IS NULL THEN
    INSERT INTO vehicles (company_id, plate, brand, model, status, vehicle_category)
    VALUES (p_company_id, 'SUY3I05', 'DEMO', 'Van Executiva', 'Ativo', 'Van')
    RETURNING id INTO v_suy;
  END IF;

  SELECT id INTO v_rafael FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND name ILIKE '%rafael%' LIMIT 1;
  SELECT id INTO v_malu FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND name ILIKE '%malu%' LIMIT 1;
  SELECT id INTO v_grx FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND (name ILIKE '%grx%' OR partner_type = 'Empresa')
    ORDER BY CASE WHEN partner_type = 'Empresa' THEN 0 ELSE 1 END
    LIMIT 1;

  IF v_rafael IS NULL THEN
    INSERT INTO partners (company_id, name, partner_type, status)
    VALUES (p_company_id, 'Rafael', 'Socio', 'Ativo')
    RETURNING id INTO v_rafael;
  END IF;
  IF v_malu IS NULL THEN
    INSERT INTO partners (company_id, name, partner_type, status)
    VALUES (p_company_id, 'Malu', 'Socio', 'Ativo')
    RETURNING id INTO v_malu;
  END IF;
  IF v_grx IS NULL THEN
    INSERT INTO partners (company_id, name, partner_type, status)
    VALUES (p_company_id, 'GRX', 'Empresa', 'Ativo')
    RETURNING id INTO v_grx;
  END IF;

  -- Garante 50/50 (e 100% GRX no caminhão) nas placas DEMO
  DELETE FROM vehicle_ownership
  WHERE company_id = p_company_id
    AND vehicle_id IN (v_swu, v_ghr, v_tls, v_suy);

  IF v_swu IS NOT NULL THEN
    INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, effective_date, status)
    VALUES
      (p_company_id, v_swu, v_rafael, 50.00, v_start, 'Ativo'),
      (p_company_id, v_swu, v_malu, 50.00, v_start, 'Ativo');
  END IF;
  IF v_tls IS NOT NULL THEN
    INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, effective_date, status)
    VALUES
      (p_company_id, v_tls, v_rafael, 50.00, v_start, 'Ativo'),
      (p_company_id, v_tls, v_malu, 50.00, v_start, 'Ativo');
  END IF;
  IF v_suy IS NOT NULL THEN
    INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, effective_date, status)
    VALUES
      (p_company_id, v_suy, v_rafael, 50.00, v_start, 'Ativo'),
      (p_company_id, v_suy, v_malu, 50.00, v_start, 'Ativo');
  END IF;
  IF v_ghr IS NOT NULL THEN
    INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, effective_date, status)
    VALUES (p_company_id, v_ghr, v_grx, 100.00, v_start, 'Ativo');
  END IF;

  DELETE FROM financial_transactions
  WHERE company_id = p_company_id
    AND (
      entry_source = 'dashboard_demo'
      OR description LIKE '[DEMO-DASH]%'
    );

  d := v_start;
  WHILE d <= v_end LOOP
    dow := EXTRACT(ISODOW FROM d)::INT; -- 1=seg .. 7=dom

    -- Frete: 4 placas; vans com manhã + tarde; caminhão 1 viagem (2 aos sábados)
    -- SWU — manhã + tarde (exceto domingo: só manhã)
    IF v_swu IS NOT NULL THEN
      amt_morning := 780 + (EXTRACT(DAY FROM d)::INT % 7) * 35 + (dow * 12);
      amt_afternoon := 620 + (EXTRACT(DAY FROM d)::INT % 5) * 28 + (dow * 9);
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d, amt_morning, v_rec_van,
         'Receitas', 'Receita', v_swu, v_swu,
         '[DEMO-DASH] Frete manhã SWU9H17', 'dashboard_demo');
      n_freight := n_freight + 1;
      IF dow < 7 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, amt_afternoon, v_rec_van,
           'Receitas', 'Receita', v_swu, v_swu,
           '[DEMO-DASH] Frete tarde SWU9H17', 'dashboard_demo');
        n_freight := n_freight + 1;
      END IF;
      IF v_desp_comb IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 3) = 0 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 180 + dow * 8, v_desp_comb,
           'Administrativo', 'Despesa', v_swu, v_swu,
           '[DEMO-DASH] Combustível SWU9H17', 'dashboard_demo');
      END IF;
      IF v_desp_ped IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 4) = 1 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 45 + dow * 3, v_desp_ped,
           'Administrativo', 'Despesa', v_swu, v_swu,
           '[DEMO-DASH] Pedágio SWU9H17', 'dashboard_demo');
      END IF;
    END IF;

    -- TLS — manhã + tarde
    IF v_tls IS NOT NULL THEN
      amt_morning := 720 + (EXTRACT(DAY FROM d)::INT % 6) * 30;
      amt_afternoon := 590 + (EXTRACT(DAY FROM d)::INT % 4) * 25;
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d, amt_morning, v_rec_van,
         'Receitas', 'Receita', v_tls, v_tls,
         '[DEMO-DASH] Frete manhã TLS6D65', 'dashboard_demo'),
        (p_company_id, d, CASE WHEN dow = 7 THEN amt_afternoon * 0.6 ELSE amt_afternoon END, v_rec_van,
         'Receitas', 'Receita', v_tls, v_tls,
         '[DEMO-DASH] Frete tarde TLS6D65', 'dashboard_demo');
      n_freight := n_freight + 2;
      IF v_desp_comb IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 3) = 1 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 160 + dow * 7, v_desp_comb,
           'Administrativo', 'Despesa', v_tls, v_tls,
           '[DEMO-DASH] Combustível TLS6D65', 'dashboard_demo');
      END IF;
    END IF;

    -- SUY — manhã + tarde (volume alto)
    IF v_suy IS NOT NULL THEN
      amt_morning := 690 + (EXTRACT(DAY FROM d)::INT % 8) * 22;
      amt_afternoon := 610 + (EXTRACT(DAY FROM d)::INT % 5) * 27;
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d, amt_morning, v_rec_van,
         'Receitas', 'Receita', v_suy, v_suy,
         '[DEMO-DASH] Frete manhã SUY3I05', 'dashboard_demo'),
        (p_company_id, d, amt_afternoon, v_rec_van,
         'Receitas', 'Receita', v_suy, v_suy,
         '[DEMO-DASH] Frete tarde SUY3I05', 'dashboard_demo');
      n_freight := n_freight + 2;
      IF v_desp_comb IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 2) = 0 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 150 + dow * 6, v_desp_comb,
           'Administrativo', 'Despesa', v_suy, v_suy,
           '[DEMO-DASH] Combustível SUY3I05', 'dashboard_demo');
      END IF;
    END IF;

    -- GHR caminhão — 1 frete/dia; sábado também tarde
    IF v_ghr IS NOT NULL THEN
      amt_morning := 1450 + (EXTRACT(DAY FROM d)::INT % 9) * 40;
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d, amt_morning, COALESCE(v_rec_cam, v_rec_van),
         'Receitas', 'Receita', v_ghr, v_ghr,
         '[DEMO-DASH] Frete GHR2C77 (100% GRX)', 'dashboard_demo');
      n_freight := n_freight + 1;
      IF dow = 6 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, amt_morning * 0.85, COALESCE(v_rec_cam, v_rec_van),
           'Receitas', 'Receita', v_ghr, v_ghr,
           '[DEMO-DASH] Frete tarde GHR2C77', 'dashboard_demo');
        n_freight := n_freight + 1;
      END IF;
      IF v_desp_comb IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 2) = 1 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 320 + dow * 15, v_desp_comb,
           'Administrativo', 'Despesa', v_ghr, v_ghr,
           '[DEMO-DASH] Combustível GHR2C77', 'dashboard_demo');
      END IF;
      IF v_desp_ped IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 3) = 0 THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d, 95 + dow * 5, v_desp_ped,
           'Administrativo', 'Despesa', v_ghr, v_ghr,
           '[DEMO-DASH] Pedágio GHR2C77', 'dashboard_demo');
      END IF;
    END IF;

    -- Estacionamento diário
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    ) VALUES
      (p_company_id, d, 220 + dow * 18 + (EXTRACT(DAY FROM d)::INT % 5) * 12, v_rec_est,
       'Receitas', 'Receita', '[DEMO-DASH] Receita Estacionamento', 'dashboard_demo');
    IF v_desp_est IS NOT NULL AND dow <= 6 THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, description, entry_source
      ) VALUES
        (p_company_id, d, 35 + dow * 2, v_desp_est,
         'Administrativo', 'Despesa', '[DEMO-DASH] Custo Estacionamento', 'dashboard_demo');
    END IF;

    -- Lava-rápido diário (domingo menor)
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    ) VALUES
      (p_company_id, d,
       CASE WHEN dow = 7 THEN 90 + dow * 5 ELSE 140 + dow * 11 + (EXTRACT(DAY FROM d)::INT % 4) * 8 END,
       v_rec_lava,
       'Receitas', 'Receita', '[DEMO-DASH] Receita Lava Rápido', 'dashboard_demo');
    IF v_desp_lava IS NOT NULL AND (EXTRACT(DAY FROM d)::INT % 2) = 0 THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, description, entry_source
      ) VALUES
        (p_company_id, d, 28 + dow, v_desp_lava,
         'Administrativo', 'Despesa', '[DEMO-DASH] Materiais lava rápido', 'dashboard_demo');
    END IF;

    d := d + 1;
  END LOOP;

  RAISE NOTICE 'seed_dashboard_demo: % fretes + pátio de % a %', n_freight, v_start, v_end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_dashboard_demo(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.seed_dashboard_demo(UUID) IS
  'Base DEMO volumosa (4 meses diários): frete manhã/tarde, estacionamento, lava e ownership 50/50. Remover com reset-dashboard-demo.sql.';

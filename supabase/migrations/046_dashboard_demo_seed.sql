-- 046 (mirror apply-046): Seed DEMO do Dashboard (Frete / Estacionamento / Lava + rateio)
-- Execute no SQL Editor do Supabase (base atual — não há ambiente de desenvolvimento separado).
-- Lançamentos marcados com description '[DEMO-DASH]...' e entry_source = 'dashboard_demo'.
-- Limpeza só-DEMO: reset-dashboard-demo.sql (limpeza total do sistema = update futuro).

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
  d0 DATE := date_trunc('month', CURRENT_DATE)::date;
  m INT;
  day_offset INT;
BEGIN
  -- Contas
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

  -- Remove DEMO anterior desta empresa
  DELETE FROM financial_transactions
  WHERE company_id = p_company_id
    AND (
      entry_source = 'dashboard_demo'
      OR description LIKE '[DEMO-DASH]%'
    );

  FOR m IN 0..2 LOOP
    day_offset := m * 30;

    -- Frete / Transporte (receitas + despesas) rateadas nas vans
    IF v_swu IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d0 - day_offset + 3, 8500 + m * 400, v_rec_van,
         'Receitas', 'Receita', v_swu, v_swu,
         '[DEMO-DASH] Frete/Transporte SWU9H17', 'dashboard_demo');
      IF v_desp_comb IS NOT NULL THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d0 - day_offset + 5, 1200 + m * 80, v_desp_comb,
           'Administrativo', 'Despesa', v_swu, v_swu,
           '[DEMO-DASH] Combustível SWU9H17', 'dashboard_demo');
      END IF;
      IF v_desp_ped IS NOT NULL THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d0 - day_offset + 6, 380 + m * 20, v_desp_ped,
           'Administrativo', 'Despesa', v_swu, v_swu,
           '[DEMO-DASH] Pedágio SWU9H17', 'dashboard_demo');
      END IF;
    END IF;

    IF v_ghr IS NOT NULL AND v_rec_cam IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d0 - day_offset + 4, 6200 + m * 250, v_rec_cam,
         'Receitas', 'Receita', v_ghr, v_ghr,
         '[DEMO-DASH] Frete GHR2C77 (100% GRX)', 'dashboard_demo');
      IF v_desp_comb IS NOT NULL THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d0 - day_offset + 7, 900 + m * 50, v_desp_comb,
           'Administrativo', 'Despesa', v_ghr, v_ghr,
           '[DEMO-DASH] Combustível GHR2C77', 'dashboard_demo');
      END IF;
    END IF;

    IF v_tls IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      ) VALUES
        (p_company_id, d0 - day_offset + 8, 4100 + m * 150, v_rec_van,
         'Receitas', 'Receita', v_tls, v_tls,
         '[DEMO-DASH] Transporte TLS6D65 (50/50)', 'dashboard_demo');
      IF v_desp_comb IS NOT NULL THEN
        INSERT INTO financial_transactions (
          company_id, transaction_date, amount, chart_of_account_id,
          classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
          description, entry_source
        ) VALUES
          (p_company_id, d0 - day_offset + 9, 700 + m * 40, v_desp_comb,
           'Administrativo', 'Despesa', v_tls, v_tls,
           '[DEMO-DASH] Combustível TLS6D65', 'dashboard_demo');
      END IF;
    END IF;

    -- Estacionamento
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    ) VALUES
      (p_company_id, d0 - day_offset + 10, 2800 + m * 200, v_rec_est,
       'Receitas', 'Receita', '[DEMO-DASH] Receita Estacionamento', 'dashboard_demo');

    IF v_desp_est IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, description, entry_source
      ) VALUES
        (p_company_id, d0 - day_offset + 11, 450 + m * 30, v_desp_est,
         'Administrativo', 'Despesa', '[DEMO-DASH] Custo Estacionamento', 'dashboard_demo');
    END IF;

    -- Lava-rápido
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    ) VALUES
      (p_company_id, d0 - day_offset + 12, 1900 + m * 120, v_rec_lava,
       'Receitas', 'Receita', '[DEMO-DASH] Receita Lava Rápido', 'dashboard_demo');

    IF v_desp_lava IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, description, entry_source
      ) VALUES
        (p_company_id, d0 - day_offset + 13, 320 + m * 25, v_desp_lava,
         'Administrativo', 'Despesa', '[DEMO-DASH] Materiais lava rápido', 'dashboard_demo');
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_dashboard_demo(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.seed_dashboard_demo(UUID) IS
  'Insere lançamentos fictícios [DEMO-DASH] para visualizar o Dashboard. Remover com reset-dashboard-demo.sql.';

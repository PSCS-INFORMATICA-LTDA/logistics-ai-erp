-- apply-047: Base DEMO volumosa do Dashboard (últimos 4 meses, diária)
-- Correções: vehicles.code (sem brand), partners.code, inserts em lote (evita timeout).
-- Execute TODO este arquivo no SQL Editor do Supabase (Run).

DROP FUNCTION IF EXISTS public.seed_dashboard_demo(UUID);

CREATE OR REPLACE FUNCTION public.seed_dashboard_demo(p_company_id UUID)
RETURNS TEXT
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
  v_count BIGINT;
  v_date_col TEXT;
  v_pct_50 NUMERIC;
  v_pct_100 NUMERIC;
BEGIN
  -- Produção pode ter start_date (legado) ou effective_date (migration 004)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_ownership' AND column_name = 'effective_date'
  ) THEN
    v_date_col := 'effective_date';
    v_pct_50 := 50.00;
    v_pct_100 := 100.00;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_ownership' AND column_name = 'start_date'
  ) THEN
    v_date_col := 'start_date';
    -- Escala unitária legada (0.5 = 50%)
    v_pct_50 := 0.50;
    v_pct_100 := 1.00;
  ELSE
    RAISE EXCEPTION 'vehicle_ownership sem coluna effective_date nem start_date';
  END IF;
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
    RAISE EXCEPTION 'Contas DRE necessárias não encontradas (Receita Van / Estacionamento / Lava Rápido).';
  END IF;

  SELECT id INTO v_swu FROM vehicles
    WHERE company_id = p_company_id AND plate = 'SWU9H17' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_ghr FROM vehicles
    WHERE company_id = p_company_id AND plate = 'GHR2C77' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_tls FROM vehicles
    WHERE company_id = p_company_id AND plate = 'TLS6D65' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_suy FROM vehicles
    WHERE company_id = p_company_id AND plate = 'SUY3I05' AND deleted_at IS NULL LIMIT 1;

  IF v_suy IS NULL THEN
    INSERT INTO vehicles (company_id, code, plate, plate_display, model, status, vehicle_category)
    VALUES (p_company_id, 'VEI-SUY3I05', 'SUY3I05', 'SUY3I05', 'Van Executiva', 'Ativo', 'Van')
    RETURNING id INTO v_suy;
  END IF;

  SELECT id INTO v_rafael FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL AND name ILIKE '%rafael%' LIMIT 1;
  SELECT id INTO v_malu FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL AND name ILIKE '%malu%' LIMIT 1;
  SELECT id INTO v_grx FROM partners
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND (name ILIKE '%grx%' OR partner_type = 'Empresa')
    ORDER BY CASE WHEN partner_type = 'Empresa' THEN 0 ELSE 1 END
    LIMIT 1;

  IF v_rafael IS NULL THEN
    INSERT INTO partners (company_id, code, name, partner_type, status)
    VALUES (p_company_id, 'SOC-RAFAEL-DEMO', 'Rafael', 'Socio', 'Ativo')
    RETURNING id INTO v_rafael;
  END IF;
  IF v_malu IS NULL THEN
    INSERT INTO partners (company_id, code, name, partner_type, status)
    VALUES (p_company_id, 'SOC-MALU-DEMO', 'Malu', 'Socio', 'Ativo')
    RETURNING id INTO v_malu;
  END IF;
  IF v_grx IS NULL THEN
    INSERT INTO partners (company_id, code, name, partner_type, status)
    VALUES (p_company_id, 'EMP-GRX-DEMO', 'GRX', 'Empresa', 'Ativo')
    RETURNING id INTO v_grx;
  END IF;

  DELETE FROM vehicle_ownership
  WHERE company_id = p_company_id
    AND vehicle_id IN (v_swu, v_ghr, v_tls, v_suy);

  IF v_swu IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, %I, status)
       VALUES ($1,$2,$3,$4,$5,''Ativo''), ($1,$2,$6,$4,$5,''Ativo'')',
      v_date_col
    ) USING p_company_id, v_swu, v_rafael, v_pct_50, v_start, v_malu;
  END IF;
  IF v_tls IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, %I, status)
       VALUES ($1,$2,$3,$4,$5,''Ativo''), ($1,$2,$6,$4,$5,''Ativo'')',
      v_date_col
    ) USING p_company_id, v_tls, v_rafael, v_pct_50, v_start, v_malu;
  END IF;
  IF v_suy IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, %I, status)
       VALUES ($1,$2,$3,$4,$5,''Ativo''), ($1,$2,$6,$4,$5,''Ativo'')',
      v_date_col
    ) USING p_company_id, v_suy, v_rafael, v_pct_50, v_start, v_malu;
  END IF;
  IF v_ghr IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO vehicle_ownership (company_id, vehicle_id, partner_id, ownership_percentage, %I, status)
       VALUES ($1,$2,$3,$4,$5,''Ativo'')',
      v_date_col
    ) USING p_company_id, v_ghr, v_grx, v_pct_100, v_start;
  END IF;

  DELETE FROM financial_transactions
  WHERE company_id = p_company_id
    AND (
      entry_source = 'dashboard_demo'
      OR description LIKE '[DEMO-DASH]%'
    );

  -- ===== Frete SWU manhã =====
  IF v_swu IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date,
      780 + (EXTRACT(DAY FROM d)::INT % 7) * 35 + (EXTRACT(ISODOW FROM d)::INT * 12),
      v_rec_van, 'Receitas', 'Receita', v_swu, v_swu,
      '[DEMO-DASH] Frete manhã SWU9H17', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date,
      620 + (EXTRACT(DAY FROM d)::INT % 5) * 28 + (EXTRACT(ISODOW FROM d)::INT * 9),
      v_rec_van, 'Receitas', 'Receita', v_swu, v_swu,
      '[DEMO-DASH] Frete tarde SWU9H17', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d
    WHERE EXTRACT(ISODOW FROM d)::INT < 7;

    IF v_desp_comb IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 180 + EXTRACT(ISODOW FROM d)::INT * 8,
        v_desp_comb, 'Administrativo', 'Despesa', v_swu, v_swu,
        '[DEMO-DASH] Combustível SWU9H17', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 3) = 0;
    END IF;

    IF v_desp_ped IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 45 + EXTRACT(ISODOW FROM d)::INT * 3,
        v_desp_ped, 'Administrativo', 'Despesa', v_swu, v_swu,
        '[DEMO-DASH] Pedágio SWU9H17', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 4) = 1;
    END IF;
  END IF;

  -- ===== Frete TLS =====
  IF v_tls IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date, 720 + (EXTRACT(DAY FROM d)::INT % 6) * 30,
      v_rec_van, 'Receitas', 'Receita', v_tls, v_tls,
      '[DEMO-DASH] Frete manhã TLS6D65', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date,
      CASE WHEN EXTRACT(ISODOW FROM d)::INT = 7
        THEN (590 + (EXTRACT(DAY FROM d)::INT % 4) * 25) * 0.6
        ELSE 590 + (EXTRACT(DAY FROM d)::INT % 4) * 25
      END,
      v_rec_van, 'Receitas', 'Receita', v_tls, v_tls,
      '[DEMO-DASH] Frete tarde TLS6D65', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    IF v_desp_comb IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 160 + EXTRACT(ISODOW FROM d)::INT * 7,
        v_desp_comb, 'Administrativo', 'Despesa', v_tls, v_tls,
        '[DEMO-DASH] Combustível TLS6D65', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 3) = 1;
    END IF;
  END IF;

  -- ===== Frete SUY =====
  IF v_suy IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date, 690 + (EXTRACT(DAY FROM d)::INT % 8) * 22,
      v_rec_van, 'Receitas', 'Receita', v_suy, v_suy,
      '[DEMO-DASH] Frete manhã SUY3I05', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date, 610 + (EXTRACT(DAY FROM d)::INT % 5) * 27,
      v_rec_van, 'Receitas', 'Receita', v_suy, v_suy,
      '[DEMO-DASH] Frete tarde SUY3I05', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    IF v_desp_comb IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 150 + EXTRACT(ISODOW FROM d)::INT * 6,
        v_desp_comb, 'Administrativo', 'Despesa', v_suy, v_suy,
        '[DEMO-DASH] Combustível SUY3I05', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 2) = 0;
    END IF;
  END IF;

  -- ===== Frete GHR =====
  IF v_ghr IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date, 1450 + (EXTRACT(DAY FROM d)::INT % 9) * 40,
      COALESCE(v_rec_cam, v_rec_van), 'Receitas', 'Receita', v_ghr, v_ghr,
      '[DEMO-DASH] Frete GHR2C77 (100% GRX)', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
      description, entry_source
    )
    SELECT
      p_company_id, d::date, (1450 + (EXTRACT(DAY FROM d)::INT % 9) * 40) * 0.85,
      COALESCE(v_rec_cam, v_rec_van), 'Receitas', 'Receita', v_ghr, v_ghr,
      '[DEMO-DASH] Frete tarde GHR2C77', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d
    WHERE EXTRACT(ISODOW FROM d)::INT = 6;

    IF v_desp_comb IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 320 + EXTRACT(ISODOW FROM d)::INT * 15,
        v_desp_comb, 'Administrativo', 'Despesa', v_ghr, v_ghr,
        '[DEMO-DASH] Combustível GHR2C77', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 2) = 1;
    END IF;

    IF v_desp_ped IS NOT NULL THEN
      INSERT INTO financial_transactions (
        company_id, transaction_date, amount, chart_of_account_id,
        classification, transaction_type, allocation_vehicle_id, operational_vehicle_id,
        description, entry_source
      )
      SELECT
        p_company_id, d::date, 95 + EXTRACT(ISODOW FROM d)::INT * 5,
        v_desp_ped, 'Administrativo', 'Despesa', v_ghr, v_ghr,
        '[DEMO-DASH] Pedágio GHR2C77', 'dashboard_demo'
      FROM generate_series(v_start, v_end, '1 day'::interval) AS d
      WHERE (EXTRACT(DAY FROM d)::INT % 3) = 0;
    END IF;
  END IF;

  -- ===== Estacionamento diário =====
  INSERT INTO financial_transactions (
    company_id, transaction_date, amount, chart_of_account_id,
    classification, transaction_type, description, entry_source
  )
  SELECT
    p_company_id, d::date,
    220 + EXTRACT(ISODOW FROM d)::INT * 18 + (EXTRACT(DAY FROM d)::INT % 5) * 12,
    v_rec_est, 'Receitas', 'Receita',
    '[DEMO-DASH] Receita Estacionamento', 'dashboard_demo'
  FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

  IF v_desp_est IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    )
    SELECT
      p_company_id, d::date, 35 + EXTRACT(ISODOW FROM d)::INT * 2,
      v_desp_est, 'Administrativo', 'Despesa',
      '[DEMO-DASH] Custo Estacionamento', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d
    WHERE EXTRACT(ISODOW FROM d)::INT <= 6;
  END IF;

  -- ===== Lava diário =====
  INSERT INTO financial_transactions (
    company_id, transaction_date, amount, chart_of_account_id,
    classification, transaction_type, description, entry_source
  )
  SELECT
    p_company_id, d::date,
    CASE WHEN EXTRACT(ISODOW FROM d)::INT = 7
      THEN 90 + EXTRACT(ISODOW FROM d)::INT * 5
      ELSE 140 + EXTRACT(ISODOW FROM d)::INT * 11 + (EXTRACT(DAY FROM d)::INT % 4) * 8
    END,
    v_rec_lava, 'Receitas', 'Receita',
    '[DEMO-DASH] Receita Lava Rápido', 'dashboard_demo'
  FROM generate_series(v_start, v_end, '1 day'::interval) AS d;

  IF v_desp_lava IS NOT NULL THEN
    INSERT INTO financial_transactions (
      company_id, transaction_date, amount, chart_of_account_id,
      classification, transaction_type, description, entry_source
    )
    SELECT
      p_company_id, d::date, 28 + EXTRACT(ISODOW FROM d)::INT,
      v_desp_lava, 'Administrativo', 'Despesa',
      '[DEMO-DASH] Materiais lava rápido', 'dashboard_demo'
    FROM generate_series(v_start, v_end, '1 day'::interval) AS d
    WHERE (EXTRACT(DAY FROM d)::INT % 2) = 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM financial_transactions
  WHERE company_id = p_company_id
    AND entry_source = 'dashboard_demo';

  RETURN format(
    'OK: %s lançamentos DEMO de %s a %s (SWU=%s TLS=%s SUY=%s GHR=%s)',
    v_count, v_start, v_end,
    v_swu IS NOT NULL, v_tls IS NOT NULL, v_suy IS NOT NULL, v_ghr IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_dashboard_demo(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.seed_dashboard_demo(UUID) IS
  'Base DEMO volumosa (4 meses diários). Remover com reset-dashboard-demo.sql.';

-- ========== FINAL: carrega a base na 1ª empresa ==========
-- Rode o arquivo inteiro. Se quiser só o seed depois, use só este SELECT:
SELECT public.seed_dashboard_demo(c.id) AS resultado
FROM public.companies c
ORDER BY c.created_at
LIMIT 1;

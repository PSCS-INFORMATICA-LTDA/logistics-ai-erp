-- Aplicar no SQL Editor do Supabase (produção / desenvolvimento)
-- Equivalente: supabase/migrations/043_freight_rate_tables.sql

-- Cadastro mestre de tarifas R$/km (Frete / Transporte) com vigência e regra ida/volta
-- Migration: 043_freight_rate_tables.sql

CREATE TABLE IF NOT EXISTS public.freight_rate_tables (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    code                 TEXT NOT NULL,
    modality             TEXT NOT NULL
                         CHECK (modality IN ('Frete', 'Transporte')),
    vehicle_category     TEXT NOT NULL
                         CHECK (vehicle_category IN (
                           'Van', 'Onibus', 'Caminhao', 'MicroOnibus', 'Outro'
                         )),
    rate_per_km          NUMERIC(8,4) NOT NULL CHECK (rate_per_km > 0),
    round_trip_from_km   NUMERIC(10,2) NOT NULL DEFAULT 500
                         CHECK (round_trip_from_km >= 0),
    valid_from           DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until          DATE,
    status               TEXT NOT NULL DEFAULT 'Ativo'
                         CHECK (status IN ('Ativo', 'Inativo')),
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, code),
    CONSTRAINT chk_freight_rate_valid_range CHECK (
      valid_until IS NULL OR valid_until >= valid_from
    )
);

CREATE INDEX IF NOT EXISTS idx_freight_rate_lookup
  ON public.freight_rate_tables (
    company_id, modality, vehicle_category, status, valid_from DESC
  );

DROP TRIGGER IF EXISTS trg_freight_rate_tables_updated_at ON public.freight_rate_tables;
CREATE TRIGGER trg_freight_rate_tables_updated_at
  BEFORE UPDATE ON public.freight_rate_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.freight_rate_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS freight_rate_tables_all ON public.freight_rate_tables;
CREATE POLICY freight_rate_tables_all ON public.freight_rate_tables
  FOR ALL USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

CREATE OR REPLACE FUNCTION public.seed_freight_rate_defaults(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_freight_rate_defaults(r.id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_freight_rate_defaults(UUID) TO authenticated, service_role;

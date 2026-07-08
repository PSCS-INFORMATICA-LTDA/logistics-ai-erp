-- Cadastro de motoristas — colunas CNH ausentes no Supabase
-- Cole no SQL Editor do Supabase e execute tudo de uma vez.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS cnh_number TEXT,
  ADD COLUMN IF NOT EXISTS cnh_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS cnh_categories TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.drivers.cnh_number IS 'Número da CNH do motorista.';
COMMENT ON COLUMN public.drivers.cnh_expiry_date IS 'Data de vencimento da CNH.';
COMMENT ON COLUMN public.drivers.cnh_categories IS
  'Categorias habilitadas na CNH (ex.: B, C, AB). Permite múltiplas seleções.';

CREATE INDEX IF NOT EXISTS idx_drivers_cnh_expiry
  ON public.drivers(company_id, cnh_expiry_date)
  WHERE cnh_expiry_date IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_cnh_categories
  ON public.drivers USING GIN (cnh_categories)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';

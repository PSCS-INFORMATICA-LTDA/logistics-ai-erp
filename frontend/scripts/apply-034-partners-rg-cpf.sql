-- Aplicar no SQL Editor do Supabase (produção)
-- Equivalente: supabase/migrations/034_partners_rg_cpf.sql

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS rg TEXT,
  ADD COLUMN IF NOT EXISTS cpf TEXT;

COMMENT ON COLUMN public.partners.name IS 'Nome completo do sócio / parceiro / empresa.';
COMMENT ON COLUMN public.partners.rg IS 'Número do RG do sócio (pessoa física).';
COMMENT ON COLUMN public.partners.cpf IS 'CPF do sócio (pessoa física) ou CNPJ quando Empresa.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_partners_company_cpf
  ON public.partners (company_id, cpf)
  WHERE cpf IS NOT NULL AND btrim(cpf) <> '' AND deleted_at IS NULL;

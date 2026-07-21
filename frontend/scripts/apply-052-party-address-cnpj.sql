-- apply-052: Endereço completo + IE + situação CNPJ (clients, suppliers, companies)
-- Execute no SQL Editor do Supabase (produção / projeto do cliente).
-- Equivalente: supabase/migrations/052_party_address_cnpj.sql

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS state_registration TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_status TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_checked_at TIMESTAMPTZ;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS state_registration TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_status TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_checked_at TIMESTAMPTZ;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS state_registration TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_status TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.clients.cnpj_status IS 'Situação cadastral na Receita (ex.: ATIVA), via consulta CNPJ.';
COMMENT ON COLUMN public.suppliers.cnpj_status IS 'Situação cadastral na Receita (ex.: ATIVA), via consulta CNPJ.';
COMMENT ON COLUMN public.companies.cnpj_status IS 'Situação cadastral na Receita (ex.: ATIVA), via consulta CNPJ.';

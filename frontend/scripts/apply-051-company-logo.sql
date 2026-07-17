-- apply-051: Logo da empresa (cadastro → voucher/proposta/header)
-- Execute no SQL Editor do Supabase (produção).
-- Equivalente: supabase/migrations/051_company_logo.sql

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_storage_path TEXT;

COMMENT ON COLUMN public.companies.logo_storage_path IS
  'Caminho no Storage (company-attachments) do logo da empresa (voucher/proposta/e-mail).';

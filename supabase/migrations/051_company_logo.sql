-- Logo da empresa adquirente (voucher, proposta, header white-label)

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_storage_path TEXT;

COMMENT ON COLUMN public.companies.logo_storage_path IS
  'Caminho no Storage (company-attachments) do logo da empresa (voucher/proposta/e-mail).';

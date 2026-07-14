-- Aplicar no SQL Editor do Supabase (produção / desenvolvimento)
-- Equivalente: supabase/migrations/040_driver_photo.sql

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS photo_storage_path TEXT;

COMMENT ON COLUMN public.drivers.photo_storage_path IS
  'Caminho no Storage (company-attachments) da foto do motorista usada no voucher.';

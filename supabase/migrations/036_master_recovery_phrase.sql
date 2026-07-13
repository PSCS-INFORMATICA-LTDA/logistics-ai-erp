-- GRX Management — Frase de recuperação da senha master
-- Migration: 036_master_recovery_phrase.sql

ALTER TABLE public.company_security_settings
  ADD COLUMN IF NOT EXISTS recovery_phrase_salt TEXT,
  ADD COLUMN IF NOT EXISTS recovery_phrase_hash TEXT;

COMMENT ON COLUMN public.company_security_settings.recovery_phrase_salt IS
  'Salt da frase de recuperação da senha master.';
COMMENT ON COLUMN public.company_security_settings.recovery_phrase_hash IS
  'Hash SHA-256 da frase de recuperação normalizada.';

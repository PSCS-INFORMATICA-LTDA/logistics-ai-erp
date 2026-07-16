-- Motivo obrigatório na exclusão (auditoria)
-- Migration: 049_deletion_audit_reason.sql

ALTER TABLE public.deletion_audit_events
  ADD COLUMN IF NOT EXISTS reason TEXT;

COMMENT ON COLUMN public.deletion_audit_events.reason IS
  'Motivo informado pelo usuário no momento da exclusão.';

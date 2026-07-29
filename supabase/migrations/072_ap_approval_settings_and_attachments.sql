-- Configuração de aprovação AP + entity_types de anexos
-- cash_flow_entries: estrutura LEGADA — não excluir, não bloquear writes nesta fase;
--   não desenvolver novas features; analisar dependências antes de qualquer bloqueio futuro.

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_approval_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_auto_approve_below_amount NUMERIC(14,2)
  CHECK (ap_auto_approve_below_amount IS NULL OR ap_auto_approve_below_amount >= 0);

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_approver_mode TEXT NOT NULL DEFAULT 'admin'
  CHECK (ap_approver_mode IN ('admin', 'admin_or_master', 'master_only'));

COMMENT ON COLUMN public.company_financial_approval_settings.ap_approval_enabled IS
  'Se false, título AP definitivo nasce approved (MVP).';
COMMENT ON COLUMN public.company_financial_approval_settings.ap_auto_approve_below_amount IS
  'Auto-aprova AP abaixo deste valor quando aprovação está ligada.';
COMMENT ON COLUMN public.company_financial_approval_settings.ap_approver_mode IS
  'Quem aprova AP no MVP: admin | admin_or_master | master_only.';

COMMENT ON TABLE public.cash_flow_entries IS
  'LEGADO (planilha Fluxo de caixa). Contas a Pagar Fase 1 NÃO usa esta tabela como motor.
   Previsto/realizado MVP = parcelas abertas / payments. Não excluir; não bloquear writes nesta fase.
   Avaliar dependências antes de write-guard futuro.';

-- Ampliar CHECK de attachments (recria constraint)
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type IN (
    'branch', 'partner', 'vehicle', 'driver', 'client', 'supplier',
    'financial_transaction', 'cash_flow_entry', 'parking_entry',
    'service_order', 'vehicle_event', 'traffic_infraction',
    'car_wash_service', 'compliance_document',
    'accounts_payable', 'accounts_payable_payment', 'company_financial_account'
  ));

-- Volta a OS para «Designar motorista» (teste do fluxo com valores motorista/ajudante)
-- Cole no SQL Editor do Supabase. Ajuste o código da OS se não for OS001.

-- ========== 1) Reset OS001 (padrão de teste) ==========
UPDATE public.service_orders
SET
  -- Proposta aceita pelo cliente (mantém)
  proposal_response = 'accepted',
  proposal_rejected_at = NULL,
  proposal_accepted_at = COALESCE(proposal_accepted_at, NOW()),
  proposal_sent_at = COALESCE(proposal_sent_at, NOW()),
  status = 'Aberto',
  -- Designação limpa → botão «Designar motorista»
  driver_id = NULL,
  proposed_driver_id = NULL,
  driver_assignment_sent_at = NULL,
  driver_assignment_response = 'pending',
  driver_assignment_accepted_at = NULL,
  driver_assignment_rejected_at = NULL,
  driver_assignment_rejected_driver_ids = '{}',
  driver_assignment_pay_amount = NULL,
  driver_assignment_assistant_pay_amount = NULL,
  -- Conclusão / acompanhamento (se migration 029 aplicada)
  service_follow_up_count = 0,
  service_last_follow_up_at = NULL,
  service_completed_at = NULL
WHERE code = 'OS001';

-- ========== 2) Conferir (deve mostrar «Aguardando designação motorista» na lista) ==========
SELECT
  code,
  status,
  proposal_response,
  proposal_accepted_at IS NOT NULL AS proposta_aceita,
  driver_id,
  proposed_driver_id,
  driver_assignment_response,
  driver_assignment_sent_at,
  driver_assignment_pay_amount,
  driver_assignment_assistant_pay_amount,
  driver_assignment_rejected_driver_ids,
  service_follow_up_count,
  service_completed_at
FROM public.service_orders
WHERE code = 'OS001';

-- ========== Opcional: outra OS pelo código ==========
-- UPDATE public.service_orders SET ... (mesmos campos) WHERE code = 'OS002';

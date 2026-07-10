-- Corrige OS001 presa em «Aceita pelo cliente» sem botão Designar motorista
-- (driver_id ou designação fantasma sem confirmação)

UPDATE public.service_orders
SET
  driver_id = NULL,
  proposed_driver_id = NULL,
  driver_assignment_sent_at = NULL,
  driver_assignment_response = 'pending',
  driver_assignment_accepted_at = NULL,
  driver_assignment_rejected_at = NULL,
  proposal_response = 'accepted',
  status = 'Aberto'
WHERE code = 'OS001';

SELECT
  code,
  proposal_response,
  driver_id,
  proposed_driver_id,
  driver_assignment_response,
  driver_assignment_sent_at
FROM public.service_orders
WHERE code = 'OS001';

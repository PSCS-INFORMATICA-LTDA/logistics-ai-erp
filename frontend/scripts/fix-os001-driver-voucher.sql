-- Corrige OS001 para exibir o botão «Voucher motorista»
-- (vincula motorista designado e aceite quando faltarem no registro)

UPDATE public.service_orders so
SET
  driver_id = COALESCE(
    so.driver_id,
    so.proposed_driver_id,
    (
      SELECT d.id
      FROM public.drivers d
      WHERE d.company_id = so.company_id
        AND d.deleted_at IS NULL
        AND (d.code = 'MOT001' OR d.name ILIKE '%Agregado%')
      ORDER BY d.created_at ASC
      LIMIT 1
    )
  ),
  proposed_driver_id = COALESCE(
    so.proposed_driver_id,
    so.driver_id,
    (
      SELECT d.id
      FROM public.drivers d
      WHERE d.company_id = so.company_id
        AND d.deleted_at IS NULL
        AND (d.code = 'MOT001' OR d.name ILIKE '%Agregado%')
      ORDER BY d.created_at ASC
      LIMIT 1
    )
  ),
  driver_assignment_response = 'accepted',
  driver_assignment_accepted_at = COALESCE(so.driver_assignment_accepted_at, NOW()),
  proposal_response = COALESCE(NULLIF(so.proposal_response, 'pending'), 'accepted'),
  proposal_accepted_at = COALESCE(so.proposal_accepted_at, NOW())
WHERE so.code = 'OS001';

SELECT
  code,
  status,
  proposal_response,
  driver_id,
  proposed_driver_id,
  driver_assignment_response,
  driver_assignment_pay_amount
FROM public.service_orders
WHERE code = 'OS001';

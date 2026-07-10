-- Backfill valores de pagamento na OS001 (quando WhatsApp enviou mas o banco não gravou)
-- Cole no SQL Editor do Supabase e ajuste os valores se necessário.

UPDATE public.service_orders
SET
  driver_assignment_pay_amount = COALESCE(driver_assignment_pay_amount, 200),
  driver_assignment_assistant_pay_amount = COALESCE(driver_assignment_assistant_pay_amount, 100)
WHERE code = 'OS001'
  AND driver_id IS NOT NULL
  AND driver_assignment_response = 'accepted';

-- Conferir:
SELECT code, driver_assignment_pay_amount, driver_assignment_assistant_pay_amount, driver_id, status
FROM public.service_orders
WHERE code = 'OS001';

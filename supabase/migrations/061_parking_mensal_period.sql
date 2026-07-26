-- Mensalidade de estacionamento por período (aniversário) + próxima cobrança.
ALTER TABLE public.parking_entries
  ADD COLUMN IF NOT EXISTS period_end_date DATE,
  ADD COLUMN IF NOT EXISTS next_charge_date DATE;

COMMENT ON COLUMN public.parking_entries.period_end_date IS
  'Fim da vigência mensal (inclusivo). Ex.: entrada 05/07 → fim 04/08.';
COMMENT ON COLUMN public.parking_entries.next_charge_date IS
  'Próxima cobrança / aniversário (início do próximo período). Ex.: 05/08.';

CREATE INDEX IF NOT EXISTS idx_parking_entries_next_charge
  ON public.parking_entries(company_id, next_charge_date)
  WHERE billing_mode = 'Mensal' AND status = 'Aberto';

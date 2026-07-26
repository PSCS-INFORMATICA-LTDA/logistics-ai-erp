-- Lava-rápido: status Pronto (avisar cliente) + fidelidade por placa (parâmetro a cada N lavagens).

ALTER TABLE public.car_wash_services
  DROP CONSTRAINT IF EXISTS car_wash_services_status_check;

ALTER TABLE public.car_wash_services
  ADD CONSTRAINT car_wash_services_status_check
  CHECK (status IN ('Aberto', 'Pronto', 'Concluido', 'Cancelado'));

ALTER TABLE public.car_wash_services
  ADD COLUMN IF NOT EXISTS ready_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_loyalty_reward BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.car_wash_services.ready_notified_at IS
  'Quando a operação avisou o cliente que o veículo está pronto para retirada.';
COMMENT ON COLUMN public.car_wash_services.is_loyalty_reward IS
  'Lavagem gratuita do cartão fidelidade (não conta para a próxima recompensa).';

CREATE TABLE IF NOT EXISTS public.company_patio_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  wash_loyalty_enabled BOOLEAN NOT NULL DEFAULT true,
  wash_loyalty_every_n INTEGER NOT NULL DEFAULT 5
    CHECK (wash_loyalty_every_n IN (5, 10)),
  wash_loyalty_reward_qty INTEGER NOT NULL DEFAULT 1
    CHECK (wash_loyalty_reward_qty >= 1 AND wash_loyalty_reward_qty <= 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.company_patio_settings IS
  'Parâmetros do pátio por empresa (ex.: fidelidade lava a cada 5 ou 10 lavagens).';

ALTER TABLE public.company_patio_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_patio_settings_all ON public.company_patio_settings;
CREATE POLICY company_patio_settings_all ON public.company_patio_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_patio_settings.company_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_patio_settings.company_id
        AND m.user_id = auth.uid()
    )
  );

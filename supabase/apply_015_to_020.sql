-- GRX Management — aplicar migrations 015 a 020 de uma vez
-- Cole no Supabase → SQL Editor → Run
-- Seguro para reexecutar (usa IF NOT EXISTS / DROP IF EXISTS onde aplicável)

-- 015_service_orders_freight_tolls.sql
ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS freight_toll_count INTEGER
        CHECK (freight_toll_count IS NULL OR freight_toll_count >= 0),
    ADD COLUMN IF NOT EXISTS freight_toll_detail JSONB;

COMMENT ON COLUMN public.service_orders.freight_toll_count IS
    'Quantidade de praças de pedágio na rota (QualP ou informado manualmente).';

COMMENT ON COLUMN public.service_orders.freight_toll_detail IS
    'Lista de praças com nome, local e valor — base para negociação com o cliente.';

-- 016_vehicles_axle_count.sql
ALTER TABLE public.vehicles
    ADD COLUMN IF NOT EXISTS axle_count INTEGER
        CHECK (axle_count IS NULL OR axle_count IN (2, 3, 4, 5, 6, 7, 9));

COMMENT ON COLUMN public.vehicles.axle_count IS
    'Quantidade de eixos (caminhão) — preenchida automaticamente em freight_antt_axles na OS de frete.';

-- 017_service_orders_status_approval.sql
ALTER TABLE public.service_orders
    DROP CONSTRAINT IF EXISTS service_orders_status_check;

ALTER TABLE public.service_orders
    ADD CONSTRAINT service_orders_status_check
    CHECK (status IN ('Aberto', 'Aguardando aprovação cliente', 'Concluido', 'Cancelado'));

COMMENT ON COLUMN public.service_orders.status IS
    'Aberto | Aguardando aprovação cliente | Concluido | Cancelado';

-- 018_service_orders_per_diem.sql
ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS freight_travel_days INTEGER
        CHECK (freight_travel_days IS NULL OR freight_travel_days >= 1),
    ADD COLUMN IF NOT EXISTS freight_per_diem_detail JSONB,
    ADD COLUMN IF NOT EXISTS freight_per_diem_total NUMERIC(12,2)
        CHECK (freight_per_diem_total IS NULL OR freight_per_diem_total >= 0);

COMMENT ON COLUMN public.service_orders.freight_travel_days IS
    'Dias de viagem/pernoite em rotas longas (ex.: > 1.000 km).';

COMMENT ON COLUMN public.service_orders.freight_per_diem_detail IS
    'Detalhamento por dia: hospedagem, café da manhã, almoço, jantar e diária.';

COMMENT ON COLUMN public.service_orders.freight_per_diem_total IS
    'Soma das despesas de viagem (hospedagem + alimentação + diárias).';

-- 019_service_orders_per_diem_charge.sql
ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS freight_per_diem_charge_to TEXT NOT NULL DEFAULT 'Cliente'
        CHECK (freight_per_diem_charge_to IN ('Cliente', 'GRX'));

COMMENT ON COLUMN public.service_orders.freight_per_diem_charge_to IS
    'Cliente = repassar na proposta; GRX = custo interno da empresa.';

-- 020_service_orders_transport_km_rate.sql
ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS freight_transport_km_rate NUMERIC(8,4)
        CHECK (freight_transport_km_rate IS NULL OR freight_transport_km_rate > 0);

COMMENT ON COLUMN public.service_orders.freight_transport_km_rate IS
    'Tarifa orientativa R$/km para transporte de passageiros (van).';

-- Anexos de comprovante: lava-rápido (parking_entry já existia no CHECK)
-- Migration: 042_patio_payment_proof_attachments.sql

ALTER TABLE public.attachments
    DROP CONSTRAINT IF EXISTS attachments_entity_type_check;

ALTER TABLE public.attachments
    ADD CONSTRAINT attachments_entity_type_check
    CHECK (entity_type IN (
        'branch', 'partner', 'vehicle', 'driver', 'client', 'supplier',
        'financial_transaction', 'cash_flow_entry', 'parking_entry',
        'service_order', 'vehicle_event', 'traffic_infraction',
        'car_wash_service'
    ));

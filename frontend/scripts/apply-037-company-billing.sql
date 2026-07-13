-- Aplicar no SQL Editor do Supabase (produção / desenvolvimento)
-- Equivalente: supabase/migrations/037_company_billing.sql

CREATE TABLE IF NOT EXISTS public.company_billing_settings (
    company_id              UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    charge_mode             TEXT NOT NULL DEFAULT 'test'
                            CHECK (charge_mode IN ('test', 'production')),
    test_amount             NUMERIC(12, 2) NOT NULL DEFAULT 1.00
                            CHECK (test_amount >= 0.01),
    monthly_amount          NUMERIC(12, 2) NOT NULL DEFAULT 800.00
                            CHECK (monthly_amount >= 0.01),
    billing_day             INTEGER NOT NULL DEFAULT 10
                            CHECK (billing_day BETWEEN 1 AND 28),
    payer_name              TEXT,
    payer_email             TEXT,
    payer_cpf_cnpj          TEXT,
    payer_phone             TEXT,
    payer_postal_code       TEXT,
    payer_address_number    TEXT,
    asaas_customer_id       TEXT,
    asaas_subscription_id   TEXT,
    subscription_status     TEXT NOT NULL DEFAULT 'inactive'
                            CHECK (subscription_status IN (
                              'inactive', 'pending', 'active', 'overdue', 'canceled', 'error'
                            )),
    card_last4              TEXT,
    card_brand              TEXT,
    card_holder_name        TEXT,
    next_due_date           DATE,
    last_error              TEXT,
    updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_company_billing_settings_updated_at ON public.company_billing_settings;
CREATE TRIGGER trg_company_billing_settings_updated_at
    BEFORE UPDATE ON public.company_billing_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_billing_settings_all ON public.company_billing_settings;
CREATE POLICY company_billing_settings_all ON public.company_billing_settings
  FOR ALL USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

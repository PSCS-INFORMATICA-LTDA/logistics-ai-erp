-- Aplicar no SQL Editor do Supabase (produção)
-- Equivalente: supabase/migrations/035_access_parameters.sql

ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_company_members_partner
  ON public.company_members(partner_id)
  WHERE partner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_security_settings (
    company_id            UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    master_password_salt  TEXT NOT NULL,
    master_password_hash  TEXT NOT NULL,
    updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_company_security_settings_updated_at ON public.company_security_settings;
CREATE TRIGGER trg_company_security_settings_updated_at
    BEFORE UPDATE ON public.company_security_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.partner_screen_permissions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    partner_id   UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    screen_key   TEXT NOT NULL,
    can_view     BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, partner_id, screen_key)
);

CREATE INDEX IF NOT EXISTS idx_partner_screen_permissions_partner
  ON public.partner_screen_permissions(company_id, partner_id);

DROP TRIGGER IF EXISTS trg_partner_screen_permissions_updated_at ON public.partner_screen_permissions;
CREATE TRIGGER trg_partner_screen_permissions_updated_at
    BEFORE UPDATE ON public.partner_screen_permissions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_screen_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_security_settings_all ON public.company_security_settings;
CREATE POLICY company_security_settings_all ON public.company_security_settings
  FOR ALL USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS partner_screen_permissions_all ON public.partner_screen_permissions;
CREATE POLICY partner_screen_permissions_all ON public.partner_screen_permissions
  FOR ALL USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

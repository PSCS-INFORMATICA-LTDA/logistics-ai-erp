-- Contas financeiras (caixa, banco, carteira) — destino obrigatório do pagamento AP

CREATE TABLE IF NOT EXISTS public.company_financial_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  account_type          TEXT NOT NULL
                        CHECK (account_type IN (
                          'checking', 'savings', 'cash', 'digital_wallet',
                          'payment_account', 'other'
                        )),
  bank_code             TEXT,
  bank_name             TEXT,
  agency                TEXT,
  account_number        TEXT,
  pix_key               TEXT,
  opening_balance       NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_balance_date  DATE,
  currency              TEXT NOT NULL DEFAULT 'BRL',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT chk_cfa_opening_balance_nonneg CHECK (opening_balance >= 0)
);

COMMENT ON TABLE public.company_financial_accounts IS
  'Contas financeiras da empresa (banco, caixa, carteira). Sem current_balance materializado no MVP.';
COMMENT ON COLUMN public.company_financial_accounts.opening_balance IS
  'Saldo de abertura; saldo atual futuro = abertura + movimentos.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cfa_company_name_active
  ON public.company_financial_accounts (company_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cfa_company_active
  ON public.company_financial_accounts (company_id, is_active)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_company_financial_accounts_updated_at ON public.company_financial_accounts;
CREATE TRIGGER trg_company_financial_accounts_updated_at
  BEFORE UPDATE ON public.company_financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_financial_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_financial_accounts_select ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_select ON public.company_financial_accounts
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS company_financial_accounts_insert ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_insert ON public.company_financial_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS company_financial_accounts_update ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_update ON public.company_financial_accounts
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS company_financial_accounts_delete ON public.company_financial_accounts;
CREATE POLICY company_financial_accounts_delete ON public.company_financial_accounts
  FOR DELETE TO authenticated
  USING (public.auth_user_has_company(company_id));

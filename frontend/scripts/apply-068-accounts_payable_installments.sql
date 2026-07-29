-- Parcelas AP — due_date oficial

CREATE TABLE IF NOT EXISTS public.accounts_payable_installments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  accounts_payable_id     UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  installment_no          INTEGER NOT NULL CHECK (installment_no >= 1),
  due_date                DATE NOT NULL,
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_amount             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  open_balance            NUMERIC(14,2) NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'partially_paid', 'paid', 'cancelled')),
  cancelled_at            TIMESTAMPTZ,
  cancellation_reason     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ap_installment_no UNIQUE (accounts_payable_id, installment_no),
  CONSTRAINT chk_ap_inst_open_balance CHECK (open_balance = amount - paid_amount)
);

COMMENT ON TABLE public.accounts_payable_installments IS
  'Parcelas do Contas a Pagar. due_date é a fonte oficial de vencimento.';

CREATE INDEX IF NOT EXISTS idx_ap_inst_due
  ON public.accounts_payable_installments (company_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_ap_inst_payable
  ON public.accounts_payable_installments (accounts_payable_id);

DROP TRIGGER IF EXISTS trg_accounts_payable_installments_updated_at
  ON public.accounts_payable_installments;
CREATE TRIGGER trg_accounts_payable_installments_updated_at
  BEFORE UPDATE ON public.accounts_payable_installments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts_payable_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_installments_select ON public.accounts_payable_installments;
CREATE POLICY accounts_payable_installments_select ON public.accounts_payable_installments
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_installments_insert ON public.accounts_payable_installments;
CREATE POLICY accounts_payable_installments_insert ON public.accounts_payable_installments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_installments_update ON public.accounts_payable_installments;
CREATE POLICY accounts_payable_installments_update ON public.accounts_payable_installments
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_installments_delete ON public.accounts_payable_installments;
CREATE POLICY accounts_payable_installments_delete ON public.accounts_payable_installments
  FOR DELETE TO authenticated
  USING (public.auth_user_has_company(company_id));

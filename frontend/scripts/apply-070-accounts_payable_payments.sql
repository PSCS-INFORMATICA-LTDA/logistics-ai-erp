-- Pagamentos AP — valores explícitos; nunca hard-delete (só estorno)

CREATE TABLE IF NOT EXISTS public.accounts_payable_payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  accounts_payable_id     UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  installment_id          UUID NOT NULL REFERENCES public.accounts_payable_installments(id) ON DELETE RESTRICT,
  paid_at                 DATE NOT NULL,
  principal_amount        NUMERIC(14,2) NOT NULL CHECK (principal_amount >= 0),
  interest_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  penalty_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  discount_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_paid_amount       NUMERIC(14,2) NOT NULL CHECK (total_paid_amount > 0),
  financial_account_id    UUID NOT NULL REFERENCES public.company_financial_accounts(id) ON DELETE RESTRICT,
  payment_method          TEXT NOT NULL,
  bank_ref                TEXT,
  notes                   TEXT,
  reconciled_at           TIMESTAMPTZ,
  reversed_at             TIMESTAMPTZ,
  reversal_reason         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT chk_ap_pay_total_formula CHECK (
    total_paid_amount = principal_amount + interest_amount + penalty_amount - discount_amount
  ),
  CONSTRAINT chk_ap_pay_reversal CHECK (
    (reversed_at IS NULL AND reversal_reason IS NULL)
    OR (
      reversed_at IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND btrim(reversal_reason) <> ''
    )
  ),
  CONSTRAINT chk_ap_pay_principal_positive_when_active CHECK (
    reversed_at IS NOT NULL OR principal_amount > 0
  )
);

COMMENT ON TABLE public.accounts_payable_payments IS
  'Baixas AP. Somente principal_amount reduz saldo da parcela; total_paid_amount = saída da conta financeira.
   Juros/multa/desconto armazenados para relatório; postagem DRE específica fica para fase futura.';
COMMENT ON COLUMN public.accounts_payable_payments.principal_amount IS
  'Abate open_balance da parcela.';
COMMENT ON COLUMN public.accounts_payable_payments.total_paid_amount IS
  'Saída efetiva da conta financeira.';

CREATE INDEX IF NOT EXISTS idx_ap_pay_paid_at
  ON public.accounts_payable_payments (company_id, paid_at)
  WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_pay_payable
  ON public.accounts_payable_payments (accounts_payable_id);
CREATE INDEX IF NOT EXISTS idx_ap_pay_installment
  ON public.accounts_payable_payments (installment_id);
CREATE INDEX IF NOT EXISTS idx_ap_pay_fin_account
  ON public.accounts_payable_payments (financial_account_id)
  WHERE reversed_at IS NULL;

DROP TRIGGER IF EXISTS trg_accounts_payable_payments_updated_at
  ON public.accounts_payable_payments;
CREATE TRIGGER trg_accounts_payable_payments_updated_at
  BEFORE UPDATE ON public.accounts_payable_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts_payable_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_payments_select ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_select ON public.accounts_payable_payments
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_payments_insert ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_insert ON public.accounts_payable_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_payments_update ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_update ON public.accounts_payable_payments
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

-- Sem DELETE policy de uso normal — pagamento não deve ser apagado (RPC pode usar security definer se necessário).
DROP POLICY IF EXISTS accounts_payable_payments_delete ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_delete ON public.accounts_payable_payments
  FOR DELETE TO authenticated
  USING (false);

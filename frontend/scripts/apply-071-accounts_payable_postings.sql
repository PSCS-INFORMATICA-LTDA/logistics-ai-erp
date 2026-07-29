-- Postagens DRE do Contas a Pagar (1 allocation → 1 FT ativo)

CREATE TABLE IF NOT EXISTS public.accounts_payable_postings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  accounts_payable_id         UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  allocation_id               UUID NOT NULL REFERENCES public.accounts_payable_allocations(id) ON DELETE RESTRICT,
  financial_transaction_id    UUID NOT NULL REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  posting_type                TEXT NOT NULL
                              CHECK (posting_type IN ('competence', 'reversal')),
  posted_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at                 TIMESTAMPTZ,
  reversal_reason             TEXT,
  reversal_posting_id         UUID REFERENCES public.accounts_payable_postings(id) ON DELETE RESTRICT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ap_posting_ft UNIQUE (financial_transaction_id),
  CONSTRAINT chk_ap_posting_reversal CHECK (
    (reversed_at IS NULL AND reversal_reason IS NULL)
    OR (
      reversed_at IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND btrim(reversal_reason) <> ''
    )
  )
);

COMMENT ON TABLE public.accounts_payable_postings IS
  'Vínculo AP rateio ↔ financial_transactions. Estorno MVP: cancela FT (approval_status=cancelled);
   schema FT exige amount > 0 — não usar despesa negativa nem classificar estorno como receita.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_posting_active_allocation
  ON public.accounts_payable_postings (allocation_id)
  WHERE posting_type = 'competence' AND reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ap_posting_payable
  ON public.accounts_payable_postings (accounts_payable_id);
CREATE INDEX IF NOT EXISTS idx_ap_posting_company
  ON public.accounts_payable_postings (company_id, posted_at DESC);

DROP TRIGGER IF EXISTS trg_accounts_payable_postings_updated_at
  ON public.accounts_payable_postings;
CREATE TRIGGER trg_accounts_payable_postings_updated_at
  BEFORE UPDATE ON public.accounts_payable_postings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts_payable_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_postings_select ON public.accounts_payable_postings;
CREATE POLICY accounts_payable_postings_select ON public.accounts_payable_postings
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_postings_insert ON public.accounts_payable_postings;
CREATE POLICY accounts_payable_postings_insert ON public.accounts_payable_postings
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_postings_update ON public.accounts_payable_postings;
CREATE POLICY accounts_payable_postings_update ON public.accounts_payable_postings
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_postings_delete ON public.accounts_payable_postings;
CREATE POLICY accounts_payable_postings_delete ON public.accounts_payable_postings
  FOR DELETE TO authenticated
  USING (false);

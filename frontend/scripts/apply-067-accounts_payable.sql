-- Contas a Pagar — cabeçalho (obrigação)
-- Sem employee_id / cost_center_id / due_date no cabeçalho.
-- cash_flow_entries permanece legado (sem write-guard nesta fase).

CREATE TABLE IF NOT EXISTS public.accounts_payable (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  internal_number         TEXT NOT NULL,
  doc_type                TEXT,
  doc_number              TEXT,
  doc_series              TEXT,
  description             TEXT NOT NULL,
  notes                   TEXT,
  external_ref            TEXT,
  issue_date              DATE,
  competence_date         DATE NOT NULL,
  entry_date              DATE NOT NULL DEFAULT (CURRENT_DATE),
  -- Favorecido: exatamente um
  supplier_id             UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  driver_id               UUID REFERENCES public.drivers(id) ON DELETE RESTRICT,
  partner_id              UUID REFERENCES public.partners(id) ON DELETE RESTRICT,
  client_id               UUID REFERENCES public.clients(id) ON DELETE RESTRICT,
  company_payee_id        UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  payee_name              TEXT,
  chart_of_account_id     UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  payment_method_planned  TEXT,
  original_amount         NUMERIC(14,2) NOT NULL CHECK (original_amount > 0),
  discount_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  addition_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (addition_amount >= 0),
  interest_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  penalty_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  net_amount              NUMERIC(14,2) NOT NULL CHECK (net_amount > 0),
  paid_amount             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  open_balance            NUMERIC(14,2) NOT NULL,
  installment_count       INTEGER NOT NULL DEFAULT 1 CHECK (installment_count >= 1),
  -- Situação financeira (não misturar com aprovação)
  status                  TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN (
                            'open', 'partially_paid', 'paid', 'suspended', 'cancelled'
                          )),
  -- Aprovação
  approval_status         TEXT NOT NULL DEFAULT 'draft'
                          CHECK (approval_status IN (
                            'draft', 'submitted', 'approved', 'rejected'
                          )),
  submitted_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at            TIMESTAMPTZ,
  reviewed_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_name        TEXT,
  reviewed_at             TIMESTAMPTZ,
  review_note             TEXT,
  cancelled_at            TIMESTAMPTZ,
  cancellation_reason     TEXT,
  source                  TEXT NOT NULL DEFAULT 'manual',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT uq_ap_company_internal_number UNIQUE (company_id, internal_number),
  CONSTRAINT chk_ap_net_formula CHECK (
    net_amount = original_amount - discount_amount + addition_amount
                 + interest_amount + penalty_amount
  ),
  CONSTRAINT chk_ap_open_balance CHECK (open_balance = net_amount - paid_amount),
  CONSTRAINT chk_ap_exactly_one_payee CHECK (
    (
      (supplier_id IS NOT NULL)::int
      + (driver_id IS NOT NULL)::int
      + (partner_id IS NOT NULL)::int
      + (client_id IS NOT NULL)::int
      + (company_payee_id IS NOT NULL)::int
      + (CASE WHEN payee_name IS NOT NULL AND btrim(payee_name) <> '' THEN 1 ELSE 0 END)
    ) = 1
  ),
  CONSTRAINT chk_ap_cancellation CHECK (
    (cancelled_at IS NULL AND cancellation_reason IS NULL AND status <> 'cancelled')
    OR (
      cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND btrim(cancellation_reason) <> ''
      AND status = 'cancelled'
    )
  )
);

COMMENT ON TABLE public.accounts_payable IS
  'Contas a Pagar — obrigação. Vencimento oficial nas parcelas. DRE pela competence_date na aprovação.';
COMMENT ON COLUMN public.accounts_payable.approval_status IS
  'draft|submitted|approved|rejected — separado de status financeiro.';
COMMENT ON COLUMN public.accounts_payable.status IS
  'open|partially_paid|paid|suspended|cancelled — overdue é calculado.';

CREATE INDEX IF NOT EXISTS idx_ap_company_status
  ON public.accounts_payable (company_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_company_approval
  ON public.accounts_payable (company_id, approval_status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_company_competence
  ON public.accounts_payable (company_id, competence_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_supplier
  ON public.accounts_payable (company_id, supplier_id)
  WHERE deleted_at IS NULL AND supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_driver
  ON public.accounts_payable (company_id, driver_id)
  WHERE deleted_at IS NULL AND driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_chart
  ON public.accounts_payable (company_id, chart_of_account_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_accounts_payable_updated_at ON public.accounts_payable;
CREATE TRIGGER trg_accounts_payable_updated_at
  BEFORE UPDATE ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_select ON public.accounts_payable;
CREATE POLICY accounts_payable_select ON public.accounts_payable
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS accounts_payable_insert ON public.accounts_payable;
CREATE POLICY accounts_payable_insert ON public.accounts_payable
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_update ON public.accounts_payable;
CREATE POLICY accounts_payable_update ON public.accounts_payable
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_delete ON public.accounts_payable;
CREATE POLICY accounts_payable_delete ON public.accounts_payable
  FOR DELETE TO authenticated
  USING (public.auth_user_has_company(company_id));

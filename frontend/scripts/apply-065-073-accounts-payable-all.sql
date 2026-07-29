-- Contas a Pagar Fase 1 — apply all (065-073). NÃO aplicar em produção sem validação.


-- ========== 065_company_document_sequences.sql ==========

-- Contas a Pagar Fase 1 â€” sequÃªncias de documentos por empresa
-- NÃ£o usar sequence PostgreSQL global como fonte principal.

CREATE TABLE IF NOT EXISTS public.company_document_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  last_number   INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  padding       INTEGER NOT NULL DEFAULT 8 CHECK (padding BETWEEN 1 AND 12),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, document_type)
);

COMMENT ON TABLE public.company_document_sequences IS
  'NumeraÃ§Ã£o transacional por empresa + tipo de documento (ex.: accounts_payable â†’ AP-00000001).';

CREATE INDEX IF NOT EXISTS idx_company_document_sequences_company
  ON public.company_document_sequences (company_id);

DROP TRIGGER IF EXISTS trg_company_document_sequences_updated_at ON public.company_document_sequences;
CREATE TRIGGER trg_company_document_sequences_updated_at
  BEFORE UPDATE ON public.company_document_sequences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_document_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_document_sequences_select ON public.company_document_sequences;
CREATE POLICY company_document_sequences_select ON public.company_document_sequences
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id));

-- Writes apenas via RPC SECURITY DEFINER (sem policy INSERT/UPDATE para authenticated).

CREATE OR REPLACE FUNCTION public.next_company_document_number(
  p_company_id UUID,
  p_document_type TEXT,
  p_prefix TEXT DEFAULT NULL,
  p_padding INTEGER DEFAULT 8
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_padding INTEGER;
  v_next INTEGER;
BEGIN
  IF p_company_id IS NULL OR p_document_type IS NULL OR btrim(p_document_type) = '' THEN
    RAISE EXCEPTION 'company_id e document_type sÃ£o obrigatÃ³rios';
  END IF;

  IF NOT public.auth_user_has_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso Ã  empresa';
  END IF;

  v_prefix := COALESCE(NULLIF(btrim(p_prefix), ''), upper(btrim(p_document_type)));
  v_padding := COALESCE(p_padding, 8);
  IF v_padding < 1 OR v_padding > 12 THEN
    RAISE EXCEPTION 'padding invÃ¡lido';
  END IF;

  INSERT INTO public.company_document_sequences (
    company_id, document_type, prefix, last_number, padding
  )
  VALUES (p_company_id, btrim(p_document_type), v_prefix, 0, v_padding)
  ON CONFLICT (company_id, document_type) DO NOTHING;

  UPDATE public.company_document_sequences
  SET last_number = last_number + 1,
      updated_at = NOW()
  WHERE company_id = p_company_id
    AND document_type = btrim(p_document_type)
  RETURNING last_number, prefix, padding INTO v_next, v_prefix, v_padding;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Falha ao gerar nÃºmero de documento';
  END IF;

  RETURN v_prefix || '-' || lpad(v_next::text, v_padding, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_company_document_number(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_company_document_number(UUID, TEXT, TEXT, INTEGER) TO authenticated;

-- Seed tipo Contas a Pagar (prefixo AP) para empresas existentes
INSERT INTO public.company_document_sequences (company_id, document_type, prefix, last_number, padding)
SELECT c.id, 'accounts_payable', 'AP', 0, 8
FROM public.companies c
ON CONFLICT (company_id, document_type) DO NOTHING;



-- ========== 066_company_financial_accounts.sql ==========

-- Contas financeiras (caixa, banco, carteira) â€” destino obrigatÃ³rio do pagamento AP

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



-- ========== 067_accounts_payable.sql ==========

-- Contas a Pagar â€” cabeÃ§alho (obrigaÃ§Ã£o)
-- Sem employee_id / cost_center_id / due_date no cabeÃ§alho.
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
  -- SituaÃ§Ã£o financeira (nÃ£o misturar com aprovaÃ§Ã£o)
  status                  TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN (
                            'open', 'partially_paid', 'paid', 'suspended', 'cancelled'
                          )),
  -- AprovaÃ§Ã£o
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
  'Contas a Pagar â€” obrigaÃ§Ã£o. Vencimento oficial nas parcelas. DRE pela competence_date na aprovaÃ§Ã£o.';
COMMENT ON COLUMN public.accounts_payable.approval_status IS
  'draft|submitted|approved|rejected â€” separado de status financeiro.';
COMMENT ON COLUMN public.accounts_payable.status IS
  'open|partially_paid|paid|suspended|cancelled â€” overdue Ã© calculado.';

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



-- ========== 068_accounts_payable_installments.sql ==========

-- Parcelas AP â€” due_date oficial

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
  'Parcelas do Contas a Pagar. due_date Ã© a fonte oficial de vencimento.';

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



-- ========== 069_accounts_payable_allocations.sql ==========

-- Rateios AP â€” sem cost_center_id no MVP

CREATE TABLE IF NOT EXISTS public.accounts_payable_allocations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  accounts_payable_id     UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  line_no                 INTEGER NOT NULL CHECK (line_no >= 1),
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  percent                 NUMERIC(9,6),
  branch_id               UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  vehicle_id              UUID REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id               UUID REFERENCES public.drivers(id) ON DELETE RESTRICT,
  service_order_id        UUID REFERENCES public.service_orders(id) ON DELETE RESTRICT,
  chart_of_account_id     UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ap_alloc_line UNIQUE (accounts_payable_id, line_no)
);

COMMENT ON TABLE public.accounts_payable_allocations IS
  'Rateio do tÃ­tulo AP. cost_center_id fica para fase futura com tabela prÃ³pria.';

CREATE INDEX IF NOT EXISTS idx_ap_alloc_payable
  ON public.accounts_payable_allocations (accounts_payable_id);
CREATE INDEX IF NOT EXISTS idx_ap_alloc_vehicle
  ON public.accounts_payable_allocations (company_id, vehicle_id)
  WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_alloc_os
  ON public.accounts_payable_allocations (company_id, service_order_id)
  WHERE service_order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_accounts_payable_allocations_updated_at
  ON public.accounts_payable_allocations;
CREATE TRIGGER trg_accounts_payable_allocations_updated_at
  BEFORE UPDATE ON public.accounts_payable_allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts_payable_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_allocations_select ON public.accounts_payable_allocations;
CREATE POLICY accounts_payable_allocations_select ON public.accounts_payable_allocations
  FOR SELECT TO authenticated
  USING (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_allocations_insert ON public.accounts_payable_allocations;
CREATE POLICY accounts_payable_allocations_insert ON public.accounts_payable_allocations
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_allocations_update ON public.accounts_payable_allocations;
CREATE POLICY accounts_payable_allocations_update ON public.accounts_payable_allocations
  FOR UPDATE TO authenticated
  USING (public.auth_user_has_company(company_id))
  WITH CHECK (public.auth_user_has_company(company_id));

DROP POLICY IF EXISTS accounts_payable_allocations_delete ON public.accounts_payable_allocations;
CREATE POLICY accounts_payable_allocations_delete ON public.accounts_payable_allocations
  FOR DELETE TO authenticated
  USING (public.auth_user_has_company(company_id));



-- ========== 070_accounts_payable_payments.sql ==========

-- Pagamentos AP â€” valores explÃ­citos; nunca hard-delete (sÃ³ estorno)

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
  'Baixas AP. Somente principal_amount reduz saldo da parcela; total_paid_amount = saÃ­da da conta financeira.
   Juros/multa/desconto armazenados para relatÃ³rio; postagem DRE especÃ­fica fica para fase futura.';
COMMENT ON COLUMN public.accounts_payable_payments.principal_amount IS
  'Abate open_balance da parcela.';
COMMENT ON COLUMN public.accounts_payable_payments.total_paid_amount IS
  'SaÃ­da efetiva da conta financeira.';

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

-- Sem DELETE policy de uso normal â€” pagamento nÃ£o deve ser apagado (RPC pode usar security definer se necessÃ¡rio).
DROP POLICY IF EXISTS accounts_payable_payments_delete ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_delete ON public.accounts_payable_payments
  FOR DELETE TO authenticated
  USING (false);



-- ========== 071_accounts_payable_postings.sql ==========

-- Postagens DRE do Contas a Pagar (1 allocation â†’ 1 FT ativo)

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
  'VÃ­nculo AP rateio â†” financial_transactions. Estorno MVP: cancela FT (approval_status=cancelled);
   schema FT exige amount > 0 â€” nÃ£o usar despesa negativa nem classificar estorno como receita.';

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



-- ========== 072_ap_approval_settings_and_attachments.sql ==========

-- ConfiguraÃ§Ã£o de aprovaÃ§Ã£o AP + entity_types de anexos
-- cash_flow_entries: estrutura LEGADA â€” nÃ£o excluir, nÃ£o bloquear writes nesta fase;
--   nÃ£o desenvolver novas features; analisar dependÃªncias antes de qualquer bloqueio futuro.

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_approval_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_auto_approve_below_amount NUMERIC(14,2)
  CHECK (ap_auto_approve_below_amount IS NULL OR ap_auto_approve_below_amount >= 0);

ALTER TABLE public.company_financial_approval_settings
  ADD COLUMN IF NOT EXISTS ap_approver_mode TEXT NOT NULL DEFAULT 'admin'
  CHECK (ap_approver_mode IN ('admin', 'admin_or_master', 'master_only'));

COMMENT ON COLUMN public.company_financial_approval_settings.ap_approval_enabled IS
  'Se false, tÃ­tulo AP definitivo nasce approved (MVP).';
COMMENT ON COLUMN public.company_financial_approval_settings.ap_auto_approve_below_amount IS
  'Auto-aprova AP abaixo deste valor quando aprovaÃ§Ã£o estÃ¡ ligada.';
COMMENT ON COLUMN public.company_financial_approval_settings.ap_approver_mode IS
  'Quem aprova AP no MVP: admin | admin_or_master | master_only.';

COMMENT ON TABLE public.cash_flow_entries IS
  'LEGADO (planilha Fluxo de caixa). Contas a Pagar Fase 1 NÃƒO usa esta tabela como motor.
   Previsto/realizado MVP = parcelas abertas / payments. NÃ£o excluir; nÃ£o bloquear writes nesta fase.
   Avaliar dependÃªncias antes de write-guard futuro.';

-- Ampliar CHECK de attachments (recria constraint)
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type IN (
    'branch', 'partner', 'vehicle', 'driver', 'client', 'supplier',
    'financial_transaction', 'cash_flow_entry', 'parking_entry',
    'service_order', 'vehicle_event', 'traffic_infraction',
    'car_wash_service', 'compliance_document',
    'accounts_payable', 'accounts_payable_payment', 'company_financial_account'
  ));



-- ========== 073_accounts_payable_rpcs.sql ==========

-- RPCs e triggers Contas a Pagar Fase 1
-- AprovaÃ§Ã£o SOMENTE via RPC transacional (nÃ£o UPDATE solto do frontend para approved+post).

-- ---------------------------------------------------------------------------
-- Helpers multiempresa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_assert_company_member(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR NOT public.auth_user_has_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso Ã  empresa';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._ap_user_display_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public._ap_can_approve(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT COALESCE(ap_approver_mode, 'admin')
  INTO v_mode
  FROM public.company_financial_approval_settings
  WHERE company_id = p_company_id;

  v_mode := COALESCE(v_mode, 'admin');

  -- MVP: admin da empresa (admin_or_master / master_only tratados como admin no banco;
  -- MÃ¡ster adicional fica na UI quando necessÃ¡rio).
  IF v_mode IN ('admin', 'admin_or_master', 'master_only') THEN
    RETURN public.auth_user_is_company_admin(p_company_id);
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_accounts_payable_balances(p_payable_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid NUMERIC(14,2);
  v_net NUMERIC(14,2);
  v_status TEXT;
  v_approval TEXT;
  r RECORD;
  v_inst_paid NUMERIC(14,2);
BEGIN
  SELECT net_amount, approval_status, status
  INTO v_net, v_approval, v_status
  FROM public.accounts_payable
  WHERE id = p_payable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TÃ­tulo AP nÃ£o encontrado';
  END IF;

  IF v_status = 'cancelled' OR v_status = 'suspended' THEN
    -- ainda recalcula paid/open para consistÃªncia
    NULL;
  END IF;

  FOR r IN
    SELECT id, amount
    FROM public.accounts_payable_installments
    WHERE accounts_payable_id = p_payable_id
      AND status <> 'cancelled'
  LOOP
    SELECT COALESCE(SUM(principal_amount), 0)
    INTO v_inst_paid
    FROM public.accounts_payable_payments
    WHERE installment_id = r.id
      AND reversed_at IS NULL;

    UPDATE public.accounts_payable_installments
    SET paid_amount = v_inst_paid,
        open_balance = r.amount - v_inst_paid,
        status = CASE
          WHEN v_inst_paid <= 0 THEN 'open'
          WHEN v_inst_paid >= r.amount THEN 'paid'
          ELSE 'partially_paid'
        END,
        updated_at = NOW()
    WHERE id = r.id;
  END LOOP;

  SELECT COALESCE(SUM(principal_amount), 0)
  INTO v_paid
  FROM public.accounts_payable_payments
  WHERE accounts_payable_id = p_payable_id
    AND reversed_at IS NULL;

  IF v_status NOT IN ('cancelled', 'suspended') AND v_approval = 'approved' THEN
    v_status := CASE
      WHEN v_paid <= 0 THEN 'open'
      WHEN v_paid >= v_net THEN 'paid'
      ELSE 'partially_paid'
    END;
  END IF;

  UPDATE public.accounts_payable
  SET paid_amount = v_paid,
      open_balance = v_net - v_paid,
      status = v_status,
      updated_at = NOW()
  WHERE id = p_payable_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- ValidaÃ§Ã£o prÃ©-aprovaÃ§Ã£o
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_validate_ready_for_approval(p_payable_id UUID)
RETURNS public.accounts_payable
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_sum_inst NUMERIC(14,2);
  v_sum_alloc NUMERIC(14,2);
  v_cnt_inst INTEGER;
  v_cnt_alloc INTEGER;
  v_chart_company UUID;
  v_coa UUID;
  r RECORD;
BEGIN
  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TÃ­tulo AP nÃ£o encontrado';
  END IF;

  PERFORM public._ap_assert_company_member(v_ap.company_id);

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_cnt_inst, v_sum_inst
  FROM public.accounts_payable_installments
  WHERE accounts_payable_id = p_payable_id
    AND status <> 'cancelled';

  IF v_cnt_inst < 1 THEN
    RAISE EXCEPTION 'TÃ­tulo sem parcelas';
  END IF;
  IF v_sum_inst <> v_ap.net_amount THEN
    RAISE EXCEPTION 'Soma das parcelas (%) diferente de net_amount (%)', v_sum_inst, v_ap.net_amount;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts_payable_installments
    WHERE accounts_payable_id = p_payable_id
      AND status <> 'cancelled'
      AND (amount IS NULL OR amount <= 0 OR due_date IS NULL)
  ) THEN
    RAISE EXCEPTION 'Parcela com valor ou vencimento invÃ¡lido';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_cnt_alloc, v_sum_alloc
  FROM public.accounts_payable_allocations
  WHERE accounts_payable_id = p_payable_id;

  IF v_cnt_alloc < 1 THEN
    RAISE EXCEPTION 'TÃ­tulo sem rateio';
  END IF;
  IF v_sum_alloc <> v_ap.net_amount THEN
    RAISE EXCEPTION 'Soma dos rateios (%) diferente de net_amount (%)', v_sum_alloc, v_ap.net_amount;
  END IF;

  -- Conta DRE do cabeÃ§alho
  SELECT company_id INTO v_chart_company
  FROM public.chart_of_accounts WHERE id = v_ap.chart_of_account_id;
  IF v_chart_company IS DISTINCT FROM v_ap.company_id THEN
    RAISE EXCEPTION 'Conta DRE de outra empresa';
  END IF;

  -- Favorecidos / dimensÃµes mesma empresa
  IF v_ap.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_ap.supplier_id AND s.company_id = v_ap.company_id AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Fornecedor invÃ¡lido ou de outra empresa'; END IF;

  IF v_ap.driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_ap.driver_id AND d.company_id = v_ap.company_id AND d.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Motorista invÃ¡lido ou de outra empresa'; END IF;

  IF v_ap.partner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partners p
    WHERE p.id = v_ap.partner_id AND p.company_id = v_ap.company_id AND p.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'SÃ³cio invÃ¡lido ou de outra empresa'; END IF;

  IF v_ap.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = v_ap.client_id AND c.company_id = v_ap.company_id AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Cliente invÃ¡lido ou de outra empresa'; END IF;

  IF v_ap.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_ap.branch_id AND b.company_id = v_ap.company_id
  ) THEN RAISE EXCEPTION 'Filial invÃ¡lida ou de outra empresa'; END IF;

  FOR r IN
    SELECT * FROM public.accounts_payable_allocations WHERE accounts_payable_id = p_payable_id
  LOOP
    IF r.company_id IS DISTINCT FROM v_ap.company_id THEN
      RAISE EXCEPTION 'Rateio com company_id divergente';
    END IF;
    v_coa := COALESCE(r.chart_of_account_id, v_ap.chart_of_account_id);
    IF v_coa IS NULL THEN
      RAISE EXCEPTION 'Rateio sem conta DRE efetiva';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts ca
      WHERE ca.id = v_coa AND ca.company_id = v_ap.company_id AND ca.transaction_type = 'Despesa'
    ) THEN
      RAISE EXCEPTION 'Conta DRE efetiva invÃ¡lida no rateio';
    END IF;
    IF r.vehicle_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = r.vehicle_id AND v.company_id = v_ap.company_id AND v.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'VeÃ­culo do rateio invÃ¡lido'; END IF;
    IF r.driver_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = r.driver_id AND d.company_id = v_ap.company_id AND d.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Motorista do rateio invÃ¡lido'; END IF;
    IF r.service_order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.service_orders so
      WHERE so.id = r.service_order_id AND so.company_id = v_ap.company_id
    ) THEN RAISE EXCEPTION 'OS do rateio invÃ¡lida'; END IF;
    IF r.branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = r.branch_id AND b.company_id = v_ap.company_id
    ) THEN RAISE EXCEPTION 'Filial do rateio invÃ¡lida'; END IF;
  END LOOP;

  RETURN v_ap;
END;
$$;

-- ---------------------------------------------------------------------------
-- Postagem DRE (interna)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ap_post_competence(p_payable_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  r RECORD;
  v_coa UUID;
  v_class TEXT;
  v_ft_id UUID;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_ap FROM public.accounts_payable WHERE id = p_payable_id FOR UPDATE;

  FOR r IN
    SELECT * FROM public.accounts_payable_allocations
    WHERE accounts_payable_id = p_payable_id
    ORDER BY line_no
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.accounts_payable_postings p
      WHERE p.allocation_id = r.id
        AND p.posting_type = 'competence'
        AND p.reversed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Postagem jÃ¡ existe para rateio %', r.id;
    END IF;

    v_coa := COALESCE(r.chart_of_account_id, v_ap.chart_of_account_id);
    SELECT classification INTO v_class
    FROM public.chart_of_accounts WHERE id = v_coa;

    INSERT INTO public.financial_transactions (
      company_id,
      branch_id,
      transaction_date,
      amount,
      chart_of_account_id,
      classification,
      transaction_type,
      client_id,
      supplier_id,
      driver_id,
      operational_vehicle_id,
      allocation_vehicle_id,
      service_order_id,
      description,
      entry_source,
      approval_status,
      created_by,
      updated_by
    ) VALUES (
      v_ap.company_id,
      COALESCE(r.branch_id, v_ap.branch_id),
      v_ap.competence_date,
      r.amount,
      v_coa,
      COALESCE(v_class, 'Operacional'),
      'Despesa',
      v_ap.client_id,
      v_ap.supplier_id,
      COALESCE(r.driver_id, v_ap.driver_id),
      r.vehicle_id,
      r.vehicle_id,
      r.service_order_id,
      v_ap.internal_number || ' â€” ' || v_ap.description,
      'accounts_payable',
      'approved',
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_ft_id;

    INSERT INTO public.accounts_payable_postings (
      company_id,
      accounts_payable_id,
      allocation_id,
      financial_transaction_id,
      posting_type,
      created_by,
      updated_by
    ) VALUES (
      v_ap.company_id,
      v_ap.id,
      r.id,
      v_ft_id,
      'competence',
      auth.uid(),
      auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Aprovar AP (RPC pÃºblica)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_accounts_payable(
  p_payable_id UUID,
  p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_settings public.company_financial_approval_settings%ROWTYPE;
  v_posted INTEGER;
BEGIN
  v_ap := public._ap_validate_ready_for_approval(p_payable_id);

  IF v_ap.approval_status = 'approved' THEN
    RAISE EXCEPTION 'TÃ­tulo jÃ¡ aprovado';
  END IF;
  IF v_ap.status = 'cancelled' THEN
    RAISE EXCEPTION 'TÃ­tulo cancelado';
  END IF;
  IF v_ap.approval_status NOT IN ('draft', 'submitted', 'rejected') THEN
    RAISE EXCEPTION 'Status de aprovaÃ§Ã£o invÃ¡lido para aprovar';
  END IF;

  SELECT * INTO v_settings
  FROM public.company_financial_approval_settings
  WHERE company_id = v_ap.company_id;

  IF COALESCE(v_settings.ap_approval_enabled, FALSE) THEN
    IF v_ap.approval_status <> 'submitted'
       AND NOT (
         v_settings.ap_auto_approve_below_amount IS NOT NULL
         AND v_ap.net_amount < v_settings.ap_auto_approve_below_amount
       )
    THEN
      IF v_ap.approval_status = 'draft' THEN
        RAISE EXCEPTION 'Envie o tÃ­tulo para aprovaÃ§Ã£o antes de aprovar';
      END IF;
    END IF;
    IF NOT public._ap_can_approve(v_ap.company_id) THEN
      RAISE EXCEPTION 'UsuÃ¡rio sem permissÃ£o para aprovar Contas a Pagar';
    END IF;
  ELSE
    -- aprovaÃ§Ã£o desligada: qualquer membro da empresa pode â€œaprovar/finalizarâ€
    PERFORM public._ap_assert_company_member(v_ap.company_id);
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'approved',
      status = CASE WHEN status IN ('suspended', 'cancelled') THEN status ELSE 'open' END,
      reviewed_by = auth.uid(),
      reviewed_by_name = public._ap_user_display_name(),
      reviewed_at = NOW(),
      review_note = NULLIF(btrim(COALESCE(p_review_note, '')), ''),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payable_id;

  v_posted := public._ap_post_competence(p_payable_id);

  RETURN jsonb_build_object(
    'ok', true,
    'accounts_payable_id', p_payable_id,
    'postings', v_posted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_accounts_payable(p_payable_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_enabled BOOLEAN;
  v_auto NUMERIC(14,2);
BEGIN
  v_ap := public._ap_validate_ready_for_approval(p_payable_id);

  IF v_ap.approval_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Somente rascunho ou rejeitado pode ser enviado';
  END IF;

  SELECT COALESCE(ap_approval_enabled, FALSE), ap_auto_approve_below_amount
  INTO v_enabled, v_auto
  FROM public.company_financial_approval_settings
  WHERE company_id = v_ap.company_id;

  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN public.approve_accounts_payable(p_payable_id, 'AprovaÃ§Ã£o automÃ¡tica (desligada na empresa)');
  END IF;

  IF v_auto IS NOT NULL AND v_ap.net_amount < v_auto THEN
    UPDATE public.accounts_payable
    SET approval_status = 'submitted',
        submitted_by = auth.uid(),
        submitted_at = NOW(),
        updated_by = auth.uid()
    WHERE id = p_payable_id;
    RETURN public.approve_accounts_payable(p_payable_id, 'Auto-aprovado por alÃ§ada');
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'submitted',
      submitted_by = auth.uid(),
      submitted_at = NOW(),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true, 'approval_status', 'submitted');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_accounts_payable(
  p_payable_id UUID,
  p_review_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
BEGIN
  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'TÃ­tulo nÃ£o encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);
  IF NOT public._ap_can_approve(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem permissÃ£o para rejeitar';
  END IF;
  IF v_ap.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Somente tÃ­tulos enviados podem ser rejeitados';
  END IF;
  IF p_review_note IS NULL OR btrim(p_review_note) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da rejeiÃ§Ã£o';
  END IF;

  UPDATE public.accounts_payable
  SET approval_status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_by_name = public._ap_user_display_name(),
      reviewed_at = NOW(),
      review_note = btrim(p_review_note),
      updated_by = auth.uid()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true, 'approval_status', 'rejected');
END;
$$;

-- ---------------------------------------------------------------------------
-- Pagamento + estorno
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_accounts_payable_payment(
  p_installment_id UUID,
  p_financial_account_id UUID,
  p_paid_at DATE,
  p_principal_amount NUMERIC,
  p_interest_amount NUMERIC DEFAULT 0,
  p_penalty_amount NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'Pix',
  p_bank_ref TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst public.accounts_payable_installments%ROWTYPE;
  v_ap public.accounts_payable%ROWTYPE;
  v_acc public.company_financial_accounts%ROWTYPE;
  v_total NUMERIC(14,2);
  v_pay_id UUID;
BEGIN
  SELECT * INTO v_inst
  FROM public.accounts_payable_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela nÃ£o encontrada'; END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = v_inst.accounts_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TÃ­tulo nÃ£o encontrado'; END IF;

  PERFORM public._ap_assert_company_member(v_ap.company_id);

  IF v_ap.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'SÃ³ Ã© possÃ­vel pagar tÃ­tulo aprovado';
  END IF;
  IF v_ap.status IN ('cancelled', 'suspended') THEN
    RAISE EXCEPTION 'TÃ­tulo cancelado ou suspenso';
  END IF;
  IF v_inst.status = 'cancelled' THEN
    RAISE EXCEPTION 'Parcela cancelada';
  END IF;

  SELECT * INTO v_acc
  FROM public.company_financial_accounts
  WHERE id = p_financial_account_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta financeira nÃ£o encontrada'; END IF;
  IF v_acc.company_id IS DISTINCT FROM v_ap.company_id
     OR v_inst.company_id IS DISTINCT FROM v_ap.company_id THEN
    RAISE EXCEPTION 'Empresa divergente entre tÃ­tulo, parcela e conta financeira';
  END IF;
  IF NOT v_acc.is_active THEN
    RAISE EXCEPTION 'Conta financeira inativa';
  END IF;

  p_principal_amount := COALESCE(p_principal_amount, 0);
  p_interest_amount := COALESCE(p_interest_amount, 0);
  p_penalty_amount := COALESCE(p_penalty_amount, 0);
  p_discount_amount := COALESCE(p_discount_amount, 0);

  IF p_principal_amount < 0 OR p_interest_amount < 0
     OR p_penalty_amount < 0 OR p_discount_amount < 0 THEN
    RAISE EXCEPTION 'Valores do pagamento nÃ£o podem ser negativos';
  END IF;
  IF p_principal_amount <= 0 THEN
    RAISE EXCEPTION 'principal_amount deve ser maior que zero';
  END IF;
  IF p_principal_amount > v_inst.open_balance THEN
    RAISE EXCEPTION 'principal_amount (%) excede saldo da parcela (%)',
      p_principal_amount, v_inst.open_balance;
  END IF;

  v_total := p_principal_amount + p_interest_amount + p_penalty_amount - p_discount_amount;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total_paid_amount deve ser maior que zero (desconto nÃ£o pode zerar/negativar a saÃ­da)';
  END IF;

  INSERT INTO public.accounts_payable_payments (
    company_id,
    accounts_payable_id,
    installment_id,
    paid_at,
    principal_amount,
    interest_amount,
    penalty_amount,
    discount_amount,
    total_paid_amount,
    financial_account_id,
    payment_method,
    bank_ref,
    notes,
    created_by,
    updated_by
  ) VALUES (
    v_ap.company_id,
    v_ap.id,
    v_inst.id,
    COALESCE(p_paid_at, CURRENT_DATE),
    p_principal_amount,
    p_interest_amount,
    p_penalty_amount,
    p_discount_amount,
    v_total,
    v_acc.id,
    COALESCE(NULLIF(btrim(p_payment_method), ''), 'Pix'),
    p_bank_ref,
    p_notes,
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO v_pay_id;

  PERFORM public.recalc_accounts_payable_balances(v_ap.id);

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'total_paid_amount', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_accounts_payable_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.accounts_payable_payments%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo do estorno obrigatÃ³rio';
  END IF;

  SELECT * INTO v_pay
  FROM public.accounts_payable_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento nÃ£o encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_pay.company_id);
  IF v_pay.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento jÃ¡ estornado';
  END IF;

  UPDATE public.accounts_payable_payments
  SET reversed_at = NOW(),
      reversal_reason = btrim(p_reason),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_payment_id;

  PERFORM public.recalc_accounts_payable_balances(v_pay.accounts_payable_id);

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id);
END;
$$;

-- Estorno de postagens DRE: cancela FT (amount > 0 no schema; nÃ£o gera receita)
CREATE OR REPLACE FUNCTION public.reverse_accounts_payable_postings(
  p_payable_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo obrigatÃ³rio';
  END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TÃ­tulo nÃ£o encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);
  IF NOT public._ap_can_approve(v_ap.company_id) THEN
    RAISE EXCEPTION 'Sem permissÃ£o para estornar postagens';
  END IF;

  FOR r IN
    SELECT * FROM public.accounts_payable_postings
    WHERE accounts_payable_id = p_payable_id
      AND posting_type = 'competence'
      AND reversed_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.financial_transactions
    SET approval_status = 'cancelled',
        review_note = COALESCE(review_note || ' | ', '') || 'Estorno AP: ' || btrim(p_reason),
        reviewed_at = NOW(),
        reviewed_by = auth.uid(),
        updated_by = auth.uid(),
        updated_at = NOW()
    WHERE id = r.financial_transaction_id;

    UPDATE public.accounts_payable_postings
    SET reversed_at = NOW(),
        reversal_reason = btrim(p_reason),
        updated_by = auth.uid()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reversed_postings', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_accounts_payable(
  p_payable_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_active_pay INTEGER;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motivo do cancelamento obrigatÃ³rio';
  END IF;

  SELECT * INTO v_ap
  FROM public.accounts_payable
  WHERE id = p_payable_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TÃ­tulo nÃ£o encontrado'; END IF;
  PERFORM public._ap_assert_company_member(v_ap.company_id);

  SELECT COUNT(*) INTO v_active_pay
  FROM public.accounts_payable_payments
  WHERE accounts_payable_id = p_payable_id AND reversed_at IS NULL;
  IF v_active_pay > 0 THEN
    RAISE EXCEPTION 'Estorne os pagamentos ativos antes de cancelar o tÃ­tulo';
  END IF;

  IF v_ap.approval_status = 'approved' THEN
    PERFORM public.reverse_accounts_payable_postings(p_payable_id, p_reason);
  END IF;

  UPDATE public.accounts_payable_installments
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancellation_reason = btrim(p_reason),
      updated_by = auth.uid()
  WHERE accounts_payable_id = p_payable_id
    AND status <> 'cancelled';

  UPDATE public.accounts_payable
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancellation_reason = btrim(p_reason),
      updated_by = auth.uid()
  WHERE id = p_payable_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_accounts_payable(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_accounts_payable(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_accounts_payable(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_accounts_payable(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.register_accounts_payable_payment(UUID, UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_accounts_payable_payment(UUID, UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_payment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_payment(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_accounts_payable_postings(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_accounts_payable_postings(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_accounts_payable(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_accounts_payable(UUID, TEXT) TO authenticated;

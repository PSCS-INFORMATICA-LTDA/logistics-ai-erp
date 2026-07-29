-- Rateios AP — sem cost_center_id no MVP

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
  'Rateio do título AP. cost_center_id fica para fase futura com tabela própria.';

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

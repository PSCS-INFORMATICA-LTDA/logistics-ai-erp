-- Contas a Pagar — reforço multiempresa (favorecido/DRE mesma empresa)
-- Migration: 074_ap_payee_company_guard.sql
-- Idempotente. Não altera produção automaticamente; aplicar só após validação.

CREATE OR REPLACE FUNCTION public._ap_assert_row_company_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coa_company UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO v_coa_company
  FROM public.chart_of_accounts
  WHERE id = NEW.chart_of_account_id;
  IF v_coa_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Conta DRE de outra empresa';
  END IF;

  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = NEW.supplier_id
      AND s.company_id = NEW.company_id
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Fornecedor inválido ou de outra empresa';
  END IF;

  IF NEW.driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = NEW.driver_id
      AND d.company_id = NEW.company_id
      AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Motorista inválido ou de outra empresa';
  END IF;

  IF NEW.partner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partners p
    WHERE p.id = NEW.partner_id
      AND p.company_id = NEW.company_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Sócio inválido ou de outra empresa';
  END IF;

  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.company_id = NEW.company_id
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou de outra empresa';
  END IF;

  IF NEW.company_payee_id IS NOT NULL AND NEW.company_payee_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Empresa favorecida inválida';
  END IF;

  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Filial de outra empresa';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ap_company_consistency ON public.accounts_payable;
CREATE TRIGGER trg_ap_company_consistency
  BEFORE INSERT OR UPDATE ON public.accounts_payable
  FOR EACH ROW
  EXECUTE FUNCTION public._ap_assert_row_company_consistency();

CREATE OR REPLACE FUNCTION public._ap_assert_allocation_company_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts_payable ap
    WHERE ap.id = NEW.accounts_payable_id AND ap.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Rateio com empresa inconsistente';
  END IF;

  IF NEW.chart_of_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts c
    WHERE c.id = NEW.chart_of_account_id AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Conta DRE do rateio de outra empresa';
  END IF;

  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = NEW.vehicle_id AND v.company_id = NEW.company_id AND v.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Veículo do rateio de outra empresa';
  END IF;

  IF NEW.driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = NEW.driver_id AND d.company_id = NEW.company_id AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Motorista do rateio de outra empresa';
  END IF;

  IF NEW.service_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_orders o
    WHERE o.id = NEW.service_order_id AND o.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'OS do rateio de outra empresa';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ap_alloc_company_consistency ON public.accounts_payable_allocations;
CREATE TRIGGER trg_ap_alloc_company_consistency
  BEFORE INSERT OR UPDATE ON public.accounts_payable_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public._ap_assert_allocation_company_consistency();

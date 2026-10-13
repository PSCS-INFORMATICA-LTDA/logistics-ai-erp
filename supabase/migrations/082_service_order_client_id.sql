-- service_orders.client_id aponta para clients.id da mesma company.
-- A coluna fica NULL: OS legada sem correspondência única continua válida.
-- Close operacional não é bloqueado por client_id nulo nesta wave.
--
-- Rollback lógico (não executar sem pedido):
--   DROP TRIGGER IF EXISTS trg_service_orders_client_same_company ON public.service_orders;
--   DROP FUNCTION IF EXISTS public.assert_service_order_client_same_company();
--   ALTER TABLE public.service_orders DROP CONSTRAINT IF EXISTS service_orders_client_id_fkey;
--   DROP INDEX IF EXISTS idx_service_orders_client_id;
--   ALTER TABLE public.service_orders DROP COLUMN IF EXISTS client_id;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS client_id UUID NULL;

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_client_id_fkey;

ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_service_orders_client_id
  ON public.service_orders (client_id)
  WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.service_orders.client_id IS
  'Cliente do cadastro da mesma company. NULL = OS legada sem vínculo único. client_name permanece snapshot.';

CREATE OR REPLACE FUNCTION public.assert_service_order_client_same_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_deleted TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.company_id, c.deleted_at, c.status
    INTO v_company, v_deleted, v_status
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente inexistente';
  END IF;

  IF v_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Cliente de outra empresa';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    IF v_deleted IS NOT NULL OR v_status IS DISTINCT FROM 'Ativo' THEN
      RAISE EXCEPTION 'Cliente inativo ou excluído';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_service_order_client_same_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_service_order_client_same_company() FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_service_order_client_same_company() TO authenticated;

DROP TRIGGER IF EXISTS trg_service_orders_client_same_company ON public.service_orders;
CREATE TRIGGER trg_service_orders_client_same_company
  BEFORE INSERT OR UPDATE OF client_id, company_id
  ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_service_order_client_same_company();

-- Backfill só com 1 cliente ativo, não excluído, da mesma company,
-- cujo name ou trade_name normalizado é igual ao client_name da OS.
WITH normalized_clients AS (
  SELECT
    id,
    company_id,
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS norm_name,
    lower(btrim(regexp_replace(coalesce(trade_name, ''), '\s+', ' ', 'g'))) AS norm_trade
  FROM public.clients
  WHERE deleted_at IS NULL
    AND status = 'Ativo'
),
os AS (
  SELECT
    id,
    company_id,
    lower(btrim(regexp_replace(client_name, '\s+', ' ', 'g'))) AS norm_name
  FROM public.service_orders
  WHERE client_id IS NULL
    AND client_name IS NOT NULL
    AND btrim(client_name) <> ''
),
hits AS (
  SELECT os.id AS os_id, c.id AS client_id
  FROM os
  JOIN normalized_clients c
    ON c.company_id = os.company_id
   AND (
     c.norm_name = os.norm_name
     OR (c.norm_trade <> '' AND c.norm_trade = os.norm_name)
   )
),
unique_hits AS (
  SELECT os_id, (min(client_id::text))::uuid AS client_id
  FROM hits
  GROUP BY os_id
  HAVING count(DISTINCT client_id) = 1
)
UPDATE public.service_orders so
SET client_id = u.client_id
FROM unique_hits u
WHERE so.id = u.os_id
  AND so.client_id IS NULL;

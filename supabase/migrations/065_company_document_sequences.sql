-- Contas a Pagar Fase 1 — sequências de documentos por empresa
-- Não usar sequence PostgreSQL global como fonte principal.

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
  'Numeração transacional por empresa + tipo de documento (ex.: accounts_payable → AP-00000001).';

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
    RAISE EXCEPTION 'company_id e document_type são obrigatórios';
  END IF;

  IF NOT public.auth_user_has_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso à empresa';
  END IF;

  v_prefix := COALESCE(NULLIF(btrim(p_prefix), ''), upper(btrim(p_document_type)));
  v_padding := COALESCE(p_padding, 8);
  IF v_padding < 1 OR v_padding > 12 THEN
    RAISE EXCEPTION 'padding inválido';
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
    RAISE EXCEPTION 'Falha ao gerar número de documento';
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

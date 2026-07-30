-- Documentos / licenças / autorizações (empresa + veículo)
-- Tipos parametrizáveis, versões (histórico), alertas in-app

-- ---------------------------------------------------------------------------
-- Tipos de documento (por empresa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  acronym TEXT,
  issuing_body TEXT,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('company', 'vehicle')),
  requires_expiry BOOLEAN NOT NULL DEFAULT TRUE,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_categories TEXT[] NOT NULL DEFAULT '{}',
  alert_days_first INT NOT NULL DEFAULT 60,
  alert_days_second INT NOT NULL DEFAULT 30,
  alert_days_critical INT NOT NULL DEFAULT 15,
  alert_days_urgent INT NOT NULL DEFAULT 7,
  sort_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_types_name_company_unique UNIQUE (company_id, name, applies_to)
);

CREATE INDEX IF NOT EXISTS idx_document_types_company
  ON public.document_types (company_id, applies_to, sort_order)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- Documentos (versão atual + histórico na mesma tabela)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('company', 'vehicle')),
  owner_id UUID NOT NULL,
  document_type_id UUID NOT NULL REFERENCES public.document_types(id),
  document_number TEXT,
  issuing_body TEXT,
  issued_at DATE,
  expires_at DATE,
  no_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  renewal_start_date DATE,
  renewal_status TEXT NOT NULL DEFAULT 'none'
    CHECK (renewal_status IN ('none', 'in_renewal')),
  manual_status TEXT
    CHECK (manual_status IS NULL OR manual_status IN ('suspended', 'not_applicable')),
  alert_days_first INT,
  alert_days_second INT,
  alert_days_critical INT,
  alert_days_urgent INT,
  responsible_name TEXT,
  responsible_user_id UUID REFERENCES auth.users(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  root_id UUID,
  version_number INT NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id UUID REFERENCES public.compliance_documents(id),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_owner
  ON public.compliance_documents (company_id, owner_type, owner_id)
  WHERE deleted_at IS NULL AND is_current;

CREATE INDEX IF NOT EXISTS idx_compliance_docs_root
  ON public.compliance_documents (company_id, root_id, version_number);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_expires
  ON public.compliance_documents (company_id, expires_at)
  WHERE deleted_at IS NULL AND is_current AND no_expiry = FALSE;

-- root_id = self na 1ª versão
CREATE OR REPLACE FUNCTION public.compliance_documents_set_root()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.root_id IS NULL THEN
    NEW.root_id := NEW.id;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compliance_documents_root ON public.compliance_documents;
CREATE TRIGGER trg_compliance_documents_root
  BEFORE INSERT OR UPDATE ON public.compliance_documents
  FOR EACH ROW EXECUTE FUNCTION public.compliance_documents_set_root();

-- ---------------------------------------------------------------------------
-- Outbox de alertas (dedup por documento + tier + período)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_alert_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.compliance_documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  alert_tier TEXT NOT NULL CHECK (alert_tier IN (
    'first', 'second', 'critical', 'urgent', 'expired'
  )),
  period_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  read_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_alert_dedup
  ON public.compliance_alert_outbox (
    company_id,
    document_id,
    alert_tier,
    period_key,
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_compliance_alert_unread
  ON public.compliance_alert_outbox (company_id, created_at DESC)
  WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- attachments: novo entity_type
-- ---------------------------------------------------------------------------
ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_entity_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type IN (
    'branch', 'partner', 'vehicle', 'driver', 'client', 'supplier',
    'financial_transaction', 'cash_flow_entry', 'parking_entry',
    'service_order', 'vehicle_event', 'traffic_infraction',
    'car_wash_service', 'compliance_document'
  ));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_alert_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_types_select ON public.document_types;
DROP POLICY IF EXISTS document_types_insert ON public.document_types;
DROP POLICY IF EXISTS document_types_update ON public.document_types;
DROP POLICY IF EXISTS document_types_delete ON public.document_types;

CREATE POLICY document_types_select ON public.document_types
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY document_types_insert ON public.document_types
  FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY document_types_update ON public.document_types
  FOR UPDATE TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY document_types_delete ON public.document_types
  FOR DELETE TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()));

DROP POLICY IF EXISTS compliance_documents_select ON public.compliance_documents;
DROP POLICY IF EXISTS compliance_documents_insert ON public.compliance_documents;
DROP POLICY IF EXISTS compliance_documents_update ON public.compliance_documents;
DROP POLICY IF EXISTS compliance_documents_delete ON public.compliance_documents;

CREATE POLICY compliance_documents_select ON public.compliance_documents
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.auth_user_company_ids())
    AND deleted_at IS NULL
  );
CREATE POLICY compliance_documents_insert ON public.compliance_documents
  FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY compliance_documents_update ON public.compliance_documents
  FOR UPDATE TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY compliance_documents_delete ON public.compliance_documents
  FOR DELETE TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()));

DROP POLICY IF EXISTS compliance_alert_outbox_select ON public.compliance_alert_outbox;
DROP POLICY IF EXISTS compliance_alert_outbox_insert ON public.compliance_alert_outbox;
DROP POLICY IF EXISTS compliance_alert_outbox_update ON public.compliance_alert_outbox;

CREATE POLICY compliance_alert_outbox_select ON public.compliance_alert_outbox
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY compliance_alert_outbox_insert ON public.compliance_alert_outbox
  FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));
CREATE POLICY compliance_alert_outbox_update ON public.compliance_alert_outbox
  FOR UPDATE TO authenticated
  USING (company_id IN (SELECT public.auth_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.auth_user_company_ids()));

COMMENT ON TABLE public.document_types IS
  'Tipos configuráveis de documentos/licenças (empresa ou veículo).';
COMMENT ON TABLE public.compliance_documents IS
  'Documentos vigentes e histórico de renovações (is_current / root_id / version).';
COMMENT ON TABLE public.compliance_alert_outbox IS
  'Alertas de vencimento documental com deduplicação por período.';

-- Seed de tipos sugeridos (PREFIXO, CVS, ANTT, ARTESP, EMTU, AET, CRLV, SEGURO,
-- OUTROS, TA): aplicado por empresa no app via seedDefaultDocumentTypes()
-- (frontend/src/lib/compliance-documents-api.ts), para não amarrar company_id
-- fixo de GRX na migration multiempresa.

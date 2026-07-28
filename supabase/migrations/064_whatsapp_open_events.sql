-- Log de tentativa de abertura do WhatsApp (não é “mensagem enviada”).
-- Aplicar no Supabase SQL Editor (prod/dev).

CREATE TABLE IF NOT EXISTS public.whatsapp_open_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'whatsapp_open_requested'
    CHECK (event_type = 'whatsapp_open_requested'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_open_events_company_occurred_idx
  ON public.whatsapp_open_events (company_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_open_events_reference_idx
  ON public.whatsapp_open_events (company_id, reference_type, reference_id);

COMMENT ON TABLE public.whatsapp_open_events IS
  'Auditoria: usuário solicitou abrir o WhatsApp (não confirma envio da mensagem).';

ALTER TABLE public.whatsapp_open_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_open_events_insert_member ON public.whatsapp_open_events;
CREATE POLICY whatsapp_open_events_insert_member ON public.whatsapp_open_events
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = whatsapp_open_events.company_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS whatsapp_open_events_select_member ON public.whatsapp_open_events;
CREATE POLICY whatsapp_open_events_select_member ON public.whatsapp_open_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = whatsapp_open_events.company_id
        AND m.user_id = auth.uid()
    )
  );

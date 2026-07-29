-- Contas a Pagar / Contas financeiras — restauração soft via histórico de exclusões
-- Migration: 076_ap_restore_soft_delete.sql
-- Estende restore_deleted_from_audit para entity_type accounts_payable e
-- company_financial_accounts (já listados no frontend SOFT_RESTORABLE_ENTITY_TYPES).
-- Idempotente (CREATE OR REPLACE). Não aplicar em produção nesta etapa.

CREATE OR REPLACE FUNCTION public.restore_deleted_from_audit(
  p_event_id UUID,
  p_restoration_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.deletion_audit_events%ROWTYPE;
  v_reason TEXT := btrim(COALESCE(p_restoration_reason, ''));
  v_actor UUID := auth.uid();
  v_name TEXT;
  v_email TEXT;
  v_updated INT := 0;
  v_entity_uuid UUID;
  v_payload JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF char_length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Informe um motivo de restauração com pelo menos 8 caracteres.';
  END IF;

  SELECT * INTO v_event
  FROM public.deletion_audit_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de exclusão não encontrado.';
  END IF;

  IF NOT public.auth_user_is_company_admin(v_event.company_id) THEN
    RAISE EXCEPTION 'Somente administrador da empresa pode restaurar.';
  END IF;

  IF v_event.restored IS TRUE THEN
    RAISE EXCEPTION 'Este registro já foi restaurado.';
  END IF;

  SELECT
    COALESCE(
      NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'full_name', '')), ''),
      NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'name', '')), ''),
      split_part(COALESCE(u.email, ''), '@', 1),
      u.email
    ),
    u.email
  INTO v_name, v_email
  FROM auth.users u
  WHERE u.id = v_actor;

  BEGIN
    v_entity_uuid := v_event.entity_id::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'ID do registro inválido para restauração.';
  END;

  IF v_event.delete_mode = 'soft' THEN
    IF v_event.entity_type = 'clients' THEN
      UPDATE public.clients SET deleted_at = NULL
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'suppliers' THEN
      UPDATE public.suppliers SET deleted_at = NULL
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'vehicles' THEN
      UPDATE public.vehicles SET deleted_at = NULL
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'drivers' THEN
      UPDATE public.drivers SET deleted_at = NULL
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'partners' THEN
      UPDATE public.partners
      SET deleted_at = NULL, status = 'Ativo'
      WHERE id = v_entity_uuid
        AND company_id = v_event.company_id
        AND (deleted_at IS NOT NULL OR status IS DISTINCT FROM 'Ativo');
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'accounts_payable' THEN
      UPDATE public.accounts_payable SET deleted_at = NULL
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF v_event.entity_type = 'company_financial_accounts' THEN
      UPDATE public.company_financial_accounts
      SET deleted_at = NULL, is_active = TRUE
      WHERE id = v_entity_uuid AND company_id = v_event.company_id AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSE
      RAISE EXCEPTION 'Tipo soft "%" não é restaurável automaticamente.', v_event.entity_type;
    END IF;

    IF v_updated = 0 THEN
      RAISE EXCEPTION 'Registro não encontrado como excluído (já ativo ou apagado em definitivo).';
    END IF;
  ELSIF v_event.delete_mode = 'hard' THEN
    v_payload := COALESCE(v_event.payload_json, '{}'::jsonb)
      - '__deletion_reason'
      - '__deletion_reason_code';

    IF v_payload = '{}'::jsonb OR NOT (v_payload ? 'id') THEN
      RAISE EXCEPTION 'Snapshot indisponível para restauração hard.';
    END IF;

    -- Garante isolamento multiempresa
    v_payload := jsonb_set(v_payload, '{company_id}', to_jsonb(v_event.company_id));
    v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_entity_uuid));

    IF v_event.entity_type = 'financial_transactions' THEN
      INSERT INTO public.financial_transactions
      SELECT * FROM jsonb_populate_record(NULL::public.financial_transactions, v_payload);
    ELSIF v_event.entity_type = 'vehicle_ownership' THEN
      INSERT INTO public.vehicle_ownership
      SELECT * FROM jsonb_populate_record(NULL::public.vehicle_ownership, v_payload);
    ELSIF v_event.entity_type = 'traffic_infractions' THEN
      INSERT INTO public.traffic_infractions
      SELECT * FROM jsonb_populate_record(NULL::public.traffic_infractions, v_payload);
    ELSIF v_event.entity_type = 'service_orders' THEN
      INSERT INTO public.service_orders
      SELECT * FROM jsonb_populate_record(NULL::public.service_orders, v_payload);
    ELSE
      RAISE EXCEPTION 'Tipo hard "%" não é restaurável automaticamente.', v_event.entity_type;
    END IF;
  ELSE
    RAISE EXCEPTION 'Modo de exclusão inválido.';
  END IF;

  UPDATE public.deletion_audit_events
  SET
    restored = true,
    restored_at = NOW(),
    restored_by = v_actor,
    restored_by_name = v_name,
    restored_by_email = v_email,
    restoration_reason = v_reason
  WHERE id = v_event.id;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'entity_type', v_event.entity_type,
    'entity_id', v_event.entity_id,
    'delete_mode', v_event.delete_mode,
    'restored_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_deleted_from_audit(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_deleted_from_audit(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.restore_deleted_from_audit(UUID, TEXT) IS
  'Restaura exclusão soft/hard a partir de deletion_audit_events (inclui Contas a Pagar e contas financeiras).';

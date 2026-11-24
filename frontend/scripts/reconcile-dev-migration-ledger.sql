-- Reconciliação do controle de migrations do DEV.
-- Projeto autorizado: jmbajdpkvlrslirwzyze.
-- Não executar sem autorização explícita desta reconciliação.
-- Não roda o corpo de nenhuma migration. Só insere nomes já conferidos.
-- Não apaga 021_seed_demo_freight_os.sql nem 060_import_driver_confirmed.sql.
-- Não usar em produção (tqeenmswotxqainkyyct).
-- A conexão permitida é só db.jmbajdpkvlrslirwzyze.supabase.co,
-- ou o pooler com usuário postgres.jmbajdpkvlrslirwzyze.
-- O conferidor frontend/scripts/reconcile-dev-migration-ledger.mjs recusa qualquer outro host
-- e não abre conexão. Este arquivo também recusa o banco se as duas empresas de homologação
-- do DEV não estiverem presentes com o nome conferido.
-- Hash ausente vira NULL e IS DISTINCT FROM dispara a exceção.
-- Função identificada por schema e assinatura. Trigger conferida por tabela, definição e tgenabled = O.
-- applied_at dos 80 nomes anteriores precisa permanecer igual. applied_at dos novos fica now().
-- Se qualquer conferência falhar, a transação inteira desfaz. Resultado autorizado: 91 linhas.

BEGIN;

LOCK TABLE public._dev_schema_migrations IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE recon_ledger_before ON COMMIT DROP AS
SELECT filename, applied_at
FROM public._dev_schema_migrations;

CREATE OR REPLACE FUNCTION pg_temp.recon_assert_ledger_acl()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = '_dev_schema_migrations'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'reconciliação: RLS do controle divergiu. Interromper.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = '_dev_schema_migrations'
  ) THEN
    RAISE EXCEPTION 'reconciliação: policy inesperada no controle. Interromper.';
  END IF;

  IF has_table_privilege('anon', 'public._dev_schema_migrations', 'SELECT')
     OR has_table_privilege('anon', 'public._dev_schema_migrations', 'INSERT')
     OR has_table_privilege('anon', 'public._dev_schema_migrations', 'UPDATE')
     OR has_table_privilege('anon', 'public._dev_schema_migrations', 'DELETE')
     OR has_table_privilege('authenticated', 'public._dev_schema_migrations', 'SELECT')
     OR has_table_privilege('authenticated', 'public._dev_schema_migrations', 'INSERT')
     OR has_table_privilege('authenticated', 'public._dev_schema_migrations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public._dev_schema_migrations', 'DELETE')
     OR has_table_privilege('public', 'public._dev_schema_migrations', 'SELECT')
     OR has_table_privilege('public', 'public._dev_schema_migrations', 'INSERT')
  THEN
    RAISE EXCEPTION 'reconciliação: anon, authenticated ou PUBLIC acessa o controle. Interromper.';
  END IF;

  IF NOT has_table_privilege('postgres', 'public._dev_schema_migrations', 'INSERT') THEN
    RAISE EXCEPTION 'reconciliação: postgres não insere no controle. Interromper.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public._dev_schema_migrations', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public._dev_schema_migrations', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public._dev_schema_migrations', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public._dev_schema_migrations', 'DELETE')
  THEN
    RAISE EXCEPTION 'reconciliação: privilégio de service_role no controle divergiu. Interromper.';
  END IF;
END;
$$;

DO $recon_pre$
DECLARE
  v_hash text;
  v_count integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'reconciliação: sessão % não é postgres. Interromper.', current_user;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = '92c4c90d-6856-4c41-a9a1-9eba6a7468f6'
      AND name = 'PSCS DEV Contas a Pagar'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = 'bcd3c6c9-0e4a-4356-addd-4af925725576'
      AND name = 'GRX DEV Empresa B'
  ) THEN
    RAISE EXCEPTION 'reconciliação: ambiente não é o DEV jmbajdpkvlrslirwzyze. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM recon_ledger_before WHERE filename = '021_seed_demo_freight_os.sql'
  ) OR NOT EXISTS (
    SELECT 1 FROM recon_ledger_before WHERE filename = '060_import_driver_confirmed.sql'
  ) THEN
    RAISE EXCEPTION 'reconciliação: histórico 021 ou 060 ausente. Interromper sem apagar nada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM recon_ledger_before
    WHERE filename IN (
    ('078_pscs_one_user_id.sql'),
    ('079_close_company_members_self_join.sql'),
    ('083_public_driver_assignment_schedule.sql'),
    ('084_service_order_security_guards.sql'),
    ('085_driver_reassignment_and_public_amounts.sql'),
    ('086_rbac_financial_and_ownership_view.sql'),
    ('087_driver_payment_and_finance_rpc_guards.sql'),
    ('088_financial_approval_status_guard.sql'),
    ('089_financial_insert_delete_guard.sql'),
    ('090_financial_approved_field_guard.sql'),
    ('091_pre_pilot_security.sql')
    )
  ) THEN
    RAISE EXCEPTION 'reconciliação: algum nome 078-091 já está no controle. Interromper.';
  END IF;

  SELECT count(*) INTO v_count FROM recon_ledger_before;
  IF v_count IS DISTINCT FROM 80
     OR EXISTS (
       SELECT filename FROM recon_ledger_before
       EXCEPT
       SELECT expected.filename FROM (VALUES
    ('001_schema.sql'),
    ('002_auth_rls.sql'),
    ('003_seed_chart_of_accounts.sql'),
    ('004_vehicle_ownership.sql'),
    ('005_drivers_cnh.sql'),
    ('006_seed_drivers.sql'),
    ('007_drivers_cnh_categories.sql'),
    ('008_storage_attachments.sql'),
    ('009_service_orders_driver.sql'),
    ('010_traffic_infractions.sql'),
    ('011_traffic_infractions_workflow.sql'),
    ('012_traffic_infractions_plate.sql'),
    ('013_service_orders_categories.sql'),
    ('014_service_orders_freight.sql'),
    ('015_service_orders_freight_tolls.sql'),
    ('016_vehicles_axle_count.sql'),
    ('017_service_orders_status_approval.sql'),
    ('018_service_orders_per_diem.sql'),
    ('019_service_orders_per_diem_charge.sql'),
    ('020_service_orders_transport_km_rate.sql'),
    ('021_seed_demo_freight_os.sql'),
    ('022_service_order_proposals.sql'),
    ('023_reset_proposal_client_response.sql'),
    ('024_driver_assignment.sql'),
    ('025_driver_assignment_public_toll.sql'),
    ('026_driver_assignment_keep_proposed_on_reject.sql'),
    ('027_driver_assignment_rejected_drivers.sql'),
    ('028_reset_driver_assignment.sql'),
    ('029_service_order_completion.sql'),
    ('030_driver_assignment_pay_amounts.sql'),
    ('031_driver_banking_and_payments.sql'),
    ('032_driver_payment_dre_entries.sql'),
    ('033_service_order_passengers.sql'),
    ('034_partners_rg_cpf.sql'),
    ('035_access_parameters.sql'),
    ('036_master_recovery_phrase.sql'),
    ('037_company_billing.sql'),
    ('038_vehicle_expenses.sql'),
    ('039_company_ledger.sql'),
    ('040_driver_photo.sql'),
    ('041_patio_parking_wash.sql'),
    ('042_patio_payment_proof_attachments.sql'),
    ('043_freight_rate_tables.sql'),
    ('044_patio_rotativo_hourly.sql'),
    ('045_vehicle_photo.sql'),
    ('046_dashboard_demo_seed.sql'),
    ('047_dashboard_demo_volume.sql'),
    ('048_deletion_audit.sql'),
    ('049_deletion_audit_reason.sql'),
    ('050_license_terms_acceptance.sql'),
    ('051_company_logo.sql'),
    ('052_party_address_cnpj.sql'),
    ('053_unique_party_documents.sql'),
    ('054_deletion_audit_hardening.sql'),
    ('055_deletion_approval_hard_restore_alerts.sql'),
    ('056_financial_approval.sql'),
    ('057_company_members_admin_access.sql'),
    ('058_legacy_number.sql'),
    ('059_compliance_documents.sql'),
    ('060_import_driver_confirmed.sql'),
    ('061_parking_mensal_period.sql'),
    ('062_patio_public_ticket.sql'),
    ('063_car_wash_ready_loyalty.sql'),
    ('064_whatsapp_open_events.sql'),
    ('065_company_document_sequences.sql'),
    ('066_company_financial_accounts.sql'),
    ('067_accounts_payable.sql'),
    ('068_accounts_payable_installments.sql'),
    ('069_accounts_payable_allocations.sql'),
    ('070_accounts_payable_payments.sql'),
    ('071_accounts_payable_postings.sql'),
    ('072_ap_approval_settings_and_attachments.sql'),
    ('073_accounts_payable_rpcs.sql'),
    ('074_ap_payee_company_guard.sql'),
    ('075_ap_soft_delete_select_policy.sql'),
    ('076_ap_restore_soft_delete.sql'),
    ('077_ap_soft_delete_rpc.sql'),
    ('080_canonical_driver_confirmed.sql'),
    ('081_driver_confirmed_privilege_hardening.sql'),
    ('082_service_order_client_id.sql')
       ) AS expected(filename)
     )
     OR EXISTS (
       SELECT expected.filename FROM (VALUES
    ('001_schema.sql'),
    ('002_auth_rls.sql'),
    ('003_seed_chart_of_accounts.sql'),
    ('004_vehicle_ownership.sql'),
    ('005_drivers_cnh.sql'),
    ('006_seed_drivers.sql'),
    ('007_drivers_cnh_categories.sql'),
    ('008_storage_attachments.sql'),
    ('009_service_orders_driver.sql'),
    ('010_traffic_infractions.sql'),
    ('011_traffic_infractions_workflow.sql'),
    ('012_traffic_infractions_plate.sql'),
    ('013_service_orders_categories.sql'),
    ('014_service_orders_freight.sql'),
    ('015_service_orders_freight_tolls.sql'),
    ('016_vehicles_axle_count.sql'),
    ('017_service_orders_status_approval.sql'),
    ('018_service_orders_per_diem.sql'),
    ('019_service_orders_per_diem_charge.sql'),
    ('020_service_orders_transport_km_rate.sql'),
    ('021_seed_demo_freight_os.sql'),
    ('022_service_order_proposals.sql'),
    ('023_reset_proposal_client_response.sql'),
    ('024_driver_assignment.sql'),
    ('025_driver_assignment_public_toll.sql'),
    ('026_driver_assignment_keep_proposed_on_reject.sql'),
    ('027_driver_assignment_rejected_drivers.sql'),
    ('028_reset_driver_assignment.sql'),
    ('029_service_order_completion.sql'),
    ('030_driver_assignment_pay_amounts.sql'),
    ('031_driver_banking_and_payments.sql'),
    ('032_driver_payment_dre_entries.sql'),
    ('033_service_order_passengers.sql'),
    ('034_partners_rg_cpf.sql'),
    ('035_access_parameters.sql'),
    ('036_master_recovery_phrase.sql'),
    ('037_company_billing.sql'),
    ('038_vehicle_expenses.sql'),
    ('039_company_ledger.sql'),
    ('040_driver_photo.sql'),
    ('041_patio_parking_wash.sql'),
    ('042_patio_payment_proof_attachments.sql'),
    ('043_freight_rate_tables.sql'),
    ('044_patio_rotativo_hourly.sql'),
    ('045_vehicle_photo.sql'),
    ('046_dashboard_demo_seed.sql'),
    ('047_dashboard_demo_volume.sql'),
    ('048_deletion_audit.sql'),
    ('049_deletion_audit_reason.sql'),
    ('050_license_terms_acceptance.sql'),
    ('051_company_logo.sql'),
    ('052_party_address_cnpj.sql'),
    ('053_unique_party_documents.sql'),
    ('054_deletion_audit_hardening.sql'),
    ('055_deletion_approval_hard_restore_alerts.sql'),
    ('056_financial_approval.sql'),
    ('057_company_members_admin_access.sql'),
    ('058_legacy_number.sql'),
    ('059_compliance_documents.sql'),
    ('060_import_driver_confirmed.sql'),
    ('061_parking_mensal_period.sql'),
    ('062_patio_public_ticket.sql'),
    ('063_car_wash_ready_loyalty.sql'),
    ('064_whatsapp_open_events.sql'),
    ('065_company_document_sequences.sql'),
    ('066_company_financial_accounts.sql'),
    ('067_accounts_payable.sql'),
    ('068_accounts_payable_installments.sql'),
    ('069_accounts_payable_allocations.sql'),
    ('070_accounts_payable_payments.sql'),
    ('071_accounts_payable_postings.sql'),
    ('072_ap_approval_settings_and_attachments.sql'),
    ('073_accounts_payable_rpcs.sql'),
    ('074_ap_payee_company_guard.sql'),
    ('075_ap_soft_delete_select_policy.sql'),
    ('076_ap_restore_soft_delete.sql'),
    ('077_ap_soft_delete_rpc.sql'),
    ('080_canonical_driver_confirmed.sql'),
    ('081_driver_confirmed_privilege_hardening.sql'),
    ('082_service_order_client_id.sql')
       ) AS expected(filename)
       EXCEPT
       SELECT filename FROM recon_ledger_before
     )
  THEN
    RAISE EXCEPTION 'reconciliação: o conjunto anterior não é o controle de 80 nomes do DEV. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'pscs_one_user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_profiles_pscs_one_user_id'
  ) THEN
    RAISE EXCEPTION 'reconciliação: objeto da 078 ausente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'company_has_no_members'
    AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid';
  IF v_hash IS DISTINCT FROM '34ec32e408fd9e31e9f6b8785bba2645' THEN
    RAISE EXCEPTION 'reconciliação: public.company_has_no_members(p_company_id uuid) ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_public_driver_assignment'
    AND pg_get_function_identity_arguments(p.oid) = 'p_token text';
  IF v_hash IS DISTINCT FROM '0b78825b926734ff061cfc9e8324e27f' THEN
    RAISE EXCEPTION 'reconciliação: public.get_public_driver_assignment(p_token text) ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'guard_financial_transaction_approval_status'
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_hash IS DISTINCT FROM 'dc0c567dcb3da1bec64c4c866e2a1d19' THEN
    RAISE EXCEPTION 'reconciliação: public.guard_financial_transaction_approval_status() ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = '_ap_post_competence'
    AND pg_get_function_identity_arguments(p.oid) = 'p_payable_id uuid';
  IF v_hash IS DISTINCT FROM '47047e0b09040da34462a84c1fcdf5c5' THEN
    RAISE EXCEPTION 'reconciliação: public._ap_post_competence(p_payable_id uuid) ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'correct_financial_transaction_audited'
    AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_reason text, p_patch jsonb, p_reason_code text, p_screen_key text';
  IF v_hash IS DISTINCT FROM '75f66cc57a01e707bf0140140ce10367' THEN
    RAISE EXCEPTION 'reconciliação: public.correct_financial_transaction_audited(p_id uuid, p_reason text, p_patch jsonb, p_reason_code text, p_screen_key text) ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'seed_chart_of_accounts'
    AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid';
  IF v_hash IS DISTINCT FROM 'a67a1d08d8124f4ab09ee9ce031ebf3c' THEN
    RAISE EXCEPTION 'reconciliação: public.seed_chart_of_accounts(p_company_id uuid) ausente ou divergente. Interromper.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'seed_demo_freight_os'
    AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid';
  IF v_hash IS DISTINCT FROM 'ddc2a45d832812526a5aba9ddf5eaa29' THEN
    RAISE EXCEPTION 'reconciliação: public.seed_demo_freight_os(p_company_id uuid) ausente ou divergente. Interromper.';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'service_orders'
      AND t.tgname = 'trg_service_orders_guard_direct_confirmation'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_service_order_direct_confirmation'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_service_orders_guard_direct_confirmation BEFORE UPDATE ON public.service_orders FOR EACH ROW EXECUTE FUNCTION guard_service_order_direct_confirmation()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_service_orders_guard_direct_confirmation ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_transactions'
      AND t.tgname = 'trg_financial_transactions_approval_status'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_transaction_approval_status'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_transactions_approval_status BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_approval_status()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_transactions_approval_status ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_transactions'
      AND t.tgname = 'trg_financial_transactions_approval_insert'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_transaction_approval_insert'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_transactions_approval_insert BEFORE INSERT ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_approval_insert()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_transactions_approval_insert ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_transactions'
      AND t.tgname = 'trg_financial_transactions_direct_delete'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_transaction_direct_delete'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_transactions_direct_delete BEFORE DELETE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_direct_delete()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_transactions_direct_delete ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_correction_events'
      AND t.tgname = 'trg_financial_correction_events_immutable'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_correction_events_immutable'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_correction_events_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.financial_correction_events FOR EACH ROW EXECUTE FUNCTION guard_financial_correction_events_immutable()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_correction_events_immutable ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_correction_events'
      AND t.tgname = 'trg_financial_correction_events_no_truncate'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_correction_events_no_truncate'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_correction_events_no_truncate BEFORE TRUNCATE ON public.financial_correction_events FOR EACH STATEMENT EXECUTE FUNCTION guard_financial_correction_events_no_truncate()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_correction_events_no_truncate ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND c.relname = 'financial_transactions'
      AND t.tgname = 'trg_financial_transactions_approved_fields'
      AND t.tgenabled = 'O'
      AND pn.nspname = 'public'
      AND p.proname = 'guard_financial_transaction_approved_fields'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER trg_financial_transactions_approved_fields BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_approved_fields()'
  ) THEN
    RAISE EXCEPTION 'reconciliação: trigger trg_financial_transactions_approved_fields ausente, desativada ou com definição diferente. Interromper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vw_ownership_base'
      AND 'security_invoker=true' = ANY (c.reloptions)
  ) THEN
    RAISE EXCEPTION 'reconciliação: view da 086 sem security_invoker. Interromper.';
  END IF;

  PERFORM pg_temp.recon_assert_ledger_acl();
END
$recon_pre$;

INSERT INTO public._dev_schema_migrations (filename)
VALUES
    ('078_pscs_one_user_id.sql'),
    ('079_close_company_members_self_join.sql'),
    ('083_public_driver_assignment_schedule.sql'),
    ('084_service_order_security_guards.sql'),
    ('085_driver_reassignment_and_public_amounts.sql'),
    ('086_rbac_financial_and_ownership_view.sql'),
    ('087_driver_payment_and_finance_rpc_guards.sql'),
    ('088_financial_approval_status_guard.sql'),
    ('089_financial_insert_delete_guard.sql'),
    ('090_financial_approved_field_guard.sql'),
    ('091_pre_pilot_security.sql');

DO $recon_post$
DECLARE
  v_hash text;
  v_count integer;
BEGIN
  PERFORM pg_temp.recon_assert_ledger_acl();

  IF EXISTS (
    SELECT 1 FROM recon_ledger_before b
    WHERE NOT EXISTS (
      SELECT 1 FROM public._dev_schema_migrations m
      WHERE m.filename = b.filename
        AND m.applied_at IS NOT DISTINCT FROM b.applied_at
    )
  ) THEN
    RAISE EXCEPTION 'reconciliação: registro anterior foi alterado. Rollback.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations WHERE filename = '021_seed_demo_freight_os.sql'
  ) OR NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations WHERE filename = '060_import_driver_confirmed.sql'
  ) THEN
    RAISE EXCEPTION 'reconciliação: 021 ou 060 sumiu. Rollback.';
  END IF;

  SELECT count(*) INTO v_count
  FROM public._dev_schema_migrations
  WHERE filename IN (
    ('078_pscs_one_user_id.sql'),
    ('079_close_company_members_self_join.sql'),
    ('083_public_driver_assignment_schedule.sql'),
    ('084_service_order_security_guards.sql'),
    ('085_driver_reassignment_and_public_amounts.sql'),
    ('086_rbac_financial_and_ownership_view.sql'),
    ('087_driver_payment_and_finance_rpc_guards.sql'),
    ('088_financial_approval_status_guard.sql'),
    ('089_financial_insert_delete_guard.sql'),
    ('090_financial_approved_field_guard.sql'),
    ('091_pre_pilot_security.sql')
  );
  IF v_count IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'reconciliação: pós-validação achou % nomes novos, esperado 11. Rollback.', v_count;
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'seed_chart_of_accounts'
    AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid';
  IF v_hash IS DISTINCT FROM 'a67a1d08d8124f4ab09ee9ce031ebf3c' THEN
    RAISE EXCEPTION 'reconciliação: seed_chart_of_accounts mudou durante o registro. Rollback.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'correct_financial_transaction_audited'
    AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_reason text, p_patch jsonb, p_reason_code text, p_screen_key text';
  IF v_hash IS DISTINCT FROM '75f66cc57a01e707bf0140140ce10367' THEN
    RAISE EXCEPTION 'reconciliação: correct_financial_transaction_audited mudou durante o registro. Rollback.';
  END IF;

  SELECT count(*) INTO v_count FROM public._dev_schema_migrations;
  IF v_count IS DISTINCT FROM 91 THEN
    RAISE EXCEPTION 'reconciliação: controle ficou com % linhas, esperado 91. Rollback.', v_count;
  END IF;
END
$recon_post$;

COMMIT;

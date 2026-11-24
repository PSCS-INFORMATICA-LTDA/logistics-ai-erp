-- Reconciliação do controle de migrations do DEV.
-- Projeto autorizado: jmbajdpkvlrslirwzyze.
-- Não executar sem autorização explícita desta reconciliação.
-- Não roda o corpo de nenhuma migration. Só insere nomes já conferidos.
-- Não apaga 021_seed_demo_freight_os.sql nem 060_import_driver_confirmed.sql.
-- Não usar em produção (tqeenmswotxqainkyyct).

BEGIN;

LOCK TABLE public._dev_schema_migrations IN SHARE ROW EXCLUSIVE MODE;

DO $recon_pre$
DECLARE
  v_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'reconciliação: sessão % não é postgres. Interromper.', current_user;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations
    WHERE filename = '021_seed_demo_freight_os.sql'
  ) OR NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations
    WHERE filename = '060_import_driver_confirmed.sql'
  ) THEN
    RAISE EXCEPTION 'reconciliação: histórico 021 ou 060 ausente. Interromper sem apagar nada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public._dev_schema_migrations
    WHERE filename IN (
      '078_pscs_one_user_id.sql',
      '079_close_company_members_self_join.sql',
      '083_public_driver_assignment_schedule.sql',
      '084_service_order_security_guards.sql',
      '085_driver_reassignment_and_public_amounts.sql',
      '086_rbac_financial_and_ownership_view.sql',
      '087_driver_payment_and_finance_rpc_guards.sql',
      '088_financial_approval_status_guard.sql',
      '089_financial_insert_delete_guard.sql',
      '090_financial_approved_field_guard.sql',
      '091_pre_pilot_security.sql'
    )
  ) THEN
    RAISE EXCEPTION 'reconciliação: algum nome 078-091 já está no controle. Interromper.';
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

  IF md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'company_has_no_members'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> '34ec32e408fd9e31e9f6b8785bba2645' THEN
    RAISE EXCEPTION 'reconciliação: corpo da 079 divergiu. Interromper.';
  END IF;

  IF (
    SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN (
      'trg_service_orders_guard_direct_confirmation',
      'trg_financial_transactions_approval_status',
      'trg_financial_transactions_approval_insert',
      'trg_financial_transactions_direct_delete',
      'trg_financial_correction_events_immutable',
      'trg_financial_correction_events_no_truncate',
      'trg_financial_transactions_approved_fields'
    )
  ) <> 7 THEN
    RAISE EXCEPTION 'reconciliação: trigger de 084 ou 088-090 ausente. Interromper.';
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

  IF md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'get_public_driver_assignment'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> '0b78825b926734ff061cfc9e8324e27f'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'guard_financial_transaction_approval_status'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> 'dc0c567dcb3da1bec64c4c866e2a1d19'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = '_ap_post_competence'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> '47047e0b09040da34462a84c1fcdf5c5'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'correct_financial_transaction_audited'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> '75f66cc57a01e707bf0140140ce10367'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'seed_chart_of_accounts'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> 'a67a1d08d8124f4ab09ee9ce031ebf3c'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'seed_demo_freight_os'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> 'ddc2a45d832812526a5aba9ddf5eaa29'
  THEN
    RAISE EXCEPTION 'reconciliação: corpo instalado divergiu do arquivo canônico. Interromper.';
  END IF;

  SELECT count(*) INTO v_count FROM public._dev_schema_migrations;
  IF v_count <> 80 THEN
    RAISE EXCEPTION 'reconciliação: controle tem % linhas, esperado 80 antes do registro. Interromper.', v_count;
  END IF;
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
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public._dev_schema_migrations
  WHERE filename IN (
    '078_pscs_one_user_id.sql',
    '079_close_company_members_self_join.sql',
    '083_public_driver_assignment_schedule.sql',
    '084_service_order_security_guards.sql',
    '085_driver_reassignment_and_public_amounts.sql',
    '086_rbac_financial_and_ownership_view.sql',
    '087_driver_payment_and_finance_rpc_guards.sql',
    '088_financial_approval_status_guard.sql',
    '089_financial_insert_delete_guard.sql',
    '090_financial_approved_field_guard.sql',
    '091_pre_pilot_security.sql'
  );
  IF v_count <> 11 THEN
    RAISE EXCEPTION 'reconciliação: pós-validação achou % nomes, esperado 11. Rollback.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations WHERE filename = '021_seed_demo_freight_os.sql'
  ) OR NOT EXISTS (
    SELECT 1 FROM public._dev_schema_migrations WHERE filename = '060_import_driver_confirmed.sql'
  ) THEN
    RAISE EXCEPTION 'reconciliação: 021 ou 060 sumiu. Rollback.';
  END IF;

  IF md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'seed_chart_of_accounts'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> 'a67a1d08d8124f4ab09ee9ce031ebf3c'
     OR md5(replace((
        SELECT prosrc FROM pg_proc
        WHERE proname = 'correct_financial_transaction_audited'
          AND pronamespace = 'public'::regnamespace
      ), E'\r', '')) <> '75f66cc57a01e707bf0140140ce10367'
  THEN
    RAISE EXCEPTION 'reconciliação: corpo de função mudou durante o registro. Rollback.';
  END IF;

  SELECT count(*) INTO v_count FROM public._dev_schema_migrations;
  IF v_count <> 91 THEN
    RAISE EXCEPTION 'reconciliação: controle ficou com % linhas, esperado 91. Rollback.', v_count;
  END IF;
END
$recon_post$;

COMMIT;

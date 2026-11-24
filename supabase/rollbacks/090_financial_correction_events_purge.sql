-- Remoção definitiva do histórico de correções da 090.
-- Não faz parte do rollback operacional.
-- Não aplicar junto com supabase/rollbacks/090_financial_approved_field_guard.sql.
-- Só com autorização explícita que peça o apagamento desses registros.
-- Não aplicar em PROD.
-- Apaga a trilha. Essa operação não se desfaz.

drop trigger if exists trg_financial_correction_events_immutable
  on public.financial_correction_events;
drop trigger if exists trg_financial_correction_events_no_truncate
  on public.financial_correction_events;

drop function if exists public.guard_financial_correction_events_immutable();
drop function if exists public.guard_financial_correction_events_no_truncate();

drop table if exists public.financial_correction_events;

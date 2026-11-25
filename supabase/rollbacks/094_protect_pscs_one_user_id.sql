-- NÃO EXECUTAR.
-- Este arquivo não desfaz a 094. O rollback pós-commit, com o ledger,
-- está em supabase/rollbacks/094_after_commit.sql.

do $$
begin
  raise exception 'use_094_after_commit_rollback';
end $$;

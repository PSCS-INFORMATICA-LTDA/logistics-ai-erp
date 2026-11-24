# Pacote residual 093 — preparado, não aplicado

Não executar no DEV `jmbajdpkvlrslirwzyze` sem autorização explícita que nomeie o projeto e a operação. Não usar em produção. Não reaplicar a 092. O runner sem filtro, se apontar para esta branch, veria este arquivo como pendente. Não rodá-lo.

## O que a migration faz

Fixa `search_path = public` em nove funções `SECURITY INVOKER`:

- `set_updated_at()`
- `normalize_driver_name()`
- `sync_transaction_classification()`
- `ensure_single_default_branch()`
- `check_ownership_percentage()`
- `sync_traffic_infraction_plate()`
- `trg_deletion_audit_events_immutable()`
- `compliance_documents_set_root()`
- `service_order_driver_confirmed(uuid, text)`

Revoga `EXECUTE` de `PUBLIC`, `anon` e `authenticated` em:

- `_ap_assert_company_member(uuid)`
- `_ap_post_competence(uuid)`
- `_assert_service_order_member(uuid)`

Hoje `PUBLIC` e `anon` já não executam esses três. `authenticated` e `service_role` executam. O frontend não chama os três. Quem chama são RPCs `SECURITY DEFINER` cujo dono é `postgres`: aprovação de título, postagem e conclusão de OS. O dono continua podendo chamá-los depois da revogação. `service_role` não perde o `EXECUTE` neste pacote.

## Testes locais

`node --test scripts/test-residual-security-093.mjs`

Positivo: as nove ficam com `search_path=public`. Uma função `SECURITY DEFINER` do dono ainda chama o helper.

Negativo: o papel de aplicação recebe recusa ao chamar o helper direto. Anônimo e `PUBLIC` não ganham `EXECUTE` no rollback. A migration não cita `financial_correction_events` nem `seed_chart_of_accounts`.

## service_role no ledger

Leitura de 24/11/2026, sem alteração:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `_dev_schema_migrations` | sim | sim | sim | sim |
| `financial_transactions` | sim | sim | sim | sim |
| `accounts_payable` | sim | sim | sim | sim |
| `accounts_payable_postings` | sim | sim | sim | sim |
| `service_orders` | sim | sim | sim | sim |
| `deletion_audit_events` | sim | sim | sim | sim |
| `financial_correction_events` | não | não | não | não |

A 093 não abre a trilha de correção para `service_role`. Se uma rotina de serviço precisar lê-la, a autorização futura é só `SELECT`.

## Senha vazada

O advisor do DEV reporta a proteção desligada. A documentação atual diz que ela existe no plano Pro ou superior e consulta a API Have I Been Pwned. Não há tarifa separada descrita. Não é migration.

Impacto, se for habilitada depois: cadastro e troca de senha rejeitam senha já vazada. Sessões atuais continuam. Usuário existente entra com a senha atual até trocá-la. A habilitação é no painel Auth do DEV, com autorização própria. [Documentação](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Rollback

`supabase/rollbacks/093_residual_search_path_and_helpers.sql` remove o `search_path` fixo e devolve `EXECUTE` só a `authenticated`.

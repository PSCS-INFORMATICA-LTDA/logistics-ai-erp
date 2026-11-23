# Matriz de privilégios — migration 091

Leitura de 23/11/2026, 19h10 no horário de Brasília, no Supabase DEV. A coluna "depois" é o estado que a migration 091 deixa. Não foi aplicada.

`has_function_privilege` considera o GRANT de `PUBLIC`. Por isso a migration revoga `PUBLIC`, não só `anon`.

## Funções

| Função | Antes anon / authenticated / service_role | Depois anon / authenticated / service_role | Motivo |
| --- | --- | --- | --- |
| `get_public_proposal(text)` | sim / sim / sim | sim / sim / sim | Página pública |
| `get_public_driver_assignment(text)` | sim / sim / sim | sim / sim / sim | Página pública |
| `get_public_patio_ticket(text)` | sim / sim / sim | sim / sim / sim | Página pública |
| `respond_to_proposal(text, text)` | sim / sim / sim | sim / sim / sim | Página pública |
| `respond_to_driver_assignment(text, text)` | sim / sim / sim | sim / sim / sim | Página pública |
| `auth_user_company_ids()` | sim / sim / sim | não / sim / sim | Policy de RLS do usuário logado |
| `auth_user_has_company(uuid)` | sim / sim / sim | não / sim / sim | Policy de RLS do usuário logado |
| `auth_user_is_company_admin(uuid)` | sim / sim / sim | não / sim / sim | Policy de RLS do usuário logado |
| `next_company_document_number(uuid, text, text, integer)` | sim / sim / sim | não / sim / sim | Tela autenticada; o corpo já exige a empresa |
| `restore_deleted_from_audit(uuid, text)` | sim / sim / sim | não / sim / sim | Tela autenticada; o corpo já exige sessão |
| `restore_soft_deleted_from_audit(uuid, text)` | sim / sim / sim | não / sim / sim | Encaminha para a função acima |
| `ensure_patio_ticket_token(text, uuid)` | sim / sim / sim | não / sim / sim | Tela autenticada; o corpo já exige a empresa |
| `seed_chart_of_accounts(uuid)` | sim / sim / sim | não / sim / não | Membro da empresa antes de gravar |
| `seed_freight_rate_defaults(uuid)` | sim / sim / sim | não / sim / não | Tela de frete, só a própria empresa |
| `seed_demo_freight_os(uuid)` | sim / sim / sim | não / não / não | Fora da aplicação até haver autorização |
| `handle_new_user()` | sim / sim / sim | não / não / não | Trigger de cadastro. `supabase_auth_admin` mantém EXECUTE |
| `_ap_assert_row_company_consistency()` | sim / sim / sim | não / não / não | Trigger. O dono continua executando |
| `_ap_assert_allocation_company_consistency()` | sim / sim / sim | não / não / não | Trigger. O dono continua executando |
| `_ap_can_approve(uuid)` | sim / sim / sim | não / não / não | Só as RPCs internas, como dono |
| `_ap_user_display_name()` | sim / sim / sim | não / não / não | Só as RPCs internas, como dono |
| `_ap_validate_ready_for_approval(uuid)` | sim / sim / sim | não / não / não | Lia título de qualquer empresa |

Aprovação, estorno, pátio (`post_parking_revenue`, `post_car_wash_revenue`) e exclusão auditada não entram no `REVOKE`.

## Tabela `public._dev_schema_migrations`

| Papel | Antes | Depois |
| --- | --- | --- |
| anon | sem GRANT | sem GRANT |
| authenticated | select, insert, update, delete, truncate | sem GRANT, e RLS sem policy |
| service_role | todos os privilégios, com `bypassrls` | igual. Residual aceito: o runner não usa esse papel |
| postgres | dono, `bypassrls` | dono. O runner continua inserindo o arquivo |

## O que a 091 não faz

Não cria os 81 índices. Não fixa o `search_path` das nove funções `SECURITY INVOKER`. Não altera produção.

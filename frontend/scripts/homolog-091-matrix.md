# Homologação autenticada da 091

Não executar este roteiro sem autorização explícita no Supabase DEV `jmbajdpkvlrslirwzyze`. Não usar em produção. Não rodar o rollback neste roteiro.

Usuários já existentes no DEV, cada um só na própria empresa. Não registrar senha nem token neste arquivo.

- Empresa A: `92c4c90d-6856-4c41-a9a1-9eba6a7468f6`. Financeiro `dev.ap.a.fin@pscs.local`. Administrador `dev.ap.a.admin@pscs.local`.
- Empresa B: `bcd3c6c9-0e4a-4356-addd-4af925725576`. Usar um membro já cadastrado em B.

As chamadas autenticadas usam o JWT do usuário. Anon usa a chave anônima, sem sessão.

## 1. Privilégios, sem gravar negócio

Como `postgres`, no SQL Editor, somente leitura:

- `has_function_privilege('anon', 'public.seed_chart_of_accounts(uuid)', 'execute')` = false.
- O mesmo para `seed_freight_rate_defaults` e `seed_demo_freight_os`, também para `authenticated` na demo.
- `has_function_privilege('authenticated', 'public.seed_freight_rate_defaults(uuid)', 'execute')` = true.
- `has_function_privilege('anon', 'public.get_public_proposal(text)', 'execute')` = true. Repetir para `get_public_driver_assignment`, `get_public_patio_ticket`, `respond_to_proposal` e `respond_to_driver_assignment`.
- `has_function_privilege('authenticated', 'public.auth_user_has_company(uuid)', 'execute')` = true.
- `has_function_privilege('anon', 'public.auth_user_has_company(uuid)', 'execute')` = false.
- `has_function_privilege('authenticated', 'public._ap_can_approve(uuid)', 'execute')` = false.
- `has_function_privilege('authenticated', 'public.approve_accounts_payable(uuid, text)', 'execute')` = true.
- `has_function_privilege('authenticated', 'public.reverse_accounts_payable_postings(uuid, text)', 'execute')` = true.
- `has_table_privilege('authenticated', 'public._dev_schema_migrations', 'insert')` = false.
- `relrowsecurity` de `_dev_schema_migrations` = true.
- `has_table_privilege('postgres', 'public._dev_schema_migrations', 'insert')` = true.

## 2. Páginas públicas e helper interno

Anon, token com menos de 32 caracteres:

- `get_public_proposal`, `get_public_driver_assignment` e `get_public_patio_ticket` devolvem `found: false`.
- `respond_to_proposal` e `respond_to_driver_assignment` com esse token recusam. Não enviar token real de OS.

Financeiro da empresa A, autenticado:

- `auth_user_has_company` da empresa A devolve true.
- `auth_user_has_company` da empresa B devolve false.
- `auth_user_is_company_admin` da empresa A devolve false.
- `next_company_document_number` da empresa B recusa com sem acesso. Não chamar para a empresa A: isso consumiria um número.
- Chamada direta a `_ap_can_approve` e `_ap_validate_ready_for_approval` recusa por falta de privilégio.
- Abrir uma ordem de serviço e a tela de aprovação continua carregando. O estorno não é executado neste roteiro; a função de estorno segue concedida a `authenticated` e o corpo continua chamando `_ap_can_approve` como dono.

## 3. Tarifas

Contar antes, como o usuário autenticado.

Financeiro da A chama `seed_freight_rate_defaults` da empresa A. A chamada conclui. A quantidade de tarifas da A não diminui. Se a A ainda não tinha tarifa, passam a existir as cinco padrões. Uma segunda chamada não duplica.

O mesmo financeiro chama a função para a empresa B. A resposta é sem permissão. A contagem da B, lida por um membro da B ou por `postgres`, não muda.

Administrador da A repete a chamada da própria empresa. Também conclui, sem duplicar.

Anon chama a função da empresa A. A resposta é permission denied. A contagem não muda.

## 4. Plano de contas

Financeiro da A chama `seed_chart_of_accounts` da empresa A. A função devolve zero se o plano já existe, ou o número de contas novas se ainda não existia. Nenhuma conta de outro nome é apagada.

O mesmo financeiro chama a função para a empresa B. Sem permissão. A contagem da B não muda.

Usuário autenticado que não é membro de nenhuma das duas chama as duas funções para A e para B. Sem permissão nas duas. Nenhuma contagem muda.

## 5. Runner

Como `postgres`, numa transação que termina em `rollback`:

```sql
begin;
insert into public._dev_schema_migrations (filename)
values ('homolog-091-probe.sql');
select filename from public._dev_schema_migrations
where filename = 'homolog-091-probe.sql';
rollback;
```

O select dentro da transação devolve a linha. Depois do rollback, a linha não existe.

Com o JWT do financeiro, insert na mesma tabela recusa por falta de privilégio. A tabela continua sem a linha de prova.

Não apagar filenames já aplicados.

## 6. Fora deste roteiro

Não executar `supabase/rollbacks/091_pre_pilot_security.sql`. Ele reabre `EXECUTE` de anon e PUBLIC e remove a checagem de membro. Só com aprovação específica, separada da aplicação da 091.

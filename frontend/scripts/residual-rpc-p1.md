# Débitos P1 das RPCs residuais

Documento de preparação. Não cria migration, não altera GRANT e não executa no DEV.

As duas funções continuam `SECURITY DEFINER` com `EXECUTE` para `authenticated`. A 093 não as inclui. Uma correção futura precisa de autorização própria, com teste local e rollback.

## company_has_no_members

Impacto: qualquer usuário autenticado pode perguntar se uma empresa ainda não tem membros. A função ignora RLS. Isso revela o momento em que a empresa está vazia e, junto com a policy `company_members_insert`, é o que permite o primeiro admin se cadastrar.

Dependências:

- Policy `company_members_insert` em `079_close_company_members_self_join.sql`.
- O bootstrap de `/setup` insere o próprio usuário como admin somente enquanto a função devolve verdadeiro.
- Convite e SSO usam service role e não dependem dessa chamada direta.

Proposta futura: manter a função para a policy, revogar `EXECUTE` de `authenticated` e `PUBLIC`, e deixar a policy chamá-la como hoje. O teste de regressão precisa provar que o primeiro admin ainda entra e que um segundo usuário não consulta a função pela API. Sem esse teste, a revogação pode travar o setup.

## next_company_document_number

Impacto: qualquer membro da empresa incrementa `company_document_sequences`. O papel financeiro não é exigido. `accounts-payable-api.ts` chama a função antes de inserir o título. Se o insert falha, o número já foi consumido.

Dependências:

- Tabela `company_document_sequences`, migration 065.
- `auth_user_has_company` limita a empresa, não o papel.
- Seeds e a tela de contas a pagar usam o prefixo `AP`.
- A migration 091 já tirou `anon` e manteve `authenticated`.

Proposta futura: reservar o número dentro da mesma transação que grava o título, ou devolver a sequência quando o insert não conclui. Separar o GRANT do papel financeiro só depois de a tela operacional deixar de pedir número. A correção não pode avançar o contador num teste de leitura.

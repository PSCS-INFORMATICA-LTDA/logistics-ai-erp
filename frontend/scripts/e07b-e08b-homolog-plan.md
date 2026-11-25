# Plano de homologação real E07B e E08B

Este plano não executa escrita. A flag `PSCS_ONE_CLOSE_WITH_AR` permanece desligada. A empresa B do Core permanece ACTIVE. O ledger do Logistics permanece 93/93. A conciliação aprovada permanece R$ 70,00 na OS e R$ 78,00 com o pátio.

## Pré-condições

- Empresa A do Logistics `92c4c90d-6856-4c41-a9a1-9eba6a7468f6` mapeada no Core para `c0910000-0000-4000-8000-0000000000a1`, com party do cliente da OS.
- Entitlement e membership aplicados só depois de autorização, pelos scripts ainda não executados.
- O usuário da prova é admin no Logistics e `company_admin` no Core da empresa A. `profiles.pscs_one_user_id` é o `app_users.id` desse usuário.
- Financeiro e operacional entram só na negativa.
- A OS descartável nasce com frete 100,00. Pedágio 10,00 e motorista 20,00 já aprovados. O pátio de 8,00 fica fora da OS.

## Passos

1. Ligar a flag só no processo autorizado de homologação. Sem a flag, o fechamento operacional conclui a OS e não cria recebível.
2. Admin fecha a OS. O Core cria um recebível de 100,00. A OS fica concluída.
3. Duas baixas simultâneas de 40,00 com a mesma chave. Uma grava e a outra devolve a mesma baixa. O saldo fica 60,00. O pagamento original não é alterado.
4. Estorno de 40,00. O saldo volta a 100,00. A mesma chave com o mesmo motivo não cria outro estorno. A mesma chave com outro motivo conflita e o saldo permanece 100,00.
5. Repetir a baixa com sessão da empresa B. Nada muda na empresa A.
6. Conferir o DRE aprovado: 70,00 sem o pátio e 78,00 com o pátio. O recebível do Core não grava `financial_transactions`.

## Concorrência

A baixa trava o recebível antes de inserir o pagamento. O estorno trava o recebível e depois o pagamento, na mesma ordem. Duas sessões não podem reduzir o saldo duas vezes com a mesma chave. Chaves diferentes que juntas passam do saldo: a segunda recebe `AMOUNT_EXCEEDS_BALANCE` e a primeira permanece.

## Falha entre o recebível e a conclusão da OS

Se o Core grava o recebível e o `complete_service_order` falha, a resposta é `LOCAL_CLOSE_FAILED`. A OS continua aberta. A nova tentativa procura o recebível pela origem `logistics_ai` / `service_order` / id da OS e não cria outro. Só então conclui a OS. O DRE não muda nessa falha, porque o recebível não lança despesa nem receita no Logistics.

## Recuperação de senha

O endereço da prova é `philippe.dev@pscsinformatica.com.br`. O envio continua bloqueado até autorização. Endereços `.local` e `.test` não entram.

## Backlog

A autorização operacional de concluir a OS e a autorização financeira de baixar ou estornar o recebível usam hoje o mesmo gate `arWrite`. A separação fica para uma mudança futura: o operacional poderá concluir a OS, e só o financeiro ou o admin poderá baixar e estornar. Esta homologação não separa os dois.

A policy `profiles_update_own` e a migration 078 continuam sem trava de coluna. A correção preparada e não aplicada está em `supabase/pending/094_protect_pscs_one_user_id.sql`: tira o UPDATE da tabela de anon, authenticated e PUBLIC, devolve UPDATE só de `full_name` e `email`, e o gatilho `trg_profiles_pscs_one_user_id_guard` aceita mudança de `pscs_one_user_id` apenas para service_role, postgres e supabase_admin.

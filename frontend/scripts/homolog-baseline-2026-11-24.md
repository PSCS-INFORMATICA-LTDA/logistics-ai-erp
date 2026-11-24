# Baseline congelada — 24/11/2026

Ambiente: Supabase DEV `jmbajdpkvlrslirwzyze`. Não é produção. Não reaplicar a 092. Não executar o runner com escrita a partir deste documento.

## Commits e PRs

| Peça | Referência | Papel na baseline |
| --- | --- | --- |
| Candidata integrada | PR #36, commit `8fdcb82` | App e migrations até a 091 |
| RBAC do plano | PR #37, commit `5942fb3` | Arquivo da 092, sem aplicação neste commit |
| Homologação da 092 | PR #39, commit `2618dc4` | Roteiro `qa:homolog-092` e registro de que a 092 já está no DEV |
| CI da PR #39 | 2/2 em 24/11/2026 14:36 (America/Sao_Paulo) | Não repetir |

O preview de `logistics-release-main` não faz parte desta baseline.

## Ledger

92 registros e 92 nomes distintos. A linha `092_chart_seed_finance_guard.sql` foi aplicada em 24/11/2026 14:01 (America/Sao_Paulo). Não há arquivo `093` nesta baseline. Os arquivos da candidata já estão no controle. `021_seed_demo_freight_os.sql` e `060_import_driver_confirmed.sql` permanecem no ledger e fora da pasta da branch.

Preservados na conferência:

- OS `QA-OS-ND-001` (`06017813-bde8-4802-afda-8936ad81f042`), `updated_at` `2026-11-23 13:15:59` (America/Sao_Paulo).
- 11 eventos `deletion_audit_events.screen_key = homolog.089`.
- 1 evento `dashboard.demo`.

## Empresas descartáveis

`HOM-092-ADMIN` e `HOM-092-FIN` continuam no DEV. Não foram excluídas.

| Empresa | Status | Membros | Contas | Tarifas | Lançamentos | OS | Títulos | Clientes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HOM-092-ADMIN | Ativo | 0 | 81 | 5 | 0 | 0 | 0 | 0 |
| HOM-092-FIN | Ativo | 0 | 81 | 0 | 0 | 0 | 0 | 0 |

Elas não entram nos indicadores. A policy `companies_select_member` só devolve empresa de quem é membro. O dashboard e a exportação filtram `financial_transactions.company_id` da empresa da sessão e só somam `approved`. Sem membro, sem lançamento e sem OS, não há superfície operacional que as conte. As empresas A (`92c4c90d-6856-4c41-a9a1-9eba6a7468f6`) e B (`bcd3c6c9-0e4a-4356-addd-4af925725576`) seguiram com 81 contas e 5 tarifas.

## Numeração

A matriz abaixo segue a ordem numérica T01–T40 usada no fechamento. O runner `homolog-c36-api.mjs` gravou alguns casos fora dessa ordem: T14 antes de T08, T22 antes de T21, e T11, T27–T29 e T31–T33 fora desse arquivo. A descrição de cada linha é a asserção que foi aprovada, não um roteiro novo.

| Caso | Descrição aprovada | Onde foi fechado |
| --- | --- | --- |
| T01 | Administrador vê a empresa A e não vê a B | API e releitura 092 |
| T02 | Financeiro autentica | API |
| T03 | Operacional autentica | API |
| T04 | Financeiro não cria lançamento já `approved` | API |
| T05 | Lançamento do financeiro nasce `submitted` | API |
| T06 | Conta de outra empresa é recusada | API |
| T07 | Administrador aprova | API |
| T08 | Financeiro não muda status de aprovação | API |
| T09 | Exclusão direta do lançamento é recusada | API |
| T10 | Financeiro não exclui pela RPC auditada | API |
| T11 | Ledger reconciliado, sem reaplicar as onze migrations | Leitura do controle; agora 92 nomes |
| T12 | Motivo de exclusão com menos de 8 caracteres é recusado | API |
| T13 | Operacional não corrige nem exclui lançamento | API |
| T14 | Aprovar não gera evento de correção | API |
| T15 | Financeiro não altera valor de lançamento aprovado | API |
| T16 | Administrador corrige 10,00 para 13,50 | API |
| T17 | O evento guarda o valor anterior e o novo | API |
| T18 | Financeiro não corrige lançamento aprovado | API |
| T19 | Administrador da A não corrige lançamento da B | API |
| T20 | Financeiro não lê a trilha; alteração direta não grava | API |
| T21 | Estorno do título `AP-00000025`: valor 15,00, lançamento `cancelled`, postagem estornada, sem correção, título cancelado e excluído logicamente | Releitura com JWT de administrador |
| T22 | Duas correções encadeiam 10 → 13,50 → 31 → 32 | Releitura por `occurred_at` |
| T23 | Token curto de proposta não encontra; token válido encontra | API |
| T24 | Aceite, recusa, reuso e ação inválida. A proposta precisa ser enviada antes da resposta | API pública, depois da preparação |
| T25 | Designação antes do aceite falha; depois do aceite funciona e não reaproveita o token | API pública |
| T26 | Ticket curto falha; ticket do pátio `HOM-C36-PATIO` encontra | API pública |
| T27 | Parâmetros de frete mostram TF001–TF005 | Interface da PR #36 |
| T28 | Fila de aprovação do lançamento de homologação | Interface da PR #36 |
| T29 | Correção visual para 22,11, com revisão e registro | Interface; valor relido |
| T30 | Empresa B não vê OS da A e não semeia tarifa da A | API |
| T31 | Lista de OS mostra `QA-OS-ND-001` | Interface da PR #36 e sessão operacional desta baseline |
| T32 | Dashboard abre para o administrador | Interface da PR #36 |
| T33 | Histórico de exclusão preserva a fila | Interface; 3 eventos relidos |
| T34 | Administrador semeia 81 contas na própria empresa descartável e não duplica a empresa A | Sessão real |
| T35 | Financeiro semeia 81 contas na própria empresa descartável | Sessão real |
| T36 | Operacional recebe 42501 e não insere conta | Sessão real |
| T37 | Anônimo recebe 42501, sem `EXECUTE` | Chave anônima |
| T38 | Administrador de outra empresa recebe 42501 | Sessão real |
| T39 | Segunda execução devolve 0 | Sessão real |
| T40 | Operacional semeia 5 tarifas e não altera as 5 da empresa A | Sessão real |

Resultado consolidado: 40/40. T02–T20, T23, T27, T28, T30 e T32 permanecem na rodada da PR #36. A 092 não altera essas funções. T21, T22, T24–T26, T29, T33 e T34–T40 foram confirmados depois da aplicação.

## Falsos negativos corrigidos

O roteiro `frontend/scripts/homolog-092-rbac.mjs` não repete as três leituras que marcavam falha sem defeito funcional:

- T21 não seleciona `deleted_at` em `financial_transactions`. Essa coluna existe no título.
- T22 ordena `financial_correction_events` por `occurred_at` e usa o JWT do administrador. `service_role` não tem `SELECT` nessa tabela.
- T24–T26 exigem proposta enviada antes da resposta pública.

## Evidências versionadas

Sem token, senha ou chave.

- `homolog-baseline/h092-operacional-ordens.png` — sessão operacional, OS `QA-OS-ND-001`.
- `homolog-baseline/h092-operacional-calculadora.png` — calculadora de rota, formulário não salvo.
- `homolog-baseline/c36-t29-corrigido.png` — correção T29.
- `homolog-baseline/c36-t33-historico.png` — histórico T33.

O arquivo de roteiro é `frontend/scripts/homolog-092-rbac.mjs`.

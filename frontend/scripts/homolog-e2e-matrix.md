# Matriz integrada E01–E12

Diagnóstico de leitura em 24/11/2026. A preparação abaixo não autoriza escrita, migration nem execução. A execução com dados novos depende de autorização do PO no DEV `jmbajdpkvlrslirwzyze`.

Os identificadores principais continuam E01–E12. E07 e E08 se dividem para a cadeia poder andar sem o Core. Classificação: READY quando o processo já cabe numa execução descartável; PARTIAL quando os módulos existem e a cadeia ainda não foi percorrida junta; BLOCKED quando a parte não entra nesta execução. Os antigos rótulos existe, ajuste e ausente ficam substituídos por esses três.

Empresas de apoio já existentes: A `92c4c90d-6856-4c41-a9a1-9eba6a7468f6` e B `bcd3c6c9-0e4a-4356-addd-4af925725576`. Não usar `HOM-092-ADMIN` nem `HOM-092-FIN` como empresa operacional. Não apagar `QA-OS-ND-001` nem eventos `homolog.089`.

| Cenário | Classe | Módulos | Pré-requisitos | Dados de teste | Resultado esperado | Lacuna | Evidência necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 Cadastro de cliente e parâmetros comerciais | READY | Clientes, parâmetros de frete, pátio | Admin ou operacional da empresa A | Cliente descartável com documento único; tarifas TF001–TF005 já presentes | Cliente visível só na A. Tarifa não duplica | Falta um roteiro único que grave o cliente e leia a tarifa na mesma OS | Cadastro, lista da outra empresa vazia, contagem de tarifas igual a 5 |
| E02 Cotação, proposta e aceite | READY | Proposta pública | OS em rascunho da A | Token novo; ação aceite, reuso e ação inválida | Aceite único. Reuso recusado. Token curto não encontra | O runner antigo respondia antes de enviar a proposta. O roteiro novo exige `mark_proposal_sent` antes | Estado `proposal_response`, segunda chamada e token inválido |
| E03 Criação da OS | READY | Operacional, código sequencial | Sessão operacional válida | OS descartável, sem salvar por cima de `QA-OS-ND-001` | OS da A com cliente do E01 e natureza Frete ou Transporte | O formulário novo da baseline foi aberto e não salvo | Código gerado, empresa A, `updated_at` da OS histórica intacto |
| E04 Designação, aceite e substituição | READY | Designação pública, reassign | Proposta aceita | Motorista da A, depois outro motorista da A | Primeiro aceite único. Substituição limpa o aceite anterior e exige novo aceite | Não há um caso único que percorra aceite e substituição em sequência | Tokens, `driver_assignment_response`, motorista final |
| E05 Execução do transporte e pátio | PARTIAL | OS, estacionamento, lava-rápido | OS designada e parâmetro de pátio | Uma OS de transporte e um ticket de pátio descartável | Conclusão da OS só com motorista confirmado. Ticket público encontra o lançamento do pátio | Os dois módulos foram homologados separados, não na mesma viagem | Status da OS, ticket, receita de pátio `approved` |
| E06 Receitas, despesas e custos da OS | PARTIAL | DRE empresa, despesa de veículo, motorista, rateio | OS com valor e placa | Receita da OS, pedágio e pagamento de motorista na mesma OS | Sem duplicar data + OS + conta. Rateio usa o percentual vigente | O custo completo da mesma OS ainda não foi conferido numa só evidência | Três lançamentos, bloqueio da duplicata e linha de rateio |
| E07 Contas a pagar e receber | Dividido | E07A no Postgres. E07B no Core | Ver as partes | Ver as partes | E07A fecha sem E07B | O identificador E07 permanece. A execução não espera o recebível | Evidência de E07A. E07B fica de fora |
| E07A Contas a pagar | READY | Contas a pagar no Postgres | Admin e financeiro da empresa A | Título novo de 15,00, sem reusar `AP-00000025` | Título nasce pela RPC, só na empresa A | Nenhuma para esta parte | Número do título e ausência na empresa B |
| E07B Contas a receber | BLOCKED | Core `PSCS-INFORMATICA-LTDA/pscs-core` | Vínculo ativo da empresa A e rota de fechamento ligada ao Core | Não criar recebível nesta execução | Recebível da OS no Core, com a mesma referência | A empresa A não tem vínculo ativo no seed do Core. O fechamento operacional da OS não cria recebível | Fora desta execução |
| E08 Aprovação, pagamento, recebimento e estorno | Dividido | E08A no Postgres. E08B no Core | Ver as partes | Ver as partes | E08A fecha sem E08B | O identificador E08 permanece | Evidência de E08A. E08B fica de fora |
| E08A Aprovação, pagamento e estorno | READY | Aprovação, pagamento e estorno de título | Admin e financeiro | O título de 15,00 do E07A | Financeiro não aprova nem estorna. Admin aprova, paga e estorna. O valor original permanece 15,00 | Nenhuma para esta parte | Status, valor, `reversed_at` e nenhum evento novo de correção |
| E08B Recebimento e estorno do recebimento | BLOCKED | Core, pagamento de recebível | E07B concluído | Não lançar recebimento nesta execução | Pagamento idempotente e estorno do recebimento | O Core publica a baixa e não publica o estorno. O Logistics não chama a baixa | Fora desta execução |
| E09 DRE e indicadores | READY | DRE e dashboard | Lançamentos `approved` da A | Período que contenha os lançamentos do E06 | Totais só `approved` e só da empresa da sessão. `HOM-092-*` fora | Falta a captura do dashboard depois da cadeia E01–E08 | Tela do dashboard e soma conferida com as linhas |
| E10 Cancelamento, exclusão, restauração e auditoria | READY | Auditoria de exclusão | Admin | Motivo com 8 caracteres ou mais. Um registro descartável | Exclusão direta bloqueada. Exclusão auditada gera evento. Restauração não apaga o evento | Restauração ainda não foi refeita na cadeia nova | Evento, linha restaurada, `homolog.089` intacto |
| E11 Isolamento durante a cadeia | PARTIAL | RLS e RPCs | Empresa B com admin próprio | Repetir leitura de cliente, OS, lançamento, título e tarifa da A com sessão da B | B não lê nem grava a cadeia da A | Precisa acompanhar a cadeia inteira, não só os pontos T19, T30 e T38 | Uma negativa por módulo da cadeia |
| E12 Login, recuperação e RBAC | READY | Auth, middleware, seeds | Usuários já existentes | Login do operacional, link de recuperação de teste, seed do plano | Operacional cai em Ordens de serviço. Recuperação não deixa o código na URL. Operacional não semeia plano. Financeiro e admin semeiam | Proteção contra senha vazada está disponível e desligada. Não entra nesta execução | URL pós-login, teste de redirect já existente, T34–T37 |

## Execução disponível sem E07B e E08B

A cadeia que pode ser autorizada é E01, E02, E03, E04, E05, E06, E07A, E08A, E09, E10, E11 e E12. E05, E06 e E11 continuam PARTIAL: entram na mesma execução, ainda sem uma evidência única anterior. E07B e E08B não entram e não ganham atalho local.

Contagem desta preparação: 9 READY (E01, E02, E03, E04, E07A, E08A, E09, E10 e E12), 3 PARTIAL (E05, E06 e E11) e 2 BLOCKED (E07B e E08B). E12 cobre login, recuperação e RBAC. A proteção de senha vazada continua decisão separada do PO e não bloqueia a cadeia.

Massa descartável, só depois de autorização no DEV `jmbajdpkvlrslirwzyze`:

- Empresa A `92c4c90d-6856-4c41-a9a1-9eba6a7468f6`. Empresa B `bcd3c6c9-0e4a-4356-addd-4af925725576` só nas negativas.
- Cliente `HOM-E2E Cliente`, documento ainda não usado na A.
- OS nova, valor de serviço 100,00 e frete acordado 100,00. Não alterar `QA-OS-ND-001`.
- Proposta enviada e aceita. Dois motoristas da A: aceite, substituição e novo aceite.
- Pedágio 10,00 e motorista 20,00 na mesma OS. Ticket de pátio 8,00, se o parâmetro da A já existir.
- Título novo de 15,00. Não reusar `AP-00000025`.

## Critérios de aceite da conciliação

O pátio de 8,00 é receita adicional, não despesa. `post_parking_revenue` grava `transaction_type = Receita` na conta `Receita Estacionamento`, com `entry_source = parking` e `approval_status = approved`. `post_car_wash_revenue` faz o mesmo em `Receita Lava Rápido`, com `entry_source = car_wash`. Nenhum dos dois preenche `service_order_id`. O valor não entra no custo da OS de frete.

| Composição | Resultado aprovado |
| --- | --- |
| Sem pátio: receita 100,00, pedágio 10,00, motorista 20,00 | 70,00 |
| Pátio tratado como despesa | Rejeitado. O produto não lança o pátio assim |
| Pátio como receita adicional de 8,00 | 78,00 |

O título de 15,00 não reutiliza `AP-00000025`. O rateio do título fica com `service_order_id` nulo e com conta DRE diferente de Pedágio e da conta do motorista. A competência gera uma despesa própria, `entry_source = accounts_payable`, sem repetir a data, a OS e a conta do pedágio nem do motorista. Enquanto essa despesa está `approved`, o resultado da empresa cai 15,00. O rateio da OS de frete permanece 70,00.

O pagamento do título não cria outro lançamento de DRE. O estorno marca a postagem com `reversed_at` e a transação com `approval_status = cancelled`. DRE, dashboard e rateio somam só `approved`, então o efeito líquido do título volta a zero. O valor original do título permanece 15,00.

Aceite final, depois do estorno:

- OS de frete: receita 100,00, pedágio 10,00, motorista 20,00, resultado 70,00.
- Com o pátio executado: mais 8,00 de receita, resultado 78,00.
- Título fora do aprovado, postagem estornada, valor original 15,00.
- `QA-OS-ND-001` com `updated_at` `2026-11-23 16:15:59.856477+00`.
- 11 eventos `homolog.089` e 1 evento `dashboard.demo`.

Preservação da auditoria, conferida antes e depois, sem apagar linha:

- 11 eventos `screen_key = homolog.089`.
- 1 evento `dashboard.demo`.
- `QA-OS-ND-001` com `updated_at` `2026-11-23 16:15:59.856477+00`.
- Empresas `HOM-092-ADMIN` e `HOM-092-FIN` sem exclusão física.

Nenhuma dessas escritas foi feita nesta etapa. Sem migration, sem runner e sem produção.

# Desenho — quatro entregas do PSCS One Core

Documento de preparação. Não implementa, não altera banco, não cria vínculo e não chama o Core. O DEV do Core é `uvyaqklvqcakwfvfopof`, app `https://pscs-core.vercel.app`, repositório `PSCS-INFORMATICA-LTDA/pscs-core`. O Logistics continua no DEV `jmbajdpkvlrslirwzyze`. Produção dos dois fica fora.

A função `closeServiceOrderWithCoreReceivable` já cria o recebível antes de concluir a OS local e reencontra o recebível quando a OS já está `Concluido`. A rota usada hoje, `/api/service-orders/[id]/close`, não chama essa função. O seed versionado do Core liga a empresa B com status `planned`. A empresa A não está nele. O consumidor só aceita `status = active`.

## 1. Mapeamento ativo da empresa A e Party Master

Uma linha em `product_company_mappings`: `external_system = logistics_ai`, `external_company_id` igual ao id da empresa A `92c4c90d-6856-4c41-a9a1-9eba6a7468f6`, `environment = dev`, `status = active`, `deleted_at` nulo, um único `company_id` do Core. A empresa B permanece no próprio mapeamento. Não promover a B a `active` só para testar a A.

O cliente da OS entra em `party_external_references`: `external_entity_type = client`, `external_entity_id` igual ao `clients.id` da A, `company_id` igual ao Core da A. O `parties.id` precisa pertencer a essa mesma empresa Core. Zero ou mais de uma linha ativa é falha, não escolha silenciosa.

Isolamento: cookie `pscs_one_mapped_company_id` igual à empresa da OS e cookie `pscs_one_core_company_id` igual ao Core resolvido. Divergência responde `tenant_mapping_missing` e não cria party nem recebível.

## 2. Criação idempotente do recebível no fechamento

Ligar a rota de fechamento à função já existente, sem segunda conclusão local. Chave de idempotência: `source_system = logistics_ai`, `source_entity_type = service_order`, `source_entity_id` igual ao id da OS, mais `company_id` do Core. Antes de criar, procurar essa chave. Uma linha reaproveita. Duas linhas param com erro. Valor: frete acordado na OS Frete, valor do serviço na OS Transporte, moeda BRL. `due_at` segue nulo enquanto a OS não tiver vencimento canônico.

Ordem segura: resolver empresa e party, achar ou criar o recebível, só então chamar `complete_service_order`. Se o Core falhar, a OS local permanece aberta. Se o recebível nascer e a conclusão local falhar, a nova tentativa acha o recebível e conclui a OS, sem segundo título. Se a OS já estiver concluída e o recebível não existir, a resposta continua `AR_RECONCILIATION_REQUIRED` e nada é criado.

O recebível não grava lançamento em `financial_transactions` do Logistics. A receita aprovada da OS continua sendo o lançamento local. O Core é o saldo a receber.

## 3. Baixa pelo Logistics AI

O Core já aceita `POST /api/receivables/payments`, escopo `POST_ONLY`. O cliente Logistics ainda não tem esse método. A chamada leva `company_id`, `receivable_id`, `currency_code`, `amount` positivo e a chave de idempotência: `reference_code` ou o trio `source_system`, `source_entity_type`, `source_entity_id`.

Pagamento parcial é permitido enquanto `amount` não passa do saldo. Valor acima do saldo responde `AMOUNT_EXCEEDS_BALANCE` e não grava. A mesma chave com o mesmo valor responde `ALREADY_POSTED`. A mesma chave com outro valor responde `IDEMPOTENCY_CONFLICT`. Recebível cancelado responde `RECEIVABLE_CANCELLED`.

A baixa não altera a OS, o pedágio, o motorista nem o título a pagar. Falha do Core deixa o saldo anterior intacto. A tela só mostra pagamento depois de reler o Core.

## 4. Estorno auditado do recebimento

Não existe no Core. O comando novo estorna um `payment_id` já lançado, com motivo obrigatório, empresa do recebível e ator autenticado. Não apaga a linha. Grava estorno com data, motivo, usuário e valor. O saldo do recebível volta o valor estornado. Estorno repetido da mesma chave devolve o estorno já gravado. Estorno de pagamento de outra empresa responde 403 e não altera saldo.

O Logistics só chama o comando. Não guarda uma cópia contábil do recebimento. Se o Core recusar, a tela mantém o pagamento anterior. Se o Core estornar e a resposta se perder, a releitura mostra o pagamento estornado e o saldo recomposto.

## Conciliação entre os sistemas

Para uma OS Frete de 100,00, o recebível nasce em 100,00. Baixa de 40,00 deixa saldo 60,00. Estorno desses 40,00 devolve saldo 100,00. O resultado aprovado no Logistics permanece 70,00 sem pátio, ou 78,00 com a receita de pátio de 8,00. O título a pagar de 15,00, depois do estorno local, continua fora desse saldo.

Conferência de aceite futuro, quando for autorizado: um recebível por OS, party da mesma empresa Core, saldo igual a original menos baixas não estornadas, e nenhuma linha nova em `financial_transactions` causada pela baixa ou pelo estorno do Core.

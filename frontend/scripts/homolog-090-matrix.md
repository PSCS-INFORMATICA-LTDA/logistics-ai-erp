# Matriz de homologação da 090

Não executar este roteiro sem autorização explícita no Supabase DEV `jmbajdpkvlrslirwzyze`. Não é o script de aplicação. O arquivo de aplicação é `apply-090-sql-editor.sql`. O purge do histórico não entra na aplicação nem no rollback operacional.

Ambiente: somente DEV. Usuários já usados na 089, os dois só na empresa A.

- Empresa A: `92c4c90d-6856-4c41-a9a1-9eba6a7468f6`
- Empresa B: `bcd3c6c9-0e4a-4356-addd-4af925725576`
- Financeiro: `dev.ap.a.fin@pscs.local`
- Administrador: `dev.ap.a.admin@pscs.local`

Cada chamada usa o JWT do usuário. Não imprimir token. Remover os lançamentos temporários pela exclusão auditada da 089. Não apagar os eventos `homolog.089` nem o evento `dashboard.demo` já existentes. Não restaurar `updated_at` da OS `QA-OS-ND-001`.

| Caso | Quem | Ação | Esperado |
| --- | --- | --- | --- |
| Catálogo | postgres, só leitura | Triggers da 088, 089 e `trg_financial_transactions_approved_fields` habilitadas. Padrão `submitted`. | As quatro ativas |
| Financeiro altera valor aprovado | Financeiro | `UPDATE` de `amount` em lançamento `approved` da empresa A | 42501, valor intacto |
| Financeiro corrige | Financeiro | `correct_financial_transaction_audited` | 42501 |
| Motivo curto | Administrador | Mesma função, motivo com menos de 8 caracteres | 22023 |
| Só descrição | Administrador | Patch só de `description` | 200. Tipo e classificação iguais. O evento tem a descrição nova e não traz tipo |
| Conta DRE | Administrador | Patch de `chart_of_account_id` com classificação e tipo diferentes dos da conta | 200. Linha e evento ficam com a classificação e o tipo da conta |
| Motorista de outra empresa | Administrador | `driver_id` da empresa B | 22023, linha intacta |
| Motorista da própria empresa | Administrador | `driver_id` da empresa A | 200. Evento com o antes e o depois |
| Isolamento | Administrador da A | Correção de lançamento da empresa B | 42501 ou RLS, linha de B intacta |
| Aprovação | Administrador | `submitted` para `approved`, só status e revisão | 200. Nenhum evento de correção |
| Rejeição | Administrador | `submitted` para `rejected`, só status e revisão | 200. Nenhum evento de correção |
| Estorno | Administrador | `reverse_accounts_payable_postings` de um título postado de teste | Status `cancelled`, valor igual, sem evento de correção |
| Financeiro muda status | Financeiro | `submitted` para `approved` | 42501, a 088 continua valendo |
| Pátio | Financeiro | `post_parking_revenue` e `post_car_wash_revenue` | INSERT `approved`. A trigger de update não interfere |
| Motorista | Fluxo da OS de teste | `mark_driver_payment_paid` | INSERT `approved` |
| Flag solta | Financeiro | `set_config` e em seguida `UPDATE` do valor | RPC ausente ou sem efeito. O valor continua bloqueado |
| Trilha | Financeiro e administrador | `UPDATE` e `DELETE` em `financial_correction_events` | Sem linha alterada. Financeiro não lê o evento; administrador lê |
| Duas sessões | Dois JWTs de administrador, ao mesmo tempo | Os dois chamam a correção do mesmo lançamento, um com valor 11 e outro com valor 12 | Uma espera a outra. As duas gravam evento. O `old_values.amount` da segunda é o valor persistido pela primeira. O lançamento fica com o valor da segunda |

A concorrência usa duas requisições HTTP paralelas, cada uma com a própria sessão. Não usar o purge. Se a limpeza de um título postado esbarrar na política de `accounts_payable_postings`, registrar o resíduo e não abrir um atalho novo.

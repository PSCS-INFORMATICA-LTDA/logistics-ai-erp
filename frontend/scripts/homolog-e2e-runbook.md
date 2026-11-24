# Cadeia E2E disponível — 12 subcenários

Preparação somente. Não autoriza escrita, migration, merge nem produção. E07B e E08B ficam de fora até o desenho do PSCS One ser autorizado.

Ambiente, quando o PO autorizar: Supabase DEV `jmbajdpkvlrslirwzyze`. Empresa A `92c4c90d-6856-4c41-a9a1-9eba6a7468f6`. Empresa B `bcd3c6c9-0e4a-4356-addd-4af925725576` só nas negativas.

Preservar antes e depois:

- Baseline T01–T40, sem reexecutar a matriz antiga por cima destes dados.
- OS `QA-OS-ND-001` (`06017813-bde8-4802-afda-8936ad81f042`) com `updated_at` `2026-11-23 16:15:59.856477+00`.
- Título `AP-00000025` intocado. O título desta cadeia é novo.
- 11 eventos `homolog.089` e 1 evento `dashboard.demo`.
- `HOM-092-ADMIN` e `HOM-092-FIN` sem membro novo e sem exclusão física.

## Sequência

1. E12 — Login do operacional da A. A URL de recuperação de teste não conserva o código. Operacional não semeia plano. Admin e financeiro semeiam, sem duplicar as contas já existentes.
2. E01 — Cliente `HOM-E2E Cliente`, documento ainda não usado na A. Tarifas TF001–TF005 permanecem 5.
3. E03 — OS nova de Frete, cliente do E01, serviço 100,00 e frete acordado 100,00. Não abrir a OS histórica para salvar.
4. E02 — `mark_proposal_sent` e então aceite. Reuso do aceite recusado. Token curto não encontra.
5. E04 — Dois motoristas da A. Primeiro aceite único. Substituição limpa o aceite e exige o segundo.
6. E05 — Conclusão só com motorista confirmado. Se o parâmetro de pátio da A existir, um ticket de 8,00. A receita nasce em `Receita Estacionamento` ou `Receita Lava Rápido`, sem `service_order_id`.
7. E06 — Pedágio 10,00 e motorista 20,00 na OS nova. Segunda gravação da mesma data, OS e conta é bloqueada. Rateio da OS: 70,00.
8. E07A — Título novo de 15,00, conta diferente de Pedágio e da conta do motorista, `service_order_id` nulo. Ausente na empresa B.
9. E08A — Financeiro não aprova nem estorna. Admin aprova, paga e estorna com motivo. Valor original 15,00. Postagem com `reversed_at`. Lançamento `cancelled`. Efeito líquido no aprovado: zero.
10. E09 — Dashboard e DRE da sessão da A, só `approved`. Sem pátio: 70,00. Com pátio: 78,00. `HOM-092-*` fora.
11. E10 — Um registro descartável. Exclusão direta bloqueada. Exclusão auditada gera evento. Restauração não apaga o evento. Os 11 eventos `homolog.089` permanecem.
12. E11 — A cada passo acima, a sessão da B não lê nem grava cliente, OS, lançamento, título ou tarifa da A.

E07B e E08B não têm passo nesta cadeia. Não criar recebível nem baixa no Core nesta autorização de escrita operacional.

# MASTER PROMPT — PSCS (Philippe / Filipe)

**Prioridade máxima neste Workspace.** Em conflito com outros documentos, este arquivo prevalece.

Última atualização: 2026-07-13

---

## 1. Quem é quem

| Pessoa | Papel |
|--------|--------|
| **Philippe / Filipe (PSCS)** | Dono da conta Cursor / operação técnica e comercial da PSCS. Decide arquitetura, cobrança, reuso do produto para outros clientes. |
| **Rafael** | Dono da **GRX Transportes** — cliente principal do sistema atual. Valida telas e operação. |
| **Cursor / agente** | Implementa no padrão PSCS; publica prod+dev quando houver ajuste pronto; não inventa escopo comercial sem alinhamento. |

Comunicação preferencial com o time: **português (Brasil)**, direto e objetivo.

---

## 2. Produto (visão PSCS)

O sistema nascido como **GRX Management** deve ser tratado como **ERP / framework multiempresa** da PSCS, **não** como software descartável de um único cliente.

- Mesmo **repositório**, **schema** (`company_id`) e **stack** para novos clientes (ex.: Comfort).
- **Não** refazer do zero: onboarding + white-label + módulos.
- Stack típica: **Next.js (frontend)** + **Supabase (Postgres/Auth/RLS)** + **Vercel**.
- Repo de referência: `grx-management` (GitHub: philippesantana-p8/grx-management).
- Produção: https://grx-management.vercel.app — branch principal: `main`.

### Modelos de entrega para outro cliente

1. **Preferido:** nova `company` no mesmo produto (multi-tenant).
2. **Alternativo:** mesmo código, ambiente separado (Vercel/Supabase) se o contrato exigir isolamento.
3. **Evitar:** fork permanente do código.

---

## 3. Deploy e operação (obrigatório)

- Ajustes prontos para o cliente → **publicar em produção e desenvolvimento**.
- Neste repo, só existe `main` → push em `main` dispara produção Vercel; Preview cobre o lado de desenvolvimento quando houver.
- Commit/push quando o ajuste estiver validado no build; não deixar só local se o usuário pediu implementação.
- Lembretes de SQL: scripts `frontend/scripts/apply-NNN-*.sql` devem ser aplicados no Supabase quando houver migration nova.

Regra Cursor espelhada: `.cursor/rules/deploy-prod-and-dev.mdc`.

---

## 4. Cobrança (PSCS → Rafael / clientes)

- Mensalidade sugerida de referência: **mínimo ~R$ 800/mês** (proposta comercial mais ampla já citada ~R$ 2.500 conforme escopo de suporte).
- Módulo de **mensalidade com cartão** via **Asaas** (não guardar número/CVV no banco).
- Tela **Configurações → Renovação da licença** (`/configuracoes/mensalidade`):
  - **PSCS (operador por e-mail):** bloco valor teste/produção, dia e sync Asaas — `PSCS_OPERATOR_EMAILS` / `isPscsOperatorEmail`. **Não** usa Senha Máster.
  - **Cliente comprador (Rafael etc.):** termo + aceite + cartão/titular. Vê valor cobrado, mas **não** edita preços.
  - **Senha Máster:** só concessão de acessos por sócio (Parâmetros) — do cliente, não da PSCS.
- **Termo de responsabilidade** obrigatório antes do cartão (renovação mensal; reajuste **IGPM** após 12 meses com aviso 30 dias). Aceite gravado (`terms_version`, `terms_accepted_at/by/ip`). SQL: `apply-050-license-terms-acceptance.sql`. Versão texto: `LICENSE_TERMS_VERSION` em `license-terms.ts`.
- **Pausado:** criação da conta Asaas sandbox — aguardar decisão do Felipe (ele cria ou o operador cria). Retomar depois.
- Env necessários (quando retomar): `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`.
- SQL billing: `apply-037-company-billing.sql` + `apply-050-license-terms-acceptance.sql`.

---

## 5. GRX — módulos e decisões recentes (2026-07)

| Área | Decisão / estado |
|------|------------------|
| Campos formulário | Liquid glass: **azul** = opcional; **amarelo suave** = obrigatório (vídeo Filipe 2026-07-14). OS amarelo: Tipo, Data, Entrada/Saída, Veículo, Motorista, Valor, Cliente, Telefone, apresentação/horários, atendente, monitoria 24h, Conta DRE, Ponto A/B, Pedágio, passageiros (Transporte). Status/Código/Observações/voo/órgão emissor = azul. |
| Passageiros na OS | Só no tipo **Transporte**. Frete/Estacionamento/Lava-rápido escondem o painel; natureza DRE só-Frete também alinha o tipo e esconde. |
| Voucher motorista | Valores motorista/ajudante **em branco** no voucher; sistema/designação guardam os valores. Foto do motorista no cadastro → voucher Transporte/Frete. SQL: `apply-040-driver-photo.sql`. |
| Foto veículo | Foto mestre em Cadastros → Veículos (`vehicles.photo_storage_path`, bucket `company-attachments`). Na OS/voucher Frete/Transporte: preview **somente leitura** (sem upload na OS). SQL: `apply-045-vehicle-photo.sql`. |
| Dashboard 3D | Navegação por produto (Geral / Frete-Transporte / Estacionamento / Lava). Geral: 3 pizzas (receita, despesa, societário). Filtros: período preset + **De/Até** (data), placa/sócio/%. **Exportar Excel** (abas Resumo / Frete Transporte / Estacionamento / Lava / Despesas / Receitas; **inclui DEMO** por enquanto para teste — depois omitir). Lib: `dashboard-export.ts` + exceljs. Base DEMO via RPC `seed_dashboard_demo` (Senha Máster). SQL: `apply-047-dashboard-demo-volume.sql` + `reset-dashboard-demo.sql`. |
| Sócios | RG / CPF / CNPJ + validações BR. |
| Menu / nomes | Operacional: **Agenda da Frota** acima de **Ordem de Serviço — Transporte e Frete**. DRE com iniciais maiúsculas (Empresa, Motorista/Ajudante, Veículo). Ordem dos blocos: Cadastros → **Parâmetros** → **Configurações** (Integrações + **Renovação da licença**). Sem ✕ ao lado do logo no desktop (só no menu mobile). |
| Parâmetros | **Senha Máster - Concessão de Acessos** = só permissões por sócio (sem bloco Asaas/mensalidade). Cobrança/valores/cartão em **Configurações → Renovação da licença**. **Análise/Alteração/Exclusão** enforçados nas telas. Exclusão pede motivo obrigatório. **Histórico de exclusões** — admin; SQL `apply-048` + `apply-049`. |
| Auth | Cadastro/login e-mail + reset de senha. |
| DRE motorista | Pagamentos + lançamento automático Motorista/Ajudante. |
| DRE veículo | Aba **Despesas do veículo** por placa (pedágio, combustível, pneu, oficina, outros). Anti-duplicata: mesma **data + OS + conta DRE**. SQL: `apply-038-vehicle-expenses.sql`. |
| Mobile web | Shell responsivo: menu ☰ (drawer), formulários com Salvar sticky, tabelas com scroll horizontal + ações fixas. Abrir/editar no celular pelo mesmo URL. |
| Agenda frota | Aba **Agenda da frota** (semana por placa, horários livres, baseada em OS entrada/saída). |
| DRE empresa | Aba **Lançamentos da empresa** — receitas/despesas gerais (geladeira, escritório…) sem placa. SQL: `apply-039-company-ledger.sql`. |
| Estacionamento / Lava | Módulos próprios: portes + tabela de preços (diária/mensal/**rotativo por hora**/lava) em **Parâmetros do pátio**; ordens em Operacional → Estacionamento / Lava-rápido; DRE **Receita Estacionamento** / **Receita Lava Rápido** no fechamento. Rotativo: **1ª hora** + **hora adicional** (exemplo seed R$ 10 / R$ 5). Clipe de comprovante **opcional** antes de finalizar. SQL: `apply-041` + `apply-042` + `apply-044-patio-rotativo-hourly.sql`. Na OS geral: **Tipo** e **Natureza DRE** só **Frete** e **Transporte**. |
| Tarifas frete/km | Cadastro mestre em **Parâmetros de frete** (R$/km por modalidade + categoria; ida/volta a partir de N km, padrão 500). OS puxa a tarifa e permite override amarelo — sem chips de sugestão. SQL: `apply-043-freight-rate-tables.sql`. |
| Multiempresa | `companies` + `company_members` + RLS desde o schema V1. |

---

## 6. Padrões de implementação PSCS

- Seguir UI/glass existente; não reinventar design system.
- Preferir `company_id` em tudo; RLS já existente.
- Contas DRE pelo `chart_of_accounts` (seed da planilha do Rafael).
- Evitar duplicar lançamentos financeiros (OS vs manual — checar data/OS/conta).
- Não criar markdown/docs extras sem pedido; **exceto** este MASTER e regras Cursor.
- Não commitar segredos (`.env`, service role, API keys).
- Commit só quando pedido **ou** quando o fluxo do workspace for “implementar + publicar” (já confirmado pelo usuário).

---

## 7. Backlog consciente (não iniciar sem pedir)

- Retomar Asaas / teste cartão Felipe → depois valor produção Rafael.
- Onboarding white-label para segundo cliente (Comfort etc.).
- Importação financeira / lançamentos DRE em massa (planilha do Rafael).
- Limpeza / reset total da base da empresa (além do Limpar DEMO do Dashboard).
- Vincular `company_members.partner_id` para permissões finas de não-admin.
- Proposta comercial formal PSCS (texto já rascunhado; coberta sob demanda).

---

## 8. Como o agente deve responder

1. Ler este MASTER primeiro.
2. Ser conciso; português quando o usuário falar PT ou o contexto for GRX/PSCS.
3. Em features novas: alinhar ao multi-tenant e ao DRE por placa/OS.
4. Ao terminar ajuste de produto: build + publicar prod/dev + lembrar SQL se houver.
5. Guardar decisões novas neste arquivo quando forem de longo prazo (Philippe / produto / cobrança / deploy).

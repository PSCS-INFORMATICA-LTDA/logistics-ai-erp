# Logistics — Arquitetura do Produto no PSCS One

Versão: 2.0  
Data: 12/09/2026  
Status: Aprovado para desenvolvimento DEV

---

## 1. Visão geral

**Logistics** é o produto operacional/financeiro de logística do ecossistema **PSCS One**.

O produto deve atender múltiplas empresas/tenants sem forks de código, nomes de cliente em regras genéricas ou bancos separados por convenção de nome. Clientes existentes e futuros são registros de empresa; não definem o nome do produto.

**Objetivo:** oferecer uma base simples, confiável e escalável para operações de transporte, frota, serviços auxiliares, financeiro e gestão executiva.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + componentes reutilizáveis PSCS |
| Backend / API | Next.js API Routes + Supabase Client |
| Banco de dados | PostgreSQL (Supabase) |
| Autenticação | Supabase Auth / federação PSCS One conforme contrato vigente |
| Hospedagem | Vercel (frontend) + Supabase (backend/DB) |
| IDE / IA | Cursor |

---

## 3. Módulos funcionais

```text
PSCS One
└── Logistics
    ├── Core do produto
    │   ├── Contexto de empresa
    │   ├── Cadastros operacionais
    │   └── Configurações (DRE, tipos, preços)
    ├── Financeiro
    │   ├── Lançamentos (realizado)
    │   ├── Fluxo de caixa (projetado)
    │   └── Conciliação
    ├── Operações
    │   ├── Ordens de Serviço
    │   ├── Agenda operacional
    │   └── Histórico/auditoria
    ├── Frota
    │   ├── Veículos e participação societária
    │   ├── Motoristas
    │   ├── Vencimentos e alertas
    │   └── Histórico de eventos
    ├── Estacionamento
    │   ├── Movimentos (entrada/saída)
    │   └── Cobrança automática por vigência
    ├── Lava-rápido
    │   ├── Serviços
    │   └── Cobrança automática por vigência
    └── Dashboards
        ├── Executivo
        ├── Operacional
        ├── Frota
        ├── Participação societária
        ├── Motoristas
        └── Estacionamento/Lava-rápido
```

---

## 4. Arquitetura em camadas

```text
┌─────────────────────────────────────────────┐
│              FRONTEND (Next.js)             │
│  Pages / Components / Hooks / Forms         │
└──────────────────┬──────────────────────────┘
                   │ REST / Supabase Client
┌──────────────────▼──────────────────────────┐
│           API LAYER (Next.js Routes)        │
│  Validação / Regras / Autorização           │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          SUPABASE (PostgreSQL + Auth)       │
│  Tabelas / Views / Triggers / RLS           │
└─────────────────────────────────────────────┘
```

O frontend nunca é autoridade para seleção de empresa. APIs e repositórios devem validar contexto de tenant no servidor.

---

## 5. Multiempresa — regra obrigatória

- `companies` é a raiz local de tenant do produto.
- Todas as tabelas operacionais/financeiras multiempresa devem possuir `company_id` obrigatório quando o dado pertence a uma empresa.
- RLS e/ou autorização server-side filtram por empresa autorizada do usuário.
- Usuários podem pertencer a uma ou mais empresas.
- Troca de empresa é validada contra membership/entitlement; `company_id` enviado pelo browser não é confiável por si só.
- Mapeamento com PSCS One é por UUID estável, nunca por razão social, nome fantasia, sigla do cliente ou slug comercial.
- O código genérico não pode conter regra de autorização, rota, CSS, tabela ou feature flag baseada no nome de um tenant.

Contrato conceitual:

```text
Authenticated User
→ PSCS One Membership
→ Company UUID
→ Logistics entitlement
→ Product/company mapping
→ Logistics company context
→ RLS / server authorization
```

---

## 6. Identidade e Party Master

PSCS One é a autoridade canônica para identidade compartilhada, membership, company context e Party Master conforme o contrato da plataforma.

Logistics mantém somente os dados operacionais específicos do produto, por exemplo:

- veículos;
- motoristas e dados específicos de operação/compliance;
- viagens/OS;
- movimentos de estacionamento;
- serviços de lava-rápido;
- lançamentos e classificações específicas do produto.

Cliente, fornecedor ou pessoa não deve virar um novo cadastro canônico apenas porque assume um papel diferente. A adoção do Party Master deve ser incremental por referência externa, sem big bang.

---

## 7. Regras de negócio na arquitetura

| Regra | Onde implementar |
|-------|------------------|
| Classificação via DRE | API: ao salvar lançamento, buscar conta DRE e preencher classification/type |
| Participação = 100% | Trigger PostgreSQL |
| Cálculo de diárias estacionamento | API + função SQL |
| Preço vigente | Função SQL `get_active_price(modality, type, service, date)` |
| Totais por veículo | View `vw_vehicle_financial_totals` |
| Atribuição societária | View `vw_ownership_base` |
| Alertas de vencimento | Job/cron ou query na view com filtro de dias |
| Isolamento multiempresa | RLS + autorização server-side por `company_id` |
| Acesso ao produto | entitlement Logistics no PSCS One |

---

## 8. Segurança

- Autenticação central/federada conforme PSCS One.
- RLS nas tabelas multiempresa por `company_id`.
- Nenhuma permissão é concedida apenas por esconder/mostrar menu.
- APIs validam membership, empresa e permissão no servidor.
- Dados de uma empresa nunca podem ser relacionados a pai/filho de outra empresa.
- Perfis funcionais podem incluir:
  - **Admin:** todos os módulos + configurações;
  - **Financeiro:** lançamentos, fluxo de caixa, relatórios;
  - **Operacional:** OS, agenda, estacionamento, lava-rápido, frota;
  - **Sócio (read-only):** dashboards executivo e participação.

---

## 9. Experiência desktop e mobile

O produto usa um único modelo de domínio e um único backend para desktop e mobile.

- mesmos registros;
- mesmas permissões;
- mesmas regras de empresa;
- mesmas APIs;
- layout responsivo conforme o dispositivo.

Não existe um tenant mobile separado nem duplicação de banco para aplicativo móvel.

---

## 10. Integrações futuras

- Emissão de NFSe;
- Integração bancária / OFX;
- WhatsApp para alertas de vencimento;
- experiências móveis dedicadas para operadores, consumindo as mesmas APIs e contexto multiempresa.

---

## 11. Estrutura de pastas do projeto

```text
logistics-ai-erp/
├── docs/                  # Documentação
├── database/              # Scripts SQL
├── supabase/              # Migrations Supabase
├── frontend/              # Next.js app
│   ├── app/               # App Router pages
│   ├── components/        # UI components
│   ├── lib/               # Supabase client, utils
│   └── types/             # TypeScript types
└── tests/                 # Testes automatizados
```

---

## 12. Decisões arquiteturais

| Decisão | Justificativa |
|---------|---------------|
| PSCS One como autoridade de membership/company/product | Evita identidades e cadastros mestres duplicados |
| Tenant por UUID, nunca nome | Permite rebranding e múltiplas empresas sem fork |
| Supabase | RLS nativo; auth integrado; padrão PSCS |
| Views para dashboards | Evita duplicar lógica de cálculo; performance |
| Triggers para integridade crítica | Integridade garantida no banco |
| Cadastros antes de lançamentos | Evita dados livres/inconsistentes |
| Preços com vigência | Preserva histórico |
| Separação de papéis/FKs específicos | Mantém significado operacional explícito |
| Desktop + mobile no mesmo domínio | Evita divergência de dados e regras |

---

## Histórico de versões

| Versão | Data | Autor | Descrição |
|--------|------|-------|-----------|
| 1.0 | 02/07/2026 | PSCS | Arquitetura inicial do projeto |
| 2.0 | 12/09/2026 | PSCS | Produto neutralizado para Logistics, alinhado ao PSCS One e multiempresa |

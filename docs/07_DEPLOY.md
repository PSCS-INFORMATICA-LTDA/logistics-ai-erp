# GRX Management — Guia de Deploy

Versão: 1.0  
Data: 07/07/2026  
Status: Pronto para deploy  
Repositório: [philippesantana-p8/grx-management](https://github.com/philippesantana-p8/grx-management.git)

---

## 1. Visão geral

O GRX Management é um monorepo com frontend Next.js em `frontend/` e banco PostgreSQL + Auth no Supabase.

| Camada | Serviço | Função |
|--------|---------|--------|
| Frontend + API Routes | **Vercel** | App Next.js 15 (App Router), SSR, rotas `/api/*` |
| Banco + Auth + Storage | **Supabase** | PostgreSQL, RLS, autenticação, anexos |

**Fluxo de deploy:** aplicar migrations no Supabase → configurar variáveis de ambiente → conectar repositório à Vercel com **Root Directory = `frontend`** → validar em produção.

Referência arquitetural: [00_ARQUITETURA_DO_PROJETO.md](./00_ARQUITETURA_DO_PROJETO.md).

---

## 2. Pré-requisitos

### 2.1 Contas e acesso

- Projeto Supabase criado (Production)
- Conta Vercel com acesso ao repositório GitHub
- Supabase CLI instalado (opcional, recomendado): `npm i -g supabase`

### 2.2 Migrations pendentes (015–020)

Antes do primeiro deploy em produção — ou ao atualizar um ambiente existente — aplique **todas** as migrations em ordem:

| Arquivo | Descrição |
|---------|-----------|
| `015_service_orders_freight_tolls.sql` | Pedágios detalhados em OS de frete |
| `016_vehicles_axle_count.sql` | Campo de eixos no cadastro de veículo |
| `017_service_orders_status_approval.sql` | Status “aguardando aprovação” na OS |
| `018_service_orders_per_diem.sql` | Diárias/hospedagem/alimentação em rotas longas |
| `019_service_orders_per_diem_charge.sql` | Responsável pelas despesas de viagem |
| `020_service_orders_transport_km_rate.sql` | Tarifa por km de referência (van) |

**Via Supabase CLI** (na raiz do repositório):

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

**Via Dashboard:** Supabase → **SQL Editor** → executar `supabase/apply_015_to_020.sql` (ou cada arquivo de `supabase/migrations/` na ordem numérica).

> Confirme no Dashboard (**Database → Migrations** ou histórico de queries) que 015–020 foram aplicadas antes de testar OS de frete em produção.

### 2.3 URLs de autenticação (Supabase)

Em **Authentication → URL Configuration**:

| Campo | Valor (produção GRX) |
|-------|----------------------|
| **Site URL** | `https://grx-management.vercel.app` |
| **Redirect URLs** | `https://grx-management.vercel.app/**` |
| | `http://localhost:3002/**` (desenvolvimento) |

Link direto: [Supabase → Auth → URL Configuration](https://supabase.com/dashboard/project/tqeenmswotxqainkyyct/auth/url-configuration)

O middleware do app redireciona usuários não autenticados para `/login`. Garanta que a URL de produção esteja na lista de redirects permitidos.

### 2.4 Storage (se usar anexos)

Verifique no Supabase que o bucket de anexos (migration `008_storage_attachments.sql`) existe e as policies RLS estão ativas.

---

## 3. Deploy na Vercel (passo a passo)

### 3.1 Importar o projeto

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Importe `philippesantana-p8/grx-management`
3. Em **Root Directory**, clique em **Edit** e selecione **`frontend`**
4. Framework Preset: **Next.js** (detectado automaticamente)

### 3.2 Configuração de build

| Configuração | Valor |
|--------------|-------|
| Root Directory | `frontend` |
| Build Command | `npm run build` (padrão) |
| Output Directory | `.next` (padrão Next.js) |
| Install Command | `npm install` (padrão) |
| Node.js Version | 20.x ou superior (recomendado) |

Não é necessário `vercel.json` na raiz; a Vercel detecta o Next.js dentro de `frontend/`.

### 3.3 Variáveis de ambiente

Configure em **Project Settings → Environment Variables** (Production e, se desejar, Preview):

| Variável | Obrigatória | Escopo | Descrição |
|----------|-------------|--------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Client + Server | URL do projeto Supabase (`https://xxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Client + Server | Chave anon/public do Supabase |
| `GOOGLE_VISION_API_KEY` | Não | Server | OCR de CNH via Google Vision (sem ela, usa Tesseract local) |
| `QUALP_API_TOKEN` | Não | Server | Pedágios automáticos na rota A→B (QualP Pro) |
| `CIOT_ONLINE_API_TOKEN` | Não | Server | Piso mínimo ANTT por tipo de carga |

Referência local: `frontend/.env.local.example`.

> Variáveis `NEXT_PUBLIC_*` são expostas ao browser — use apenas a **anon key**, nunca a service role key.

### 3.4 Deploy

1. Clique em **Deploy**
2. Aguarde o build (~2–5 min na primeira vez)
3. Anote a URL gerada (`*.vercel.app`)
4. Atualize **Site URL** e **Redirect URLs** no Supabase (seção 2.3) com a URL final
5. Se usar domínio customizado, repita o passo 4 após configurá-lo

### 3.5 Deploys subsequentes

Push na branch conectada (ex.: `main`) dispara deploy automático. Migrations novas devem ser aplicadas no Supabase **antes** de mergear código que depende delas.

---

## 4. Checklist pós-deploy

Execute na URL de produção: **https://grx-management.vercel.app**

- [ ] `/login` — tela carrega sem erro
- [ ] Login com usuário de teste — redireciona para `/dashboard`
- [ ] Logout e acesso a rota protegida — redireciona para `/login`
- [ ] `/cadastros/veiculos` — listagem e CRUD básico
- [ ] `/operacional/ordens-servico` — listagem; criar OS de frete (requer migrations 015–020)
- [ ] `/api/integrations/status` — retorna status das integrações configuradas
- [ ] Upload de anexo (se aplicável) — bucket Supabase Storage
- [ ] Integrações opcionais: rota de frete (`QUALP`), piso ANTT (`CIOT`), OCR CNH (`GOOGLE_VISION`)

---

## 5. Domínio customizado (opcional)

1. Vercel → **Project → Settings → Domains**
2. Adicione o domínio (ex.: `app.suaempresa.com.br`)
3. Configure DNS conforme instruções da Vercel (CNAME ou A record)
4. Atualize **Site URL** e **Redirect URLs** no Supabase
5. Aguarde propagação DNS e teste login novamente

---

## 6. Validação de build local

Antes de fazer push ou deploy, valide o build de produção na pasta `frontend/`:

```powershell
cd D:\PSCS\Projetos\grx-management\frontend
npm install
npm run build
```

**Sucesso esperado:** mensagem `Compiled successfully` e tabela de rotas estáticas/dinâmicas, sem erros TypeScript ou ESLint bloqueantes.

Servidor local de produção (opcional):

```powershell
npm run start
# App em http://localhost:3000 (porta padrão do next start)
```

> Desenvolvimento usa porta **3002** (`npm run dev`). Build/start de produção usam porta 3000 por padrão.

---

## 7. Problemas comuns

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| Build falha na Vercel | Erros TS/lint ou dependências | Rodar `npm run build` localmente; corrigir erros |
| “Invalid API key” / tela em branco | Variáveis Supabase incorretas ou ausentes | Conferir `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Login loop ou redirect inválido | URL não cadastrada no Supabase | Adicionar URL de produção em Auth → URL Configuration |
| Erro ao salvar OS de frete | Migrations 015–020 não aplicadas | Executar `supabase db push` ou SQL manual |
| Pedágios não calculam | `QUALP_API_TOKEN` ausente | Configurar token ou preencher pedágios manualmente |
| OCR CNH impreciso | Sem Google Vision | Adicionar `GOOGLE_VISION_API_KEY` ou aceitar fallback Tesseract |
| RLS / “permission denied” | Usuário sem `company_members` | Verificar vínculo usuário ↔ empresa no Supabase |
| Anexo não sobe | Bucket ou policy ausente | Revisar migration 008 e policies no Storage |

---

## 8. Referências

- [Documentação Vercel — Monorepos](https://vercel.com/docs/monorepos)
- [Supabase — Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [Supabase — Auth URL Configuration](https://supabase.com/docs/guides/auth/redirect-urls)
- Variáveis de exemplo: `frontend/.env.local.example`

---

## Histórico de versões

| Versão | Data | Autor | Descrição |
|--------|------|-------|-----------|
| 1.0 | 07/07/2026 | PSCS | Guia inicial de deploy Vercel + Supabase |

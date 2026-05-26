# FreteGO

Marketplace de frete brasileiro conectando embarcadores e motoristas, com painel administrativo completo.

## Stack

- **React 18** + TypeScript (strict) + Vite
- **Tailwind CSS** — UI utility-first
- **Supabase** — Postgres + Auth + Storage + Edge Functions + Realtime
- **React Router v6** — SPA routing
- **Leaflet + react-leaflet** — Mapas interativos
- **Vitest + fast-check** — Testes unitários e property-based
- **Husky + lint-staged** — Pre-commit (ESLint + Prettier)

## Funcionalidades

### Plataforma (usuários)

- Cadastro e login com verificação de e-mail
- Perfil de embarcador (empresa, CNPJ, logo, plano)
- Perfil de motorista (documentos, RNTRC, veículo)
- Publicação de fretes com formulário completo (origem/destino com mapa, produto, valor, distância)
- Mapa interativo com raio de busca configurável
- Listagem de fretes com filtros e likes
- Chat em tempo real entre embarcador e motorista (com anexos)
- Notificações push e in-app
- Sugestão de viagens

### Painel Administrativo (`/admin`)

Acesso restrito com MFA TOTP, RBAC granular e audit-by-construction.

| Módulo | Migration | Descrição |
|--------|-----------|-----------|
| Foundation | 030 | RBAC (`is_admin_with_permission`), MFA TOTP, audit logs, Master Admin imutável |
| Usuários | 031 | Banimento, toggle ativo, bulk operations, CSV export |
| Fretes | 032 | Flag, edição, cancelamento, exclusão de fretes |
| Blacklist | 035 | Lista negra (phone/CPF/CNPJ/email/IP), auto-blacklist no ban |
| Dashboard | 036 | KPIs agregados, gráficos SVG inline, mapa de calor, mini-dashboard |
| Financeiro | 037 | Comissão (flat + faixas), repasses 1:1 com fretes, marcar pago, estornar *(em progresso)* |

Padrões do painel:
- Versionamento otimista (`updated_at` + `STALE_VERSION`)
- Idempotência forte (`_SKIPPED` em operações repetidas)
- Stealth_404 (sem revelar existência de rotas protegidas)
- Degradação parcial (`Promise.allSettled` em sub-queries)
- CSV BOM UTF-8 + `;` + RFC 4180 + truncamento 10.000 linhas
- Bulk com pool de concorrência 5

## Estrutura do Projeto

```
src/
  components/
    admin/           # Componentes do painel (sidebar, guard, shell, módulos)
    *.tsx            # Componentes públicos (mapa, chat, fretes, forms)
  pages/
    admin/           # Páginas do painel (dashboard, users, fretes, blacklist)
    *.tsx            # Páginas públicas (home, login, register, perfil)
  services/
    admin/           # Services do painel (audit, permissions, auth, módulos)
    supabase.ts      # Cliente Supabase único
  hooks/             # Custom hooks (useAdminPermission, useAdminSession, etc.)
  __tests__/
    admin/           # Property tests por módulo (fast-check)

supabase/
  migrations/        # 037 migrations (aplicadas automaticamente via GitHub integration)

.kiro/
  specs/             # Specs de features (requirements → design → tasks)
  steering/          # Convenções do projeto (carregadas automaticamente)
```

## Setup

### Pré-requisitos

- Node.js 18+
- Conta Supabase com projeto configurado

### Instalação

```bash
git clone <repository-url>
cd FreteGO
npm install
cp .env.example .env
# Preencher VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
```

### Scripts

```bash
npm run dev          # Dev server (Vite)
npm run build        # Build produção
npm run preview      # Preview local da build
npm run lint         # ESLint
npx tsc --noEmit     # Type check
npx vitest --run     # Testes (property-based + unit)
```

## Deploy

- **Frontend**: Vercel (deploy automático em push para `main`)
- **Backend**: Supabase (migrations aplicam automaticamente via GitHub integration)
- Branch `main` direto — sem PRs obrigatórios no momento

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anônima (publishable) |

## Status do Desenvolvimento

- [x] Plataforma base (cadastro, login, fretes, mapa, chat)
- [x] Painel admin: Foundation + RBAC + MFA
- [x] Painel admin: Gestão de usuários
- [x] Painel admin: Gestão de fretes
- [x] Painel admin: Blacklist
- [x] Painel admin: Dashboard com KPIs
- [ ] Painel admin: Financeiro (comissão + repasses) — *backend pronto, UI em progresso*
- [ ] Painel admin: Suporte / CRM
- [ ] Painel admin: Configurações gerais

## Licença

Projeto privado e proprietário.

---
inclusion: always
---

# Convenções do FreteGO

Documento de referência permanente. Ler antes de gerar código novo, criar specs ou
revisar PRs.

## Stack

- TypeScript (strict) + React 18 + Vite + TailwindCSS
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Vitest + fast-check (property-based testing)
- React Router v6
- Leaflet + react-leaflet (mapas)
- Sem Recharts/Chart.js: gráficos em SVG inline

## Idioma

- UI, comentários e mensagens user-facing em **pt-BR**.
- Action codes, error codes, identifiers SQL e nomes de tipos em **inglês**.
  Ex: `BLACKLIST_LOGIN_BLOCKED`, `STALE_VERSION`, `DashboardKPI`.
- Mensagens de erro user-facing canônicas anti-enumeration:
  `Não foi possível autenticar.` / `Não foi possível concluir o cadastro.` /
  `Não foi possível enviar o código.`

## Estilo de UI compacto (pós-cleanup)

Aplicar em TODA listagem do painel admin:
- SEM `<h1>` grande no topo da página (a sidebar já identifica).
- Filtros em popover via botão de ícone `SlidersHorizontal`. Nunca expandir
  em painel inline largo.
- Paginação com seletor `10 / 50 / 100` (default `10`).
- Botões de ação compactos: `text-xs px-2.5 py-1`.
- Cards de KPI: label `text-[10px] uppercase tracking-wider text-gray-500`,
  valor `text-base sm:text-lg font-semibold`.
- Mobile (`<768px`): tabela vira lista de cards single-column.

## CSV Export (padrão herdado)

- BOM UTF-8 (`\uFEFF`) prefixado.
- Separador `;` (compatível Excel pt-BR).
- Escape RFC 4180: aspas duplas em campos com `"`, `;`, `\n`, `\r`. Aspa
  interna duplicada.
- Quebra de linha `\r\n`.
- Truncamento em **10000 linhas** (incluindo cabeçalho). Logar
  `truncated: true` no audit.
- Filename padrão: `<modulo>_<YYYYMMDD>_<HHmm>.csv`.

## Property-based testing (fast-check)

Convenções específicas do projeto:
- `vi.mock` é hoisted: NÃO referenciar variáveis externas no factory.
  Usar `(globalThis as Record<string, unknown>).__nomeDoSpy = ...` para expor.
- `fc.stringOf` NÃO existe. Usar
  `fc.string({ minLength, maxLength }).filter(...)`.
- Geradores de phone/CPF/CNPJ/email: usar `fc.constantFrom([...templates fixos válidos])`
  para evitar valores aleatórios que falham na validação.
- CPs obrigatórios em specs do painel: nunca marcar com `*` (asterisco).
  Opcionais sempre com `*`.

## Pre-commit hooks

`husky + lint-staged` rodam `eslint --fix` e `prettier` no que é staged.
Cuidados:
- Variáveis não usadas: prefixar com `_` ou remover. `eslint-disable` inline
  NÃO silencia tsc com `noUnusedLocals`.
- `while (true)` proibido: usar `for (;;)`.
- Sem escape desnecessário em regex.
- LF → CRLF warnings no Windows são esperados, ignorar.

## Commits

- Padrão: `feat(modulo): descricao` ou `fix(modulo): descricao` em pt-BR
  no body. Titulo curto, imperativo.
- Só commitar quando o usuário pedir explicitamente.
- Nunca push sem o usuário pedir.
- Branch `main` direto está OK (deploy automático via Vercel + Supabase
  GitHub integration).

## Estrutura de pastas relevantes

```
src/
  components/
    admin/
      <modulo>/    # componentes específicos (BlacklistTable, FinanceiroTable...)
      AdminGuard.tsx, AdminLayoutRoute.tsx, AdminProvider.tsx, AdminShell.tsx, AdminSidebar.tsx
  pages/
    admin/
      AdminDashboardPage.tsx
      <modulo>/    # FinanceiroListPage, BlacklistDetailPage...
  services/
    admin/
      <modulo>.ts  # toda lógica de service do módulo admin
      audit.ts, permissions.ts, auth.ts
    supabase.ts    # cliente único do projeto
  hooks/
    useAdminPermission.ts, useAdminSession.ts, useViewPreference.ts...
  __tests__/
    admin/
      <modulo>/    # property tests cp1*.property.test.ts, etc

supabase/
  migrations/
    NNN_<nome>.sql                # aplicada automaticamente em push
    NNN_<nome>_rollback.sql       # documentação, não auto-aplicada

.kiro/
  specs/<modulo>/
    .config.kiro requirements.md design.md tasks.md
  steering/
    project-conventions.md  admin-patterns.md  (este conjunto)
```

## Numeração de migrations

Sempre incremental, sem buracos:
- 030 admin-foundation
- 031 admin-users
- 032 admin-fretes
- 033 embarcador-branch
- 034 admin-notify-user
- 035 admin-blacklist
- 036 admin-dashboard
- 037 admin-financeiro (próxima)

## Logins de teste

Master Admin do painel: usuário `Nexus_Vortex99`, senha em `Credencial/logins`
(arquivo gitignored, NÃO commitar). Bruno Henrique. **Imutável** — todas as
mutações admin no `users` checam `admin_username='Nexus_Vortex99'` e abortam.

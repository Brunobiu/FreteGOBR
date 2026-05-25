# Implementation Plan: admin-dashboard

## Overview

Plano incremental para entregar o módulo de Dashboard Analítico do painel administrativo do FreteGO, sentado em cima das fundações já em produção: `admin-foundation` (migration 030, `AdminProvider`, `AdminGuard`, `AdminShell`, `Permission_Matrix`, `executeAdminMutation`, `logAdminAction`, `is_admin_with_permission`, `Stealth404`), `admin-users` (migration 031, padrão CSV BOM UTF-8 + `;` + RFC 4180), `admin-fretes` (migration 032, padrão de degradação parcial em `getXDetail`), `embarcador-branch` (migration 033, `embarcadores.branch_state`) e `admin-blacklist` (migration 035, `admin_blacklist`, `is_blacklisted`, alertas em `admin_audit_logs`). Cada task referencia requisitos do `requirements.md` (Reqs X.Y) e propriedades de correção do `design.md` (CP-N). Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, docs auxiliares); sub-tasks sem asterisco são obrigatórias.

> **Nota de numeração:** As migrations `034_admin_notify_user.sql` e `035_admin_blacklist.sql` já estão entregues. Esta spec usa **migration 036** em todos os arquivos e referências (`supabase/migrations/036_admin_dashboard.sql` e `supabase/migrations/036_admin_dashboard_rollback.sql`).

Convenções:

- Esta spec é continuação de `admin-foundation` + `admin-users` + `admin-fretes` + `embarcador-branch` + `admin-blacklist`. Toda dependência lá entregue (Provider, Guard, Shell, Sidebar, hooks, services, RPCs, padrões) é **reusada sem modificação**, exceto: (a) `permissions.ts` ganha `DASHBOARD_VIEW` na enum e nas matrizes; (b) `AdminSidebar.tsx` recebe `permission: 'DASHBOARD_VIEW'` no item Dashboard caso ainda não esteja gated; (c) `AdminDashboardPage.tsx` é substituído.
- **Não há mutações de banco** nesta spec. O único side-effect rastreado é o download de CSV via `logAdminAction({ action: 'DASHBOARD_EXPORTED' })` em `Dashboard_Service.exportCSV`.
- Stack: TypeScript + React + Supabase + fast-check + Vitest + Leaflet + react-leaflet (já em uso). **Zero novas dependências npm.**
- Property tests obrigatórios: 11.1 (CP-1, KPI determinístico) e 11.2 (CP-2, degradação parcial). Os demais CPs (CP-3 computeDelta idempotente, CP-4 schema RPC) são opcionais.
- Todo checkpoint (intermediário e final) garante: `npx tsc --noEmit` zero erros, `npx vitest run` verde, `npm run build` limpa.

## Tasks

- [x] 1. Migration 036 e contratos base de banco
  - [x] 1.1 Criar `supabase/migrations/036_admin_dashboard.sql`
    - Cabeçalho com objetivo, dependência de `001..035` (incluindo `030_admin_foundation`, `031_admin_users`, `032_admin_fretes`, `033_embarcador_branch`, `035_admin_blacklist`), e nota explicando que esta migration entrega o RPC agregador `admin_dashboard_metrics` + nova action `DASHBOARD_VIEW` + 3 índices auxiliares.
    - Envolver em `BEGIN; ... COMMIT;`. 7 blocos `DO $check$ ... $check$` defensivos validando: (a) `is_admin_with_permission(text)` existe (migration 030); (b) `admin_audit_logs` existe com colunas esperadas; (c) `users.created_at` existe; (d) `fretes.status`/`value`/`created_at`/`updated_at` existem; (e) `embarcadores.branch_state` existe (migration 033); (f) `frete_clicks` existe; (g) `frete_likes` existe (migration 021).
    - Cada bloco `DO` levanta `EXCEPTION` clara quando dependência ausente, abortando o `BEGIN`.
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.2 Adicionar 3 índices auxiliares idempotentes
    - `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)`.
    - `CREATE INDEX IF NOT EXISTS idx_fretes_created_at ON fretes(created_at DESC)`.
    - `CREATE INDEX IF NOT EXISTS idx_fretes_updated_at_status ON fretes(updated_at DESC) WHERE status = 'encerrado'` (parcial).
    - Idempotente via `IF NOT EXISTS` — se algum já existe (criado por migration anterior), não falha.
    - _Requirements: 11.8, 11.9, 14.4_

  - [x] 1.3 Atualizar `is_admin_with_permission` para incluir `DASHBOARD_VIEW`
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`.
    - SUPER_ADMIN: retorna `true` para qualquer action.
    - ADMIN: ganha `DASHBOARD_VIEW` (já tem por estar fora da lista de denials `USER_DELETE`/`ADMIN_ROLE_*`).
    - SUPORTE ganha `DASHBOARD_VIEW` (lista expandida em design §3.2).
    - FINANCEIRO ganha `DASHBOARD_VIEW`.
    - MODERADOR mantém lista atual sem `DASHBOARD_VIEW`.
    - Manter compatibilidade com todas as actions já existentes em 030/031/032/035 (`USER_*`, `FRETE_*`, `FINANCEIRO_*`, `BLACKLIST_*`, `CRM_*`, `SUPORTE_*`, `SETTINGS_*`, `AUDIT_*`, `ADMIN_ROLE_*`).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.10, 14.5_

  - [x] 1.4 Criar função `admin_dashboard_metrics` `STABLE SECURITY DEFINER`
    - Assinatura: `admin_dashboard_metrics(p_from timestamptz, p_to timestamptz, p_user_type text, p_uf text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`.
    - Auth check: `auth.uid() IS NULL` ⇒ `RAISE permission_denied`.
    - Permission check: `is_admin_with_permission('DASHBOARD_VIEW') = false` ⇒ insere `DASHBOARD_VIEW_DENIED` em `admin_audit_logs` E `RAISE permission_denied`.
    - Validações: `p_to >= p_from` E `(p_to - p_from) <= INTERVAL '365 days'` ⇒ senão `RAISE INVALID_PERIOD`. `p_user_type IN ('all','motorista','embarcador')` senão `RAISE INVALID_USER_TYPE`. `p_uf IS NULL OR p_uf IN (UF_BR set)` senão `RAISE INVALID_UF`.
    - Resolver granular: `v_has_fin = is_admin_with_permission('FINANCEIRO_VIEW')`; `v_has_audit = is_admin_with_permission('AUDIT_VIEW')`.
    - Computar `v_prev_from = p_from - (p_to - p_from)`, `v_prev_to = p_from`, `v_days = (p_to::date - p_from::date) + 1`.
    - Construir `WITH (...)` com 13 CTEs: `kpi_current`, `kpi_previous`, `series_cad_mot`, `series_cad_emb`, `series_fre_post`, `series_fre_enc`, `series_volume`, `geo_fretes`, `geo_usuarios`, `sec_alerts`, `top_emb`, `top_mot`, `top_rot` (corpo SQL detalhado em design §3.4 e §3.5).
    - Aplicar gating server-side via `CASE WHEN v_has_fin THEN ... ELSE 'null'::jsonb END` em `volume_transacionado`, `series.volume_diario`, `top_embarcadores`. Idem para `v_has_audit` em `logins_admin`, `alertas_seguranca_24h`, `security_alerts`.
    - Retornar `jsonb_build_object(...)` consolidado conforme schema de design §3.3.
    - **Determinismo**: TODO `ORDER BY` agregando registros tem tiebreaker secundário (`uf`, `id`, `(origin, destination)`). CP-1 valida.
    - _Requirements: 11.1, 11.2, 11.3, 14.6, 14.7, CP-1_

  - [x] 1.5 Configurar privilégios da função
    - `REVOKE ALL ON FUNCTION admin_dashboard_metrics(timestamptz, timestamptz, text, text) FROM PUBLIC`.
    - `GRANT EXECUTE ON FUNCTION admin_dashboard_metrics(timestamptz, timestamptz, text, text) TO authenticated` (apenas auth — RLS via `is_admin_with_permission` interno).
    - **Não** conceder a `anon` (dashboard é estritamente admin).
    - _Requirements: 14.8_

  - [x] 1.6 Bloco `-- VERIFY` pós-deploy comentado
    - SELECTs documentando: função `admin_dashboard_metrics` existe (`pg_proc`); função `is_admin_with_permission` reconhece `DASHBOARD_VIEW`; índices `idx_users_created_at` / `idx_fretes_created_at` / `idx_fretes_updated_at_status` existem; chamada teste `SELECT * FROM admin_dashboard_metrics(NOW() - INTERVAL '7 days', NOW(), 'all', NULL);` retorna jsonb não-nulo (executar em sessão SUPER_ADMIN).
    - Comentado (`/* ... */`) — serve como smoke test executável manualmente após deploy.
    - _Requirements: 14.9_

  - [ ]* 1.7 Smoke test de idempotência da migration
    - Script ou doc em `supabase/migrations/_test_idempotency_036.sql` que aplica a migration 2x e valida que a segunda execução não falha e não duplica funções/índices.
    - _Requirements: 14.3_

  - [x] 1.8 Criar script de rollback `supabase/migrations/036_admin_dashboard_rollback.sql`
    - Documenta `DROP FUNCTION IF EXISTS admin_dashboard_metrics(timestamptz, timestamptz, text, text)`.
    - Reverte `is_admin_with_permission` para versão da migration 035 (sem `DASHBOARD_VIEW`).
    - Não dropa os 3 índices auxiliares (`idx_users_created_at`/`idx_fretes_created_at`/`idx_fretes_updated_at_status`) porque podem servir a outras consultas; comenta a opção de drop manual.
    - **Não** é auto-aplicado; serve como referência para recovery.
    - _Requirements: 14.10_

- [x] 2. Permission_Matrix update e tipos puros do service
  - [x] 2.1 Atualizar `src/services/admin/permissions.ts`
    - Adicionar à enum `AdminAction` o valor `'DASHBOARD_VIEW'`.
    - Atualizar `SUPORTE_PERMS` para incluir `DASHBOARD_VIEW`.
    - Atualizar `FINANCEIRO_PERMS` para incluir `DASHBOARD_VIEW`.
    - `MODERADOR_PERMS` permanece **sem** `DASHBOARD_VIEW`.
    - `ADMIN` ganha automaticamente (não está em `ADMIN_DENY`).
    - `SUPER_ADMIN` ganha automaticamente (matrix retorna sempre `true`).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 2.2 Criar `src/services/admin/dashboard.ts` parte 1 — tipos públicos
    - `DashboardPeriodPreset = 'today' | '7d' | '30d' | 'custom'`.
    - `DashboardUserType = 'all' | 'motorista' | 'embarcador'`.
    - `UF_BR` constante array com 27 UFs + `type UF`.
    - `DashboardFilters` interface com `period`, `from`, `to`, `userType`, `uf`.
    - `DEFAULT_DASHBOARD_FILTERS` constante exportada com `{ period: '7d', from: null, to: null, userType: 'all', uf: null }`.
    - `DashboardKPI`, `DashboardSeriesPoint`, `DashboardGeoBucket`, `DashboardSecurityAlert`, `DashboardTopListItem`, `DashboardMetricsBundle` (com sub-objetos exatamente como schema de design §3.3, mapeando snake_case → camelCase no `adaptBundle`).
    - `DashboardBlockKey = 'kpis'|'cadastros'|'fretes'|'volume'|'geo'|'security_alerts'|'top_embarcadores'|'top_motoristas'|'top_rotas'`.
    - Classe `DashboardServiceError extends Error` com 7 codes em `DashboardErrorCode`: `PERMISSION_DENIED`, `INVALID_PERIOD`, `INVALID_USER_TYPE`, `INVALID_UF`, `TIMEOUT`, `NETWORK`, `UNKNOWN`. Cada erro pode carregar `extra: Record<string, unknown>`.
    - Tabela de mensagens UI (pt-BR) por code, exportada como `DASHBOARD_ERROR_MESSAGES`.
    - _Requirements: 1.6, 2.2, 9.4, 16.9_

  - [x] 2.3 Helpers puros e testáveis
    - `resolvePeriod(filters, now?): { from: ISOString, to: ISOString }` — regras de design §4.2 (presets `today`/`7d`/`30d` calculam relativo a `now`; `custom` usa `from + 'T00:00:00Z'` / `to + 'T23:59:59Z'`).
    - `computeDelta(value, previous): { deltaPct: number | null, deltaDirection: 'up'|'down'|'flat' }` — null quando `previous === 0`; direção via thresholds `±0.1%`.
    - `formatBRL(n)`, `formatNumber(n)`, `formatDate(iso)` via `Intl.NumberFormat('pt-BR')`.
    - `describePeriod(filters): string` — produz `Hoje`, `Últimos 7 dias`, `Últimos 30 dias` ou `dd/MM/yyyy a dd/MM/yyyy`.
    - `resolveAlertLabel(action): { label: string; severity: 'info'|'warn'|'high' }` — pt-BR por action conforme design §4.2.
    - `UF_CENTROIDS: Record<UF, [number, number]>` constante com 27 entradas (coordenadas aproximadas de centroide por UF).
    - _Requirements: 3.2, 3.3, 3.4, 4.5, 5.3, 6.4, 12.9, 12.10_

  - [x] 2.4 URL ↔ filtros round-trip
    - `parseFiltersFromQuery(qs: URLSearchParams): DashboardFilters` — defaults aplicados a valores ausentes/inválidos; valida domínio fechado de `period`/`userType`/`uf`; valida `from`/`to` em formato ISO date `YYYY-MM-DD`. Quando `period !== 'custom'`, ignora `from`/`to`.
    - `serializeFiltersToQuery(f: DashboardFilters): URLSearchParams` — omite valores default (period='7d', userType='all', uf=null) para URL limpa.
    - _Requirements: 1.7, 1.8, 1.9, 2.7_

  - [ ]* 2.5 Property test CP-3 (computeDelta idempotente) em `src/__tests__/admin/dashboard/cp3ComputeDelta.property.test.ts`
    - **Property CP-3: computeDelta é função pura**
    - Para todo par `(value, previous) ∈ [0, 1_000_000]²`, `computeDelta(value, previous) === computeDelta(value, previous)`. Inclui edge cases `previous=0`, `value=0`, `value=previous` (delta=0).
    - **Validates: Requirements 3.2, 3.3, 3.4**

- [x] 3. Service core: `getMetrics` + `exportCSV` (`dashboard.ts` parte 2)
  - [x] 3.1 `getMetrics(filters: DashboardFilters): Promise<DashboardMetricsBundle>`
    - Resolve `(p_from, p_to)` via `resolvePeriod(filters)`.
    - Invoca RPC `supabase.rpc('admin_dashboard_metrics', { p_from, p_to, p_user_type: filters.userType, p_uf: filters.uf })`.
    - Aplica `Promise.race` com timeout 10s (lança `DashboardServiceError('TIMEOUT')` se exceder).
    - Mapeia erros Postgres → `DashboardErrorCode`: mensagem contém `permission_denied` ⇒ `PERMISSION_DENIED`; começa com `INVALID_PERIOD` / `INVALID_USER_TYPE` / `INVALID_UF` ⇒ code correspondente; demais ⇒ `UNKNOWN`.
    - Chama `adaptBundle(raw)` que: (a) mapeia snake_case do jsonb → camelCase do TS; (b) computa `deltaPct`/`deltaDirection` de cada KPI via `computeDelta`; (c) preenche `bundle.errors[bloco] = 'Bloco indisponível.'` quando algum sub-objeto vem `null` ou inconsistente.
    - **Não** aplica cache (cache fica no `Dashboard_Page` via `useMemo(cacheKey)`).
    - _Requirements: 9.4, 9.6, 9.7, 11.6_

  - [x] 3.2 `exportCSV(filters, perms): Promise<{ csv: string; filename: string; truncated: boolean }>`
    - Re-fetch via `getMetrics(filters)` para snapshot fresco.
    - Achata o bundle em linhas `secao;chave;valor;valor_anterior;variacao_pct` conforme design §4.4.
    - Aplica gating client-side: omite KPIs / séries / blocos que requerem `FINANCEIRO_VIEW` ou `AUDIT_VIEW` quando `perms` não autoriza (defesa-em-profundidade — RPC já omitiu, mas reforço client-side em caso de admin com `DASHBOARD_VIEW` fazer export incluindo blocos parciais).
    - Trunca em 10000 linhas (incluindo cabeçalho).
    - Gera CSV com BOM UTF-8 + separador `;` + escape RFC 4180 + `\r\n`.
    - Filename: `dashboard_<from>_a_<to>.csv` (datas YYYY-MM-DD).
    - Chama `logAdminAction({ action: 'DASHBOARD_EXPORTED', after: { filters: { ...filters, resolved }, kpis_count, series_count, total_rows, requested_limit: 10_000, omitted_blocks?, truncated? } })` — best-effort com `try/catch` e `console.error` em falha; **não bloqueia** o retorno.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [ ]* 3.3 Property test CP-4 (RPC retorna jsonb com schema estável) em `src/__tests__/admin/dashboard/cp4SchemaStability.property.test.ts`
    - **Property CP-4: schema do retorno da RPC é estável**
    - Integração: gated por env var `RUN_SUPABASE_INTEGRATION=1`; em ambiente local conectado ao Supabase, executa `admin_dashboard_metrics` com filtros aleatórios e valida que o jsonb tem todas as chaves obrigatórias (`meta`, `kpis`, `series`, `geo`, `security_alerts`, `top_embarcadores`, `top_motoristas`, `top_rotas`) e que os tipos batem com o schema de design §3.3. Skipa silenciosamente quando a env var não está setada.
    - **Validates: Requirements 14.6, 14.7**

- [x] 4. KPIs cards
  - [x] 4.1 `src/components/admin/dashboard/DashboardKpiCard.tsx`
    - Props: `label`, `kpi: DashboardKPI | null`, `formatter`, `link?`, `ariaSuffix?`, `invertColors?: boolean` (para alertas onde `up` = vermelho).
    - Quando `kpi === null`, retorna `null` (omissão server-side).
    - Renderiza: label compacto (`text-[10px] uppercase tracking-wider text-gray-500`), valor (`text-lg font-semibold` em desktop, `text-base` em mobile), badge de variação (`▲ +X,X%` verde / `▼ -X,X%` vermelho / `= 0%` cinza, ou `Novo` quando `previousValue === 0 && value > 0`, ou `—` quando ambos zero).
    - `role="region"` + `aria-label` agregando label + valor + variação.
    - Quando `link` definido, envolve em `<Link>` com hover state (`border-cyan-700`).
    - Foco navegável por teclado (`focus:ring-2 focus:ring-cyan-700`).
    - _Requirements: 3.2, 3.3, 3.4, 12.2, 12.9, 12.10, 13.5_

  - [x] 4.2 `src/components/admin/dashboard/DashboardKpiGrid.tsx`
    - Props: `bundle?`, `loading: boolean`, `error?`, `onRetry: () => void`.
    - Quando `loading=true`, renderiza 6-9 `DashboardBlockSkeleton` em grid `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`.
    - Quando `error` ou `bundle.errors.kpis`, renderiza `DashboardBlockError` com `onRetry`.
    - Caso contrário, renderiza 9 `DashboardKpiCard`:
      - "Usuários ativos" → link `/admin/users?status=ativo&...`.
      - "Novos cadastros" (label dinâmico: `Cadastros 24h` quando `period='today'`, `Cadastros 7d`, `Cadastros 30d`, `Cadastros no período`) → link `/admin/users?from=...&to=...`.
      - "Fretes ativos" → link `/admin/fretes?status=ativo&uf=...`.
      - "Fretes postados (período)" → link `/admin/fretes?from=...&to=...`.
      - "Fretes encerrados (período)" → link `/admin/fretes?status=encerrado&from=...&to=...`.
      - "Taxa de conversão" → sem link; valor `XX,X%` ou `—` quando null.
      - "Volume transacionado" (gated FINANCEIRO_VIEW) → link `/admin/financeiro?...` ou `/admin/fretes?status=encerrado` se rota financeiro não existe.
      - "Logins admin" (gated AUDIT_VIEW) → link `/admin/audit?action=ADMIN_LOGIN_SUCCESS&...`.
      - "Alertas de segurança 24h" (gated AUDIT_VIEW, `invertColors=true`) → link `/admin/audit?action=ADMIN_LOGIN_FAILURE&...`.
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 9.1, 9.5_

- [x] 5. Gráficos de tendência
  - [x] 5.1 `src/components/admin/dashboard/DashboardTrendChart.tsx`
    - Props: `series: { name, color, points }[]`, `formatter?`, `height?` (default 192), `ariaLabel`, `showAsTable: boolean`, `onToggleTable: () => void`, `emptyMessage?`.
    - Quando `showAsTable=true`, renderiza `<table>` com `<caption class="sr-only">{ariaLabel}</caption>` e colunas `Data | Série A | Série B...`.
    - Quando `showAsTable=false`, renderiza `<svg role="img">` com `<title>{ariaLabel}</title>`:
      - Computa eixo Y: max global de todos os `points.value`. Renderiza 4 ticks (0, max/3, 2max/3, max) em texto formato `formatter`.
      - Computa eixo X: até 7 labels uniformes do array de `points[0]` (formato `dd/MM`).
      - Para cada série, desenha 1 `<path d="M... L... L...">` (linha) + 1 `<path d="M... L... L... Z">` com `fill={color}` `fill-opacity="0.1"` (área).
      - Em hover sobre o SVG, computa o índice mais próximo e renderiza `<circle>` destacado + `<div>` tooltip absoluto com `dd/MM/yyyy` + valor formatado por série.
    - Quando todos os pontos têm `value === 0`, renderiza apenas mensagem `emptyMessage ?? 'Sem dados no período.'`.
    - `~80 linhas TSX puras, zero deps externas`.
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 12.3, 13.3_

  - [x] 5.2 Wiring dos 3 gráficos no `Dashboard_Page`
    - Bloco `Cadastros novos por dia`: passa `series=[{name:'motoristas',color:'#3b82f6',points:bundle.series.cadastrosMotoristas},{name:'embarcadores',color:'#f97316',points:bundle.series.cadastrosEmbarcadores}]`. Quando `userType='motorista'`, esconde série `embarcadores` (e vice-versa).
    - Bloco `Fretes postados vs encerrados por dia`: `series=[{name:'postados',color:'#22c55e',points:bundle.series.fretesPostados},{name:'encerrados',color:'#9ca3af',points:bundle.series.fretesEncerrados}]`.
    - Bloco `Volume transacionado por dia` (gated FINANCEIRO_VIEW): `series=[{name:'volume',color:'#0891b2',points:bundle.series.volumeDiario}]`, `formatter=formatBRL`.
    - Cada bloco tem state local `showAsTable: boolean` controlado pelo toggle interno.
    - Cada bloco isola erro: quando `bundle.series.<key>` ausente / null, renderiza `DashboardBlockError` próprio.
    - _Requirements: 4.1, 4.2, 4.3, 4.10, 9.5_

- [x] 6. Mapa geográfico
  - [x] 6.1 `src/components/admin/dashboard/DashboardGeoMap.tsx`
    - Props: `geo: { fretesAtivos, usuariosAtivos }`, `onError?`.
    - State local: `mode: 'fretes' | 'usuarios'` (default `'fretes'`); `showAsTable: boolean`.
    - Toggle group no topo do bloco com `Fretes ativos` / `Usuários ativos`.
    - Botão `Mostrar como tabela` à direita do toggle (`text-[10px]`).
    - Quando `showAsTable=false`:
      - `<MapContainer center={BR_CENTER} zoom={4} className="h-80" scrollWheelZoom={false}>`.
      - `<TileLayer>` OpenStreetMap (mesma URL e attribution já usadas em `MapaFretes.tsx`).
      - Para cada bucket em `mode === 'fretes' ? geo.fretesAtivos : geo.usuariosAtivos`:
        - `<Circle center={UF_CENTROIDS[uf]} radius={Math.sqrt(count) * 30000} pathOptions={{ color: '#0891b2', fillOpacity: 0.4 }}>`.
        - Inside: `<Popup>` com nome UF + breakdown + link `Ver detalhes` para `/admin/fretes?uf=<uf>` ou `/admin/users?uf=<uf>` conforme modo.
    - Quando `showAsTable=true`, renderiza `<table>` com colunas `UF | Fretes ativos | Motoristas | Embarcadores`, ordenada por contagem decrescente do modo selecionado.
    - Quando `geo.fretesAtivos.length === 0 && geo.usuariosAtivos.length === 0`, sobrepõe mensagem `Sem dados geográficos no período.` no mapa.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 12.4, 13.4_

- [x] 7. Alertas de segurança
  - [x] 7.1 `src/components/admin/dashboard/DashboardSecurityAlerts.tsx`
    - Props: `alerts?: DashboardSecurityAlert[]`, `error?`, `onRetry`.
    - Componente é renderizado apenas quando admin tem `AUDIT_VIEW` (gating no `Dashboard_Page`); este componente assume permissão e não duplica check.
    - Quando `alerts` é `null`/`undefined` (server-side gating), retorna `null`.
    - Quando `error`, renderiza `DashboardBlockError`.
    - Quando `alerts.length === 0`, renderiza `Nenhum alerta nas últimas 24 horas.` com ícone check verde + `role="status"`.
    - Caso contrário, renderiza lista vertical de até 10 itens com:
      - Ícone por severidade (`info` cinza, `warn` amarelo, `high` vermelho) — SVG inline.
      - Label resolvido via `resolveAlertLabel(action)`.
      - Badge `× N` quando `count > 1`.
      - Timestamp relativo via helper `formatRelativeTime(iso)` (`há 5 min`, `há 2h`, `ontem 14:30`, `dd/MM HH:mm` para >7 dias).
      - Cada item é `<Link>` para `/admin/audit?action=<action>&from=<24h_ago>`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 8. Top listas
  - [x] 8.1 `src/components/admin/dashboard/DashboardTopList.tsx`
    - Props: `title: string`, `items?: DashboardTopListItem[]`, `error?`, `onRetry`, `emptyMessage?`.
    - Quando `items === null`, retorna `null` (gating server-side).
    - Quando `error`, renderiza `DashboardBlockError`.
    - Quando `items.length === 0`, renderiza `emptyMessage ?? 'Sem dados no período.'`.
    - Caso contrário, renderiza card com título + lista numerada (`1.`, `2.`, ..., `5.`):
      - Cada linha: `<Link to={item.link}>` com `name` (`text-sm font-medium`), `primaryLabel` (à direita, valor), `secondary` (text-xs cinza abaixo).
    - _Requirements: 7.8, 7.9_

  - [x] 8.2 Wiring dos 3 top lists no `Dashboard_Page`
    - `Top embarcadores` (gated FINANCEIRO_VIEW):
      - `items` mapeado de `bundle.topEmbarcadores.items` para `{ id, name, primaryValue: volume_total, primaryLabel: formatBRL(volume_total), secondary: '<N> fretes encerrados', link: '/admin/users/<id>' }`.
    - `Top motoristas`:
      - `items` mapeado de `bundle.topMotoristas.items` para `{ id, name, primaryValue: total, primaryLabel: '<N> interações', secondary: '<C> cliques • <L> curtidas', link: '/admin/users/<id>' }`.
    - `Top rotas`:
      - `items` mapeado de `bundle.topRotas.items` para `{ id: '<origin>::<destination>', name: label, primaryValue: count, primaryLabel: '<N> fretes', secondary: undefined, link: '/admin/fretes?q=<origin>' }`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 9. Filtros + URL + skeleton/error helpers
  - [x] 9.1 `src/components/admin/dashboard/DashboardFilterPopover.tsx`
    - Padrão herdado de `UsersFilters.tsx`/`FretesFilters.tsx`/`BlacklistFilters.tsx`: botão de ícone (`SlidersHorizontal`) abre popover compacto.
    - Conteúdo do popover:
      - Dropdown `Período` com 4 opções (`Hoje`, `7 dias`, `30 dias`, `Customizado`).
      - Quando `Customizado` selecionado: 2 inputs `<input type="date">` `from`/`to` lado a lado.
      - Dropdown `Tipo de usuário` com 3 opções.
      - Dropdown searchable `UF` com 27 UFs + `Todas` (ordenado alfabeticamente).
    - Validação client-side:
      - `period === 'custom'` E `from > to` ⇒ erro inline `Data inicial deve ser menor ou igual à final.`. Botão `Aplicar` desabilitado.
      - `period === 'custom'` E `(to - from) > 365 days` ⇒ erro `Período máximo de 365 dias.`. Botão `Aplicar` desabilitado.
    - Debounce 300ms entre mudança e callback `onChange`.
    - `role="dialog"`, `aria-modal="false"`, `Esc` fecha o popover.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 12.7, 16.2_

  - [x] 9.2 `src/components/admin/dashboard/DashboardFilterModalMobile.tsx`
    - Em viewport `<768px`, substitui o popover por modal full-screen.
    - Mesmos campos que o popover.
    - Botões `Aplicar` (cyan) e `Cancelar` (transparente) fixos no rodapé.
    - `role="dialog"`, `aria-modal="true"`, foco inicial no primeiro campo, `Esc` fecha.
    - Cancelar descarta mudanças; Aplicar dispara `onChange(filters)`.
    - _Requirements: 2.8, 2.9, 12.8, 13.2, 13.6_

  - [x] 9.3 `src/components/admin/dashboard/DashboardBlockSkeleton.tsx`
    - Bloco com placeholder cinza animado (`animate-pulse`).
    - `aria-busy="true"` + `aria-live="polite"` no container raiz.
    - Aceita prop `height?` (default `h-32`).
    - _Requirements: 9.1, 9.2, 12.5_

  - [x] 9.4 `src/components/admin/dashboard/DashboardBlockError.tsx`
    - Bloco com ícone `⚠`, mensagem `Dados indisponíveis`, botão `Tentar novamente` que dispara `onRetry`.
    - `role="alert"`.
    - Aceita prop `message?` para mensagens específicas.
    - _Requirements: 9.4, 9.7, 12.6_

  - [x] 9.5 `src/components/admin/dashboard/DashboardTopBar.tsx`
    - Barra superior com:
      - Esquerda: contador `Período: <descricao>` via `describePeriod(filters)`.
      - Direita: botões `Atualizar` (`onRefresh`), filtros (`<DashboardFilterPopover>` ou `<DashboardFilterModalMobile>` conforme breakpoint), `Exportar CSV` (`onExport`).
    - Botões com classes compactas `text-xs px-2.5 py-1`.
    - Em viewport `<768px`, stack vertical (linha 1 contador, linha 2 botões).
    - Botão `Exportar CSV` desabilitado quando `canExport=false` (durante loading) com tooltip `Aguarde os dados carregarem.`.
    - _Requirements: 1.5, 13.7, 13.8, 16.2_

- [x] 10. Página `Dashboard_Page` + wiring
  - [x] 10.1 Substituir `src/pages/admin/AdminDashboardPage.tsx`
    - Remove o placeholder atual (3 cards estáticos).
    - State: `filters` (inicializado de `parseFiltersFromQuery`), `refreshKey` (number), `state: { status: 'loading'|'ready'|'error', bundle?, error? }`.
    - `useAdminPermission('DASHBOARD_VIEW')` ⇒ se ausente, retorna `<Stealth404 />`.
    - `useAdminPermission('FINANCEIRO_VIEW')` e `useAdminPermission('AUDIT_VIEW')` para gating client-side dos blocos sensíveis.
    - `useMemo(cacheKey)` em `JSON.stringify({ filters, refreshKey })`.
    - `useEffect([cacheKey])` chama `getMetrics(filters)`; flag `cancelled` evita resposta obsoleta após troca de filtros.
    - `useEffect([filters])` sincroniza URL via `setSearchParams(serializeFiltersToQuery(filters), { replace: true })`.
    - `onRefresh = () => setRefreshKey(k => k + 1)`.
    - `onExport = () => exportCSV(filters, { hasFinanceiro, hasAudit }).then(downloadBlob)`.
    - Layout grid responsivo: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3`.
    - Cada bloco isola erro próprio (CP-2): `bundle.errors[bloco]` → `DashboardBlockError` correspondente.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.10, 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.7, 11.4, 11.5, 11.7, 13.1, 13.5_

  - [x] 10.2 Atualizar `src/components/admin/AdminSidebar.tsx`
    - Adicionar `permission: 'DASHBOARD_VIEW'` ao `MenuItem` de Dashboard (caso ainda não esteja gated).
    - Item permanece `to: '/admin'` com `end: true`.
    - Quando MODERADOR está logado, item Dashboard NÃO aparece no sidebar (gating já aplicado pelo `MenuLink`).
    - _Requirements: 10.7, 16.5_

  - [x] 10.3 Helper `downloadBlob(csv, filename)` em `src/services/admin/dashboard.ts`
    - Cria `Blob([csv], { type: 'text/csv;charset=utf-8' })`, `URL.createObjectURL`, `<a download={filename}>` programático, `URL.revokeObjectURL` após click.
    - _Requirements: 8.1, 8.2_

  - [ ]* 10.4 Test de roteamento em `src/__tests__/admin/dashboard/routing.test.tsx`
    - Garante que `/admin` casa com `AdminDashboardPage` (substituto do placeholder), e que rota é gated por `AdminGuard` com check de `DASHBOARD_VIEW`.
    - Smoke test simples (mount com mock de `AdminProvider`).

- [x] 11. Property tests obrigatórios
  - [x] 11.1 Property test CP-1 (KPI determinístico) em `src/__tests__/admin/dashboard/cp1KpiDeterministic.property.test.ts`
    - **Property CP-1: getMetrics é determinística para o mesmo input + mesmo banco**
    - Para todo `(filters, dataset)` válido, executar `setupMockSupabase(dataset)` e chamar `getMetrics(filters)` duas vezes consecutivas (sem mutações intermediárias). Comparar resultados via `stripVolatile` (descartando `meta.generatedAt` e `kpis.alertasSeguranca24h.value` que dependem de `NOW()` para janela de 24h dinâmica).
    - Geradores fast-check: `arbDashboardFilters` (cobrindo 4 presets, todos `userType`, `uf` ∈ `UF_BR ∪ {null}`); `arbDataset` (gera arrays mockados de `users`/`embarcadores`/`fretes`/`frete_clicks`/`frete_likes`/`admin_audit_logs` cobrindo edge cases: zero rows, 1 row, N=100 rows, dados em UFs diferentes, dados fora do período).
    - Mock do `supabase.rpc('admin_dashboard_metrics', ...)` retorna jsonb computado em-memória pelo mock seguindo a mesma lógica de agregação da RPC SQL (CTE-by-CTE em TypeScript). Este é o ponto delicado: o mock precisa ser determinístico (sem `Math.random`, sem `Date.now()` fora dos `p_from`/`p_to`).
    - Falhas que CP-1 captura: ordenação instável em top lists, off-by-one em zero-fill de séries, uso indevido de `now()` dentro de agregações de período.
    - **Validates: Requirements 11.1, 11.2, CP-1**

  - [x] 11.2 Property test CP-2 (degradação parcial) em `src/__tests__/admin/dashboard/cp2PartialDegradation.property.test.ts`
    - **Property CP-2: bloco corrompido não derruba os demais**
    - Para todo `(bundle, blockToFail)` onde `bundle` é um `DashboardMetricsBundle` válido e `blockToFail ∈ DashboardBlockKey`:
      - Construir `corrupted = corruptBlock(bundle, blockToFail)` que substitui o sub-objeto correspondente por `null` ou injeta erro em `bundle.errors[blockToFail]`.
      - Renderizar `<AdminDashboardPage initialBundle={corrupted} />` (testes usam fixture inicial em vez de RPC real, via prop de teste ou contexto de mock).
      - Asserções:
        - O bloco `[data-block="<blockToFail>"]` exibe `role="alert"` (= `DashboardBlockError`).
        - Os demais blocos NÃO exibem `role="alert"`, exceto blocos que estão server-side null por gating de permissão (esses são omitidos e não têm `data-block` no DOM).
        - Nenhuma exceção propaga para o `ErrorBoundary` global do app.
      - Geradores: `arbBundle` (todos os sub-objetos populados com `arbInteger`/`arbString`/`arbISODate`); `arbBlockKey` (amostra uniforme dos 9 blocks).
    - Cada bloco renderiza via wrapper que aceita `initialBundle` por prop (test-only) ou via mock de `getMetrics`.
    - Cada bloco tem `data-block="<key>"` no container raiz para facilitar query.
    - **Validates: Requirements 9.5, 9.7, 16.6, CP-2**

- [x] 12. Checkpoint final
  - [x] 12.1 Aplicar migration `036_admin_dashboard.sql` em Supabase de desenvolvimento
    - Executar via psql ou Supabase Studio.
    - Rodar bloco `-- VERIFY` (descomentado pontualmente) e validar todos os SELECTs retornando esperado.
    - Smoke manual: SUPER_ADMIN logado, abrir `/admin`, ver dashboard com dados reais.
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 14.9_

  - [x] 12.2 Rodar suíte de testes
    - `npx tsc --noEmit` ⇒ zero erros.
    - `npx vitest --run` ⇒ todas as suítes verdes (opcionais skipadas se não implementadas; obrigatórias 11.1 CP-1 e 11.2 CP-2 verdes).
    - `npm run lint` ⇒ zero warnings.
    - `npm run build` ⇒ build limpa.

  - [ ]* 12.3 Roteiro E2E manual em `docs/admin-dashboard-e2e.md`
    - Sequência: aplicar migration 036 → login SUPER_ADMIN → abrir `/admin` (KPIs, gráficos, mapa, alertas, tops carregam) → mudar período para `30 dias` (todos blocos atualizam) → mudar `userType=motorista` (séries de embarcador some, top embarcadores some) → selecionar UF SP (mapa zoom, KPIs filtrados) → clicar em alerta de segurança (navega para `/admin/audit?action=...`) → clicar em top embarcador (navega para `/admin/users/<id>`) → exportar CSV (download dispara, audit log gravado).
    - Casos negativos: MODERADOR navegando para `/admin` ⇒ `Stealth_404`; SUPORTE em `/admin` ⇒ vê todos blocos exceto `Volume`/`Top embarcadores`/`Volume diário` (omitidos server-side); admin com `DASHBOARD_VIEW` mas RPC retorna `INVALID_PERIOD` (período > 365 dias) ⇒ erro tipado e UI exibe mensagem do `DASHBOARD_ERROR_MESSAGES`; bloco `geo` corrompido (mock força null) ⇒ apenas mapa exibe `Dashboard_Block_Error`, demais blocos OK.

  - [x] 12.4 Checkpoint final
    - `npx tsc --noEmit` zero erros.
    - `npm run build` limpa.
    - `npx vitest --run` obrigatórias verdes (11.1 CP-1 e 11.2 CP-2).
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, roteiros manuais e docs auxiliares). O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Sub-tasks 11.1 (CP-1, KPI determinístico) e 11.2 (CP-2, degradação parcial) **NÃO** levam asterisco — são property tests obrigatórios e bloqueiam merge conforme `requirements.md` § Padrões de Sucesso e `design.md` §13.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N) e os requisitos que ela valida.
- Migration 036 inclui rollback paralelo (`036_admin_dashboard_rollback.sql`) que documenta DROP da função `admin_dashboard_metrics` e reversão de `is_admin_with_permission` para a versão da migration 035, sem auto-aplicação. Os 3 índices auxiliares são preservados no rollback.
- Padrões herdados sem modificação: `AdminProvider`/`AdminGuard`/`AdminShell`/`AdminSidebar` (admin-foundation), `executeAdminMutation`/`logAdminAction` + audit-by-construction (admin-foundation), CSV BOM UTF-8 + `;` + RFC 4180 + truncamento 10000 (admin-users/admin-blacklist), padrão compacto pós-cleanup com filtros em popover via botão de ícone (`UsersListPage`/`FretesListPage`/`BlacklistListPage`), padrão de degradação parcial em fetch agregado (`getUserDetail`/`getBlacklistDetail`), `Stealth404` para acessos sem permissão.
- O item `Dashboard` no `AdminSidebar` já existe e aponta para `/admin`; esta spec apenas garante que ele esteja gated por `DASHBOARD_VIEW`.
- **Zero novas dependências npm**: gráficos são SVG inline puros; mapa reusa `leaflet` `^1.9.4` + `react-leaflet` `^4.2.1` já presentes em `package.json`.
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.

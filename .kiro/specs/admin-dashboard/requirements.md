# Requirements Document: admin-dashboard

## Introduction

Esta spec entrega o **módulo de Dashboard Analítico** do painel administrativo do FreteGO. Sobre as fundações já em produção — `admin-foundation` (RBAC, MFA, audit-by-construction, sessão isolada, `Stealth_404`, RPC `is_admin_with_permission`, padrão `executeAdminMutation`, migration 030), `admin-users` (gestão de usuários, ban, padrão de bulk + CSV BOM UTF-8 + `;` + RFC 4180, migration 031), `admin-fretes` (gestão de fretes, padrão de skip idempotente, migration 032), `embarcador-branch` (`embarcadores.branch_state` UF, migration 033) e `admin-blacklist` (lista negra, RPCs `is_blacklisted` / `log_blacklist_block`, migration 035) — este módulo substitui o `AdminDashboardPage` placeholder por um dashboard analítico real, ponto central de observabilidade do FreteGO.

Resumo do escopo:

1. **KPIs principais** em cards compactos com totais e variação percentual vs. período anterior:
   - Usuários ativos (motoristas + embarcadores), novos cadastros 24h/7d/30d.
   - Fretes ativos, fretes postados (período), fretes encerrados, taxa de conversão (postados → encerrados).
   - Volume bruto transacionado (sum de `fretes.value` em fretes encerrados no período) — gated por `FINANCEIRO_VIEW`.
   - Total de logins admin no período e alertas de segurança 24h (login_failed, blacklist_block, mfa_failed, sessões expiradas) — gated por `AUDIT_VIEW`.
2. **Filtros globais** no topo da página em popover compacto (padrão herdado dos cleanups recentes em `UsersListPage` e `FretesListPage`):
   - Período: `hoje`, `7 dias`, `30 dias`, `customizado` com inputs `from`/`to`.
   - Tipo de usuário: `todos`, `motoristas`, `embarcadores`.
   - UF: dropdown searchable de estados brasileiros.
   - Filtros aplicam a TODOS os KPIs, gráficos, mapa e listas top abaixo, sincronizados com query params na URL.
3. **Gráficos de tendência** (line/area por dia, séries SVG renderizadas in-house — sem dependência nova):
   - Cadastros novos por dia (motoristas vs. embarcadores em séries separadas).
   - Fretes postados vs. encerrados por dia.
   - Volume transacionado por dia — gated por `FINANCEIRO_VIEW`.
4. **Distribuição geográfica** (mapa com pins agregados por estado):
   - Reusa `Leaflet` / `react-leaflet` já presentes no projeto.
   - Toggle `Fretes ativos` / `Usuários ativos` decide o que é agregado.
   - Cada estado tem círculo proporcional à contagem; clicar abre popup com breakdown.
5. **Alertas de segurança recentes** — top 10 eventos de `admin_audit_logs` em 24h: `ADMIN_LOGIN_FAILURE`, `BLACKLIST_LOGIN_BLOCKED`, `BLACKLIST_SIGNUP_BLOCKED`, `BLACKLIST_EMAIL_BLOCKED`, `ADMIN_MFA_VERIFY` (falhas), `ADMIN_STEALTH_BLOCK`, `USER_BANNED`. Cada item navegável para `/admin/audit?filter=...`. Gated por `AUDIT_VIEW`.
6. **Top listas** — cards com top 5 do período:
   - Top embarcadores por volume de fretes postados (gated por `FINANCEIRO_VIEW` adicional).
   - Top motoristas por interações (`frete_clicks` + `frete_likes`).
   - Top rotas mais comuns (origem→destino agregado).
7. **Export do dashboard** — botão `Exportar relatório CSV` com snapshot dos KPIs e séries do período. CSV padrão admin (BOM UTF-8 + `;` + RFC 4180). Audit log `DASHBOARD_EXPORTED` com filtros aplicados. Limite 10000 linhas.
8. **Loading states e degradação parcial** — skeleton em cada card durante carga. Cada bloco (KPIs, gráficos, mapa, alertas, top listas) isola seu erro próprio (degradação parcial herdada do padrão `getUserDetail` / `getBlacklistDetail`). Fallback de gráficos exibe `Dados indisponíveis` quando o bloco falha.
9. **Permissões**:
   - `DASHBOARD_VIEW` é nova action; SUPER_ADMIN, ADMIN, SUPORTE, FINANCEIRO ganham; MODERADOR não.
   - Blocos sensíveis (volume transacionado, top embarcadores) gated por `FINANCEIRO_VIEW` adicional.
   - Alertas de segurança gated por `AUDIT_VIEW`.
   - Quando admin não tem `DASHBOARD_VIEW` → `Stealth_404`.
10. **Performance** — RPC única `admin_dashboard_metrics(p_from, p_to, p_user_type, p_uf)` que retorna `jsonb` com TODOS os KPIs e séries em uma única chamada server-side. Cache no client com `useMemo` por `key = JSON.stringify(filtros)`. Debounce 300ms em mudanças de filtro.
11. **Acessibilidade** — cada card com `role="region"` + `aria-label`. Gráficos com tabela alternativa via toggle `Mostrar como tabela` (texto-only fallback). Foco navegável por teclado entre cards. `aria-live="polite"` no container de skeleton.
12. **Mobile** — stack vertical em `<768px`. Gráficos responsivos com altura fixa (`h-48`). Filtros viram modal full-screen no mobile.

A stack continua TypeScript + React + Vite + TailwindCSS + Supabase + Vitest + fast-check + Leaflet (já presentes). Esta spec adiciona a migration `036_admin_dashboard.sql`, novo serviço `src/services/admin/dashboard.ts`, novos componentes em `src/components/admin/dashboard/`, e substitui o placeholder em `src/pages/admin/AdminDashboardPage.tsx`. **Nenhuma nova dependência npm** é introduzida — gráficos são desenhados em SVG inline puro; mapa reusa `leaflet` + `react-leaflet` (versões `^1.9.4` / `^4.2.1` já em `package.json`).

**Fora de escopo desta spec** (vão para outras specs já planejadas):

- `admin-suporte`: workflow de tickets de atendimento (alertas só apontam para `/admin/audit`).
- `admin-crm`: comunicação ativa com usuários (top embarcadores apenas mostra ranking, não ações de CRM).
- Realtime updates dos KPIs — pull-only com refresh manual via botão `Atualizar`.
- Alertas configuráveis com thresholds — apenas leitura agregada; configuração de alertas fica para spec futura `admin-alerts`.
- Drill-down profundo em cada KPI (cliques em "novos cadastros 24h" levam para `/admin/users` com filtro pré-aplicado, mas não há agregações intermediárias dentro do dashboard).
- Métricas baseadas em `frete_clicks` agregadas por hora/minuto — granularidade mínima é dia.
- Gráficos comparativos multi-período arbitrários (apenas `período atual` vs. `período anterior` automaticamente derivado).
- Export em PDF — apenas CSV nesta spec.
- I18n — strings hardcoded em pt-BR.

## Glossary

- **Admin_Panel**: Painel administrativo já entregue em `admin-foundation`, acessível em `/admin/*`.
- **AdminGuard**: Componente que envolve rotas `/admin/*` e cai em `Stealth_404` se sessão admin inválida ou sem permissão (entregue em `admin-foundation`).
- **AdminShell**: Layout do painel com sidebar + topbar (entregue em `admin-foundation`).
- **AdminProvider**: Provider de contexto admin (entregue em `admin-foundation`).
- **Stealth_404**: Página 404 visualmente idêntica à 404 padrão do app, renderizada para acessos não autorizados a `/admin/*` (entregue em `admin-foundation`).
- **Permission_Matrix**: Matriz determinística `(AdminRole, AdminAction) → boolean` em `src/services/admin/permissions.ts`.
- **executeAdminMutation**: Helper em `src/services/admin/audit.ts` que executa uma mutação admin sempre acompanhada de audit log, com rollback-log em caso de falha (entregue em `admin-foundation`).
- **logAdminAction**: Helper em `src/services/admin/audit.ts` que registra um audit log isolado (sem mutação acoplada). Esta spec usa apenas em `exportCSV`.
- **is_admin_with_permission**: Função SQL `STABLE SECURITY DEFINER` que reproduz a `Permission_Matrix` no banco para reforço de RLS e gating de RPCs (entregue em 030, atualizada em 031, 032 e 035).
- **Master_Admin**: Super_Admin com `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique). Imutável em todas as operações admin (entregue em `admin-users`).
- **Dashboard_Page**: Componente substituto de `src/pages/admin/AdminDashboardPage.tsx`, montado em rota `/admin` (rota índice do painel).
- **Dashboard_Service**: Novo serviço em `src/services/admin/dashboard.ts` que centraliza as operações da spec.
- **Dashboard_Filters**: Estrutura de filtros globais aplicada a todos os blocos:
  ```ts
  {
    period: 'today' | '7d' | '30d' | 'custom';
    from: string | null;     // YYYY-MM-DD (UTC), só usado quando period='custom'
    to: string | null;       // YYYY-MM-DD (UTC), só usado quando period='custom'
    userType: 'all' | 'motorista' | 'embarcador';
    uf: string | null;       // 'AC'..'TO' ou null = todas
  }
  ```
- **DEFAULT_DASHBOARD_FILTERS**: Constante exportada com `{ period: '7d', from: null, to: null, userType: 'all', uf: null }`.
- **Dashboard_Period_Resolved**: Par `{ from: ISOString, to: ISOString }` derivado de `Dashboard_Filters` em runtime:
  - `today` ⇒ `from = início do dia atual UTC`, `to = NOW()`.
  - `7d` ⇒ `from = NOW() - 7 dias`, `to = NOW()`.
  - `30d` ⇒ `from = NOW() - 30 dias`, `to = NOW()`.
  - `custom` ⇒ `from = <from>T00:00:00Z`, `to = <to>T23:59:59Z`.
- **Dashboard_Period_Previous**: Par `{ from, to }` automaticamente derivado de `Dashboard_Period_Resolved` para cálculo de variação percentual:
  - `to_anterior = from_atual`.
  - `from_anterior = from_atual - duracao(periodo_atual)`.
- **Dashboard_KPI**: Estrutura `{ value: number, previousValue: number, deltaPct: number | null, deltaDirection: 'up' | 'down' | 'flat' }`. `deltaPct` é `null` quando `previousValue === 0` (variação indefinida; UI exibe `—`).
- **Dashboard_KPI_Card**: Card visual que renderiza um `Dashboard_KPI` com label, valor formatado, badge de variação (cor verde para `up` em métricas positivas, vermelho para `down`; cores invertidas para alertas de segurança onde `up` é negativo).
- **Dashboard_Series_Point**: Par `{ date: 'YYYY-MM-DD', value: number }` em uma série temporal.
- **Dashboard_Series**: Lista de `Dashboard_Series_Point` ordenada cronologicamente, granularidade fixa de 1 dia (UTC). Quando o período tem `N` dias, a série tem **exatamente** `N` pontos (zero-fill em dias sem dados).
- **Dashboard_Trend_Chart**: Componente SVG inline que renderiza uma `Dashboard_Series` (ou múltiplas séries sobrepostas) como linha + área. **Não usa** biblioteca externa.
- **Dashboard_GeoBucket**: Estrutura `{ uf: string, count: number, breakdown: { fretes_ativos?: number, motoristas?: number, embarcadores?: number } }` representando a agregação por estado.
- **Dashboard_Geo_Map**: Componente que renderiza um mapa Leaflet com círculos proporcionais centrados em coordenadas estáticas (centroide aproximado de cada UF). Toggle `Fretes ativos` / `Usuários ativos` controla o que é desenhado.
- **Dashboard_Security_Alert**: Item da lista de alertas: `{ id, action, count, last_at, link_to_audit }`.
- **Dashboard_Top_List_Item**: Item de uma lista top: `{ id, name, value, secondary?: string }`.
- **Dashboard_Metrics_Bundle**: Estrutura agregada retornada por `Dashboard_Service.getMetrics(filters)` contendo todos os blocos. Definida formalmente em design §3.
- **Dashboard_Export_Bundle**: Estrutura serializada do `Dashboard_Metrics_Bundle` para CSV. Inclui linha de cabeçalho fixo + linhas de KPI + linhas de série + linhas de top lists, com até 10000 linhas totais.
- **admin_dashboard_metrics**: Nova RPC SQL `STABLE SECURITY DEFINER` criada em `Migration_036` com assinatura `admin_dashboard_metrics(p_from timestamptz, p_to timestamptz, p_user_type text, p_uf text) RETURNS jsonb`. Retorna `Dashboard_Metrics_Bundle` completo em uma única chamada. `STABLE` (não `IMMUTABLE`) porque agrega `NOW()` indireto via filtros temporais.
- **Migration_036**: Arquivo `supabase/migrations/036_admin_dashboard.sql`, dependente de migrations `001..035`. Idempotente (uso de `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`/`CREATE POLICY`), envelopada em `BEGIN`/`COMMIT`, com bloco final `-- VERIFY` comentado. Acompanhada de `036_admin_dashboard_rollback.sql`.
- **DASHBOARD_VIEW**: Nova `AdminAction` adicionada em `permissions.ts` e em `is_admin_with_permission`. Concedida a `SUPER_ADMIN`, `ADMIN`, `SUPORTE`, `FINANCEIRO`. **Negada** a `MODERADOR`.
- **DASHBOARD_EXPORTED**: Action code de audit log gravada em `exportCSV`. Payload `after = { filters, kpis_count, series_count, total_rows, requested_limit: 10000 }`.
- **Dashboard_Refresh_Trigger**: Botão `Atualizar` no topo do dashboard que força re-fetch ignorando o cache `useMemo` (incrementa um `refreshKey` interno).
- **Dashboard_Skeleton**: Estado de loading com placeholder cinza animado por bloco. Cada bloco isola seu skeleton.
- **Dashboard_Block_Error**: Estado de erro local de um bloco (`KPIs`, `Cadastros`, `Fretes`, `Volume`, `Geo`, `Alertas`, `TopEmbarcadores`, `TopMotoristas`, `TopRotas`). Exibe mensagem `Dados indisponíveis` + botão `Tentar novamente` específico do bloco.
- **Dashboard_Filter_Popover**: Popover compacto acionado por botão de ícone (`SlidersHorizontal`), padrão herdado dos cleanups recentes em `UsersListPage` / `FretesListPage` / `BlacklistListPage`.
- **Dashboard_Filter_Modal_Mobile**: Variante full-screen do `Dashboard_Filter_Popover` em viewport `<768px`.
- **CSV_Format**: Formato canônico de export herdado de `admin-users` / `admin-blacklist`: BOM UTF-8 (`\uFEFF`), separador `;`, escape RFC 4180 (campos com `"`/`;`/`\n` envolvidos em aspas duplas; `"` interno duplicado), até 10000 linhas por export.
- **UF_BR**: Domínio fechado de UFs brasileiras: `'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'` (mesmo set já usado em `embarcadores.branch_state` na migration 033).
- **UF_Centroids**: Mapa estático `Record<UF_BR, [lat, lng]>` em `src/services/admin/dashboard.ts` com coordenadas aproximadas do centroide de cada estado, usado pelo `Dashboard_Geo_Map`.

## Padrões de Sucesso

- **TypeScript**: `npx tsc --noEmit` sem erros após implementação.
- **Lint**: `npm run lint` sem warnings.
- **Build**: `npm run build` limpa.
- **Testes obrigatórios** (não levam asterisco em `tasks.md`):
  - **CP-1 — KPI determinístico**: Para o mesmo conjunto de dados de entrada e mesmos `Dashboard_Filters`, `Dashboard_Service.getMetrics(filters)` (e por consequência a RPC `admin_dashboard_metrics`) retorna **sempre** os mesmos valores. Formalizado em `design.md` §13.
  - **CP-2 — Degradação parcial**: Se um bloco falha (ex: top embarcadores lança erro), os demais blocos ainda renderizam corretamente, cada um com seu próprio estado de erro/sucesso isolado. Formalizado em `design.md` §13.
- **Testes opcionais** (marcados com `*` em `tasks.md`):
  - CP-3 — variação percentual idempotente (mesmo `(value, previousValue)` sempre produz mesmo `deltaPct`).
  - CP-4 — RPC retorna jsonb com schema estável (validação de schema da resposta).
  - Smoke test de idempotência da migration 036.
  - Roteiro E2E manual.

## Requirements

### Requirement 1: Página `/admin` — substituição do placeholder

**User Story:** Como admin com `DASHBOARD_VIEW`, quero ver um dashboard analítico ao entrar em `/admin`, para ter visão consolidada do FreteGO sem precisar navegar entre módulos.

#### Acceptance Criteria

1. THE Admin_Panel SHALL manter a rota `/admin` (índice do painel) renderizando `Dashboard_Page` em vez do placeholder atual.
2. THE Dashboard_Page SHALL ser acessível apenas a admins com permissão `DASHBOARD_VIEW`.
3. WHEN um admin sem `DASHBOARD_VIEW` acessa `/admin`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Dashboard_Page SHALL NÃO renderizar título grande de página (`<h1>`) no topo, seguindo o padrão compacto pós-cleanup já adotado em `UsersListPage`, `FretesListPage` e `BlacklistListPage`.
5. THE Dashboard_Page SHALL renderizar uma barra superior com (da esquerda para direita): contador `Período: <descricao>`, botão `Atualizar` (`Dashboard_Refresh_Trigger`), botão de filtros (ícone `SlidersHorizontal`), botão `Exportar CSV`.
6. WHEN o admin entra em `/admin` pela primeira vez na sessão, THE Dashboard_Page SHALL aplicar `DEFAULT_DASHBOARD_FILTERS` (`period='7d'`).
7. THE Dashboard_Page SHALL preservar `Dashboard_Filters` como query params na URL (`?period=7d&userType=all` etc.).
8. WHEN o admin recarrega a página com query params válidos, THE Dashboard_Page SHALL aplicar os filtros automaticamente.
9. IF um query param recebe valor inválido (ex: `?period=foo`, `?uf=XX`), THEN THE Dashboard_Page SHALL ignorar o param e usar o default correspondente.
10. THE Dashboard_Page SHALL renderizar todos os blocos em layout grid responsivo: 4 colunas em viewport `>=1280px`, 2 colunas em `>=768px`, 1 coluna em `<768px`.

### Requirement 2: Filtros globais

**User Story:** Como admin, quero filtrar todos os blocos do dashboard simultaneamente por período, tipo de usuário e UF, para focar em segmentos específicos.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL exibir botão de ícone (`SlidersHorizontal`) que abre `Dashboard_Filter_Popover` em viewport `>=768px` e `Dashboard_Filter_Modal_Mobile` em `<768px`.
2. THE Dashboard_Filter_Popover SHALL conter:
   - Dropdown `Período` com opções `Hoje`, `7 dias` (padrão), `30 dias`, `Customizado`.
   - Quando `Customizado` selecionado: 2 inputs `<input type="date">` `from` e `to`, ambos obrigatórios.
   - Dropdown `Tipo de usuário` com opções `Todos` (padrão), `Motoristas`, `Embarcadores`.
   - Dropdown searchable `UF` com 27 UFs do `UF_BR` + opção `Todas` (padrão).
3. WHEN o admin altera qualquer filtro no popover, THE Dashboard_Page SHALL aplicar debounce de 300ms antes de chamar `Dashboard_Service.getMetrics`.
4. WHEN `period === 'custom'` e `from > to`, THE Dashboard_Filter_Popover SHALL exibir erro de validação `Data inicial deve ser menor ou igual à final.` e NÃO disparar a busca.
5. WHEN `period === 'custom'` e a duração entre `from` e `to` excede 365 dias, THE Dashboard_Filter_Popover SHALL exibir erro `Período máximo de 365 dias.` e NÃO disparar a busca.
6. THE Dashboard_Page SHALL exibir contador `Período: <descricao>` ao lado do botão `Atualizar`, onde `<descricao>` é:
   - `Hoje`, `Últimos 7 dias`, `Últimos 30 dias` para presets.
   - `<from> a <to>` formatado `dd/MM/yyyy` para `custom`.
7. WHEN qualquer filtro muda, THE Dashboard_Page SHALL atualizar a URL via `useSearchParams` sem causar reload.
8. THE Dashboard_Filter_Modal_Mobile SHALL ocupar a viewport inteira em `<768px`, com botões `Aplicar` e `Cancelar` no rodapé fixo.
9. WHEN o admin clica em `Cancelar` no `Dashboard_Filter_Modal_Mobile`, THE Dashboard_Page SHALL descartar mudanças e fechar o modal.

### Requirement 3: KPIs principais

**User Story:** Como admin, quero ver KPIs principais com totais e variação vs. período anterior, para avaliar tendências de saúde do FreteGO.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL renderizar bloco `KPIs Principais` no topo, contendo até 8 `Dashboard_KPI_Card` em grid (4 colunas em desktop, 2 em tablet, 1 em mobile).
2. THE Dashboard_KPI_Card SHALL ter, cada um, label (texto curto), valor formatado (números com separador de milhares pt-BR, valores monetários como `R$ X.XXX,XX`), badge de variação `±X,X% vs período anterior` com seta `▲`/`▼` e cor (verde para tendência positiva, vermelho para negativa, cinza para `flat`/`null`).
3. WHEN `Dashboard_KPI.previousValue === 0` E `value > 0`, THE Dashboard_KPI_Card SHALL exibir badge `Novo` (sem percentual).
4. WHEN `Dashboard_KPI.previousValue === 0` E `value === 0`, THE Dashboard_KPI_Card SHALL exibir badge `—` (sem variação).
5. THE Dashboard_KPI_Card "Usuários ativos" SHALL contar registros em `users` com `is_active = true`, filtrados por `userType` (quando ≠ `all`) e indiretamente por `uf` quando o usuário é `embarcador` com `embarcadores.branch_state = uf`. Para motoristas com filtro de UF, este KPI SHALL exibir contagem total (sem filtrar por UF) e badge `UF não aplicável a motoristas`.
6. THE Dashboard_KPI_Card "Novos cadastros" SHALL contar registros em `users` com `created_at` dentro de `Dashboard_Period_Resolved`, segmentando os mesmos filtros.
7. THE Dashboard_KPI_Card "Fretes ativos" SHALL contar registros em `fretes` com `status = 'ativo'`, filtrados por UF do embarcador quando `uf` definido.
8. THE Dashboard_KPI_Card "Fretes postados" SHALL contar registros em `fretes` com `created_at` dentro do período + filtros.
9. THE Dashboard_KPI_Card "Fretes encerrados" SHALL contar registros em `fretes` com `status = 'encerrado'` E `updated_at` dentro do período + filtros.
10. THE Dashboard_KPI_Card "Taxa de conversão" SHALL exibir percentual `encerrados / postados × 100` calculado server-side. WHEN `postados === 0`, THE Dashboard_KPI_Card SHALL exibir `—` (sem percentual).
11. THE Dashboard_KPI_Card "Volume transacionado" SHALL exibir `SUM(fretes.value) WHERE status='encerrado' AND updated_at IN periodo` formatado como BRL. Este card SHALL ser visível apenas a admins com `FINANCEIRO_VIEW`.
12. THE Dashboard_KPI_Card "Logins admin" SHALL contar registros em `admin_audit_logs` com `action='ADMIN_LOGIN_SUCCESS'` E `created_at` dentro do período. Visível apenas a admins com `AUDIT_VIEW`.
13. THE Dashboard_KPI_Card "Alertas de segurança 24h" SHALL contar registros em `admin_audit_logs` com `action IN ('ADMIN_LOGIN_FAILURE','BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED','BLACKLIST_EMAIL_BLOCKED','ADMIN_STEALTH_BLOCK','ADMIN_LOCKOUT')` em `created_at > NOW() - INTERVAL '24 hours'` (independente do filtro de período do dashboard). Visível apenas a admins com `AUDIT_VIEW`.
14. WHEN o admin clica em um `Dashboard_KPI_Card`, THE Dashboard_Page SHALL navegar para a página correspondente com filtros pré-aplicados:
    - "Usuários ativos" / "Novos cadastros" → `/admin/users?...`.
    - "Fretes ativos" / "Postados" / "Encerrados" → `/admin/fretes?...`.
    - "Logins admin" / "Alertas de segurança 24h" → `/admin/audit?...`.
    - "Volume transacionado" → `/admin/financeiro?...` (se rota existe; senão, navega para `/admin/fretes?status=encerrado`).
15. IF o bloco `KPIs` falha em carregar, THEN THE Dashboard_Page SHALL exibir `Dashboard_Block_Error` no lugar dos cards com mensagem `Dados indisponíveis` + botão `Tentar novamente`.

### Requirement 4: Gráficos de tendência

**User Story:** Como admin, quero ver gráficos de tendência diária de cadastros, fretes e volume, para identificar padrões temporais.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL renderizar bloco `Cadastros novos por dia` como `Dashboard_Trend_Chart` com 2 séries sobrepostas: `motoristas` (linha azul) e `embarcadores` (linha laranja). Quando `userType` filtra para um único tipo, apenas a série correspondente é exibida.
2. THE Dashboard_Page SHALL renderizar bloco `Fretes postados vs encerrados por dia` como `Dashboard_Trend_Chart` com 2 séries: `postados` (linha verde) e `encerrados` (linha cinza).
3. THE Dashboard_Page SHALL renderizar bloco `Volume transacionado por dia` como `Dashboard_Trend_Chart` com 1 série, valores formatados em BRL no tooltip. Visível apenas a admins com `FINANCEIRO_VIEW`.
4. THE Dashboard_Trend_Chart SHALL usar SVG inline (sem biblioteca externa); altura fixa de `h-48` (192px); largura responsiva (`100%` do container).
5. THE Dashboard_Trend_Chart SHALL renderizar:
   - Eixo X com até 7 labels de data formato `dd/MM` (samples uniformes da série).
   - Eixo Y com 4 ticks (mín, ⅓, ⅔, máx), valores formatados.
   - Linha + área preenchida com transparência (10% opacity) por série.
   - Ponto destacado no hover, com tooltip exibindo `dd/MM/yyyy` + valor formatado por série.
6. WHEN `Dashboard_Series` está vazia OU todos os pontos têm `value === 0`, THE Dashboard_Trend_Chart SHALL renderizar mensagem `Sem dados no período.`.
7. WHEN `Dashboard_Series` tem `N` dias, THE Dashboard_Trend_Chart SHALL renderizar exatamente `N` pontos (zero-fill em dias sem dados, garantido pela RPC).
8. THE Dashboard_Trend_Chart SHALL oferecer toggle `Mostrar como tabela` que substitui o SVG por uma `<table>` com colunas `Data | Série A | Série B...`, para acessibilidade e leitura por screen reader.
9. THE `<table>` alternativa SHALL ter `<caption class="sr-only">` descrevendo o conteúdo (ex: `Cadastros novos por dia: motoristas e embarcadores`).
10. IF um bloco de gráfico falha em carregar, THEN THE bloco SHALL exibir `Dashboard_Block_Error` independentemente; demais blocos continuam renderizando.

### Requirement 5: Distribuição geográfica

**User Story:** Como admin, quero visualizar distribuição geográfica de fretes ativos e usuários por estado, para identificar concentração regional.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL renderizar bloco `Distribuição geográfica` como `Dashboard_Geo_Map` em altura fixa `h-80` (320px).
2. THE Dashboard_Geo_Map SHALL usar `MapContainer` de `react-leaflet` com `TileLayer` OpenStreetMap (mesma tile já usada por `MapaFretes.tsx`), centralizado em Brasil (`BR_CENTER = [-14.235, -51.9253]`, zoom 4).
3. THE Dashboard_Geo_Map SHALL renderizar 1 `Circle` por UF presente em `Dashboard_GeoBucket[]`, posicionado no `UF_Centroids[uf]`, com raio proporcional a `Math.sqrt(count) × 30000` (em metros), cor `#0891b2` com `fillOpacity: 0.4`.
4. THE Dashboard_Geo_Map SHALL exibir toggle `Fretes ativos` / `Usuários ativos` no topo do bloco. Default `Fretes ativos`.
5. WHEN o toggle muda, THE Dashboard_Geo_Map SHALL recalcular círculos a partir do mesmo `Dashboard_Metrics_Bundle` (sem nova RPC) usando o sub-objeto correspondente:
   - `Fretes ativos`: soma de `count` em `metrics.geo.fretes_ativos[]`.
   - `Usuários ativos`: soma de `motoristas + embarcadores` em `metrics.geo.usuarios_ativos[]`.
6. WHEN o admin clica em um `Circle`, THE Dashboard_Geo_Map SHALL abrir `Popup` com:
   - Nome da UF (ex: `São Paulo (SP)`).
   - Quando modo `Fretes ativos`: linha `Fretes ativos: N`.
   - Quando modo `Usuários ativos`: linhas `Motoristas: M`, `Embarcadores: E`, `Total: M+E`.
   - Link `Ver detalhes` que navega para `/admin/fretes?uf=<uf>` ou `/admin/users?uf=<uf>` conforme o modo.
7. THE Dashboard_Geo_Map SHALL oferecer toggle `Mostrar como tabela` que substitui o mapa por uma `<table>` com colunas `UF | Fretes ativos | Motoristas | Embarcadores`, ordenada por contagem decrescente.
8. WHEN nenhum estado tem dados, THE Dashboard_Geo_Map SHALL renderizar o mapa com mensagem sobreposta `Sem dados geográficos no período.`.
9. IF o bloco `Geo` falha, THEN THE bloco SHALL exibir `Dashboard_Block_Error`.

### Requirement 6: Alertas de segurança recentes

**User Story:** Como admin com `AUDIT_VIEW`, quero ver alertas de segurança recentes em destaque no dashboard, para reagir rapidamente a incidentes.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL renderizar bloco `Alertas de segurança (24h)` apenas quando o admin tem `AUDIT_VIEW`. WHEN o admin não tem `AUDIT_VIEW`, THE bloco SHALL ser omitido (não desabilitado, nem oculto via CSS — não renderizado).
2. THE bloco SHALL exibir até 10 `Dashboard_Security_Alert`, derivados de `admin_audit_logs WHERE action IN (...) AND created_at > NOW() - INTERVAL '24 hours'`, agrupados por `(action, target_id)` com `count = COUNT(*)`, `last_at = MAX(created_at)`, ordenados por `last_at DESC`.
3. THE actions monitoradas SHALL ser: `ADMIN_LOGIN_FAILURE`, `ADMIN_LOCKOUT`, `ADMIN_STEALTH_BLOCK`, `ADMIN_MFA_VERIFY` (apenas registros com `after_data->>'success' = 'false'`), `BLACKLIST_LOGIN_BLOCKED`, `BLACKLIST_SIGNUP_BLOCKED`, `BLACKLIST_EMAIL_BLOCKED`, `USER_BANNED`.
4. THE Dashboard_Security_Alert SHALL ter:
   - Ícone por tipo (escudo vermelho para login_failure/lockout, lupa amarela para stealth_block, gear vermelho para mfa_failure, ban vermelho para blacklist_*, X vermelho para user_banned).
   - Label em pt-BR (`Tentativa de login admin falhou`, `Bloqueio de login por blacklist`, `Conta bloqueada após N tentativas`, etc).
   - Badge `× N` quando `count > 1`.
   - Timestamp relativo (`há 5 min`, `há 2h`, `ontem 14:30`).
5. WHEN o admin clica em um `Dashboard_Security_Alert`, THE Dashboard_Page SHALL navegar para `/admin/audit?action=<action>&from=<24h_ago>` para drill-down completo.
6. WHEN não há alertas em 24h, THE bloco SHALL exibir mensagem `Nenhum alerta nas últimas 24 horas.` com ícone de check verde.
7. THE bloco SHALL ignorar o filtro de período do dashboard (sempre 24h fixo) e o filtro de UF (não aplicável).
8. THE bloco SHALL respeitar o filtro `userType` para `USER_BANNED` quando `target_type = 'users'` (filtra alertas cujo target tem `users.user_type = userType`).
9. IF o bloco `Alertas` falha, THEN THE bloco SHALL exibir `Dashboard_Block_Error`.

### Requirement 7: Top listas

**User Story:** Como admin, quero ver rankings dos top embarcadores, motoristas e rotas no período, para identificar padrões de uso e entidades de alto impacto.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL renderizar bloco `Top embarcadores` apenas quando o admin tem `FINANCEIRO_VIEW`. WHEN admin não tem `FINANCEIRO_VIEW`, THE bloco SHALL ser omitido (não renderizado).
2. THE bloco `Top embarcadores` SHALL listar até 5 `Dashboard_Top_List_Item` ordenados por `SUM(fretes.value) WHERE status='encerrado'` DESC, com `name = users.name` (resolvido via join com `embarcadores.id = users.id`), `value = SUM formatado em BRL`, `secondary = "<N> fretes encerrados"`.
3. THE Dashboard_Page SHALL renderizar bloco `Top motoristas`, listando até 5 motoristas ordenados por `(COUNT(frete_clicks) + COUNT(frete_likes))` DESC no período, com `name = users.name`, `value = "<N> interações"`, `secondary = "<C> cliques • <L> curtidas"`.
4. THE Dashboard_Page SHALL renderizar bloco `Top rotas`, listando até 5 pares `(origin, destination)` agregados por `LOWER(TRIM(origin)) || ' → ' || LOWER(TRIM(destination))`, ordenados por `COUNT(*)` DESC no período (filtra por `created_at` em `Dashboard_Period_Resolved`), com `name = "<origin> → <destination>"`, `value = "<N> fretes"`.
5. WHEN o admin clica em um item de `Top embarcadores`, THE Dashboard_Page SHALL navegar para `/admin/users/<id>`.
6. WHEN o admin clica em um item de `Top motoristas`, THE Dashboard_Page SHALL navegar para `/admin/users/<id>`.
7. WHEN o admin clica em um item de `Top rotas`, THE Dashboard_Page SHALL navegar para `/admin/fretes?q=<origin>` (sem agregação granular; o admin filtra manualmente).
8. WHEN qualquer top list está vazia, THE bloco correspondente SHALL exibir mensagem `Sem dados no período.`.
9. IF um bloco top falha, THEN THE bloco SHALL exibir `Dashboard_Block_Error` independentemente; demais blocos continuam renderizando.

### Requirement 8: Export do dashboard

**User Story:** Como admin com `DASHBOARD_VIEW`, quero exportar um snapshot do dashboard em CSV, para arquivar e compartilhar relatórios.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL exibir botão `Exportar CSV` na barra superior. Botão visível apenas a admins com `DASHBOARD_VIEW` (default true para quem acessa a página).
2. WHEN o admin clica em `Exportar CSV`, THE Dashboard_Service.exportCSV SHALL gerar arquivo CSV no formato `CSV_Format` contendo:
   - Linha 1: cabeçalho fixo `secao;chave;valor;valor_anterior;variacao_pct`.
   - Bloco `KPIs`: 1 linha por `Dashboard_KPI_Card` (incluindo apenas KPIs visíveis ao admin atual respeitando `FINANCEIRO_VIEW` / `AUDIT_VIEW`).
   - Bloco `Series`: 1 linha por `(serie, data, valor)` em formato achatado (`secao='Series'`, `chave='<nome_serie>:<YYYY-MM-DD>'`, `valor=<numero>`).
   - Bloco `Geo`: 1 linha por UF (`secao='Geo'`, `chave='<UF>:fretes_ativos'`, etc).
   - Bloco `TopEmbarcadores` / `TopMotoristas` / `TopRotas`: 1 linha por item.
3. THE arquivo CSV SHALL ser nomeado `dashboard_<from>_a_<to>.csv` no formato `dashboard_2025-01-01_a_2025-01-07.csv`.
4. THE Dashboard_Service.exportCSV SHALL chamar `logAdminAction({ action: 'DASHBOARD_EXPORTED', after: { filters, kpis_count, series_count, total_rows, requested_limit: 10000 } })` antes de retornar o CSV.
5. IF o total de linhas excede 10000, THEN THE Dashboard_Service.exportCSV SHALL truncar para as primeiras 10000 linhas E o audit log SHALL registrar `truncated: true, total_rows: 10000`.
6. WHEN admin não tem `FINANCEIRO_VIEW`, THE export SHALL omitir KPIs e bloco `TopEmbarcadores` financeiros, registrando `omitted_blocks: ['volume','top_embarcadores']` no audit log.
7. WHEN admin não tem `AUDIT_VIEW`, THE export SHALL omitir KPIs `Logins admin` e `Alertas 24h`, registrando `omitted_blocks: [...,'logins','alertas']`.
8. WHEN o admin clica em `Exportar CSV` enquanto os dados ainda carregam, THE botão SHALL estar desabilitado com tooltip `Aguarde os dados carregarem.`.

### Requirement 9: Loading states e degradação parcial

**User Story:** Como admin, quero que o dashboard carregue de forma robusta, com cada bloco isolado, para que falhas em um bloco não me impeçam de ver os outros.

#### Acceptance Criteria

1. WHEN o admin entra em `/admin` ou aplica novos filtros, THE Dashboard_Page SHALL renderizar `Dashboard_Skeleton` em cada bloco enquanto a RPC carrega.
2. THE Dashboard_Skeleton SHALL ter `aria-busy="true"` e `aria-live="polite"` no container.
3. WHEN a RPC `admin_dashboard_metrics` retorna sucesso, THE Dashboard_Page SHALL renderizar cada bloco com seus dados.
4. WHEN a RPC `admin_dashboard_metrics` retorna erro de rede ou timeout, THE Dashboard_Page SHALL renderizar `Dashboard_Block_Error` em todos os blocos com botão `Tentar novamente` global.
5. WHEN a RPC retorna `jsonb` parcialmente preenchido (ex: campo `geo` ausente ou `null`), THE Dashboard_Page SHALL renderizar `Dashboard_Block_Error` apenas no bloco afetado, e os demais blocos SHALL renderizar normalmente.
6. THE Dashboard_Service SHALL aplicar timeout de 10 segundos na RPC; em timeout, lança erro tratado pelo `Dashboard_Page` em (4).
7. WHEN o admin clica `Tentar novamente` em um `Dashboard_Block_Error` global ou local, THE Dashboard_Page SHALL re-disparar `getMetrics(filters)` e mostrar `Dashboard_Skeleton` novamente.
8. WHEN o admin troca filtros enquanto uma requisição anterior ainda está pendente, THE Dashboard_Service SHALL cancelar a anterior (ou ignorar seu resultado se já em voo) E disparar nova requisição com os filtros atuais.
9. THE Dashboard_Service SHALL aplicar cache no client com chave `JSON.stringify(filters)`, válido pelo tempo de vida da página (sem TTL absoluto). WHEN o admin clica `Atualizar`, THE Dashboard_Service SHALL invalidar a entrada de cache correspondente E re-fetchar.

### Requirement 10: Permissões e gating

**User Story:** Como SUPER_ADMIN, quero permissões granulares no dashboard para restringir blocos sensíveis a perfis específicos, mantendo compliance e princípio do menor privilégio.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL ganhar nova action `DASHBOARD_VIEW`.
2. THE SUPER_ADMIN SHALL ter `DASHBOARD_VIEW`.
3. THE ADMIN SHALL ter `DASHBOARD_VIEW`.
4. THE SUPORTE SHALL ter `DASHBOARD_VIEW`.
5. THE FINANCEIRO SHALL ter `DASHBOARD_VIEW` (já tinha `FINANCEIRO_VIEW`; agora ganha acesso ao dashboard inteiro com KPIs financeiros visíveis).
6. THE MODERADOR SHALL NÃO ter `DASHBOARD_VIEW`.
7. WHEN um admin sem `DASHBOARD_VIEW` (ex: MODERADOR) acessa `/admin`, THE AdminGuard SHALL renderizar `Stealth_404`.
8. THE bloco "Volume transacionado" (KPI) e bloco "Volume transacionado por dia" (gráfico) e bloco "Top embarcadores" SHALL ser renderizados apenas quando admin tem `FINANCEIRO_VIEW`.
9. THE blocos "Logins admin", "Alertas de segurança 24h" (KPI) e "Alertas de segurança recentes" (lista) SHALL ser renderizados apenas quando admin tem `AUDIT_VIEW`.
10. THE função SQL `is_admin_with_permission` SHALL ser atualizada em `Migration_036` para incluir `DASHBOARD_VIEW` na lista de actions permitidas para SUPER_ADMIN, ADMIN, SUPORTE e FINANCEIRO; MODERADOR continua sem.
11. THE RPC `admin_dashboard_metrics` SHALL validar `is_admin_with_permission('DASHBOARD_VIEW')` server-side antes de qualquer agregação. Quando ausente, levanta `permission_denied` (mapeado para erro tipado no service).
12. THE RPC `admin_dashboard_metrics` SHALL retornar `null` nos sub-objetos `volume`, `top_embarcadores` e `series.volume_diario` quando `is_admin_with_permission('FINANCEIRO_VIEW') = false`. Idem para `logins_admin`, `alertas_seguranca_24h` e `security_alerts` quando `is_admin_with_permission('AUDIT_VIEW') = false`. **A omissão é server-side**, não apenas client-side.
13. WHEN admin sem `DASHBOARD_VIEW` chama a RPC diretamente via Supabase (bypass de UI), THE RPC SHALL levantar `permission_denied` E gerar audit log `DASHBOARD_VIEW_DENIED` com `before = NULL`, `after = { reason: 'permission_denied', user_id: <auth.uid()> }`.

### Requirement 11: Performance

**User Story:** Como admin, quero o dashboard carregar rapidamente mesmo com muitos dados, para usar como ferramenta cotidiana sem fricção.

#### Acceptance Criteria

1. THE RPC `admin_dashboard_metrics` SHALL retornar todo o `Dashboard_Metrics_Bundle` em uma única chamada (não fragmentada em N round-trips).
2. THE RPC SHALL usar `STABLE` (não `IMMUTABLE`, dado uso de `NOW()` indireto via filtros temporais) e `SECURITY DEFINER` com `SET search_path = public`.
3. THE RPC SHALL ser limitada a período máximo de 365 dias (validado server-side); em violação, levanta `INVALID_PERIOD`.
4. THE Dashboard_Service.getMetrics SHALL aplicar cache no client baseado em `JSON.stringify(filters)`, evitando re-fetch quando filtros não mudam.
5. WHEN o admin troca filtros 5 vezes em 1 segundo, THE Dashboard_Page SHALL aplicar debounce de 300ms — apenas a última mudança dispara `getMetrics`.
6. THE RPC SHALL ter timeout no client de 10 segundos.
7. THE Dashboard_Page SHALL renderizar skeleton em até 50ms após o disparo (não esperar a primeira resposta antes de mostrar feedback visual).
8. THE RPC SHALL ser otimizada para usar índices existentes:
   - `idx_users_user_type`, `idx_users_is_active`, `idx_users_created_at` (este último adicionado pela migration 036 se não existir).
   - `idx_fretes_status`, `idx_fretes_created_at` (criado pela migration 036 se ausente).
   - `idx_admin_audit_logs_created_at` e `idx_admin_audit_logs_action` (já existentes em 030).
   - `idx_embarcadores_branch_state` (já existente em 033).
9. THE Migration_036 SHALL adicionar índices auxiliares **somente se não existirem**, e SHALL ser idempotente.

### Requirement 12: Acessibilidade

**User Story:** Como admin com necessidade de tecnologia assistiva, quero usar o dashboard com leitor de tela e teclado, para ter as mesmas informações sem barreiras.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL ser navegável por teclado: `Tab` move foco entre cards e blocos; `Enter` ativa botões e links; `Esc` fecha popovers e modais.
2. THE Dashboard_KPI_Card SHALL ter `role="region"` E `aria-label="<label_do_card>: <valor>, variação <±X,X%>"`.
3. THE Dashboard_Trend_Chart SHALL ter `role="img"` no `<svg>` E `<title>` interno descrevendo a série, e oferecer toggle `Mostrar como tabela` (Req 4.8) com a `<table>` tendo `<caption class="sr-only">`.
4. THE Dashboard_Geo_Map SHALL oferecer toggle `Mostrar como tabela` (Req 5.7) para acessibilidade equivalente; o mapa Leaflet em si tem suporte limitado a teclado e isso é tradeoff aceito.
5. THE Dashboard_Skeleton SHALL ter `aria-busy="true"` E `aria-live="polite"` no container.
6. THE Dashboard_Block_Error SHALL ter `role="alert"` E mensagem clara em pt-BR.
7. THE Dashboard_Filter_Popover SHALL ter `role="dialog"`, `aria-modal="false"` E foco inicial no primeiro campo. `Esc` fecha o popover.
8. THE Dashboard_Filter_Modal_Mobile SHALL ter `role="dialog"`, `aria-modal="true"` E foco inicial no primeiro campo. `Esc` fecha o modal.
9. THE valores numéricos exibidos (KPIs, séries) SHALL ser formatados com separador de milhares pt-BR (`Intl.NumberFormat('pt-BR')`) e separador decimal vírgula.
10. THE valores monetários SHALL ser formatados como `R$ X.XXX,XX` via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.

### Requirement 13: Mobile

**User Story:** Como admin, quero usar o dashboard em mobile com layout adaptado, para acompanhar métricas em movimento.

#### Acceptance Criteria

1. WHEN viewport `<768px`, THE Dashboard_Page SHALL renderizar todos os blocos em coluna única (`grid-cols-1`).
2. WHEN viewport `<768px`, THE botão de filtros SHALL abrir `Dashboard_Filter_Modal_Mobile` em vez de popover.
3. WHEN viewport `<768px`, THE `Dashboard_Trend_Chart` SHALL manter altura `h-48` (192px) e largura `100%`.
4. WHEN viewport `<768px`, THE `Dashboard_Geo_Map` SHALL manter altura `h-80` (320px), com gestos touch nativos do Leaflet preservados.
5. WHEN viewport `<768px`, THE `Dashboard_KPI_Card` SHALL ser empilhado em coluna única, com texto reduzido (`text-xs`) para labels.
6. WHEN viewport `<768px`, THE `Dashboard_Filter_Modal_Mobile` SHALL ocupar viewport inteira (sem padding lateral) com botões `Aplicar` e `Cancelar` fixos no rodapé.
7. WHEN viewport `<768px`, THE barra superior SHALL stackar verticalmente: linha 1 com contador de período, linha 2 com botões `Atualizar` / filtros / `Exportar`.
8. THE botões de ação SHALL manter classes compactas `text-xs px-2.5 py-1` em todas as breakpoints (padrão pós-cleanup).

### Requirement 14: Migration 036 e contratos de banco

**User Story:** Como engenheiro, quero a migration 036 idempotente, com rollback paralelo e RPC server-side, para garantir deploy e revert seguros.

#### Acceptance Criteria

1. THE Migration_036 SHALL ser arquivo `supabase/migrations/036_admin_dashboard.sql` envolvido em `BEGIN; ... COMMIT;`.
2. THE Migration_036 SHALL incluir blocos `DO $check$ ... $check$` defensivos validando dependências: (a) `is_admin_with_permission(text)` existe (migration 030); (b) `admin_audit_logs` existe com colunas esperadas (migration 030); (c) `users` tem coluna `created_at` (migration 001); (d) `fretes` tem colunas `status`, `value`, `created_at`, `updated_at` (migration 001); (e) `embarcadores` tem `branch_state` (migration 033); (f) `frete_clicks` existe (migration 001); (g) `frete_likes` existe (migration 021).
3. THE Migration_036 SHALL ser idempotente: aplicar 2x não deve falhar nem duplicar objetos.
4. THE Migration_036 SHALL adicionar índices auxiliares **somente se ausentes**: `idx_users_created_at ON users(created_at DESC)`, `idx_fretes_created_at ON fretes(created_at DESC)`, `idx_fretes_updated_at_status ON fretes(updated_at DESC) WHERE status='encerrado'`. Todos via `CREATE INDEX IF NOT EXISTS`.
5. THE Migration_036 SHALL atualizar `is_admin_with_permission(text)` via `CREATE OR REPLACE FUNCTION` para incluir nova action `DASHBOARD_VIEW` na matriz, mantendo compatibilidade com actions já existentes.
6. THE Migration_036 SHALL criar a função `admin_dashboard_metrics(p_from timestamptz, p_to timestamptz, p_user_type text, p_uf text) RETURNS jsonb` `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`.
7. THE função `admin_dashboard_metrics` SHALL:
   - Validar `auth.uid() IS NOT NULL`; senão `RAISE permission_denied`.
   - Validar `is_admin_with_permission('DASHBOARD_VIEW')`; senão registrar log `DASHBOARD_VIEW_DENIED` (via `INSERT INTO admin_audit_logs`) E `RAISE permission_denied`.
   - Validar `p_to >= p_from` E `p_to - p_from <= INTERVAL '365 days'`; senão `RAISE INVALID_PERIOD`.
   - Validar `p_user_type IN ('all','motorista','embarcador')`; senão `RAISE INVALID_USER_TYPE`.
   - Validar `p_uf IS NULL OR p_uf IN (UF_BR)`; senão `RAISE INVALID_UF`.
   - Computar `Dashboard_Period_Previous` derivado.
   - Agregar `kpis`, `series`, `geo`, `security_alerts`, `top_embarcadores`, `top_motoristas`, `top_rotas` em sub-queries paralelas via CTEs.
   - Aplicar gating server-side: omitir `volume`, `top_embarcadores`, `series.volume_diario` quando `is_admin_with_permission('FINANCEIRO_VIEW') = false`; omitir `logins_admin`, `alertas_seguranca_24h`, `security_alerts` quando `is_admin_with_permission('AUDIT_VIEW') = false`.
   - Retornar `jsonb_build_object(...)` com schema documentado em `design.md` §3.3.
8. THE função SHALL ter `REVOKE ALL FROM PUBLIC` E `GRANT EXECUTE TO authenticated` (apenas auth — RLS na função protege via `is_admin_with_permission`).
9. THE Migration_036 SHALL incluir bloco final `-- VERIFY` comentado com SELECTs de validação:
   - `SELECT proname FROM pg_proc WHERE proname='admin_dashboard_metrics';` → 1 linha.
   - `SELECT * FROM admin_dashboard_metrics(NOW() - INTERVAL '7 days', NOW(), 'all', NULL);` (executado por SUPER_ADMIN logado) → jsonb não-nulo.
   - `SELECT is_admin_with_permission('DASHBOARD_VIEW');` (em sessão admin) → `true` para perfis aplicáveis.
10. THE Migration_036 SHALL ser acompanhada de `supabase/migrations/036_admin_dashboard_rollback.sql` documentando DROP de: função `admin_dashboard_metrics`, índices `idx_users_created_at` / `idx_fretes_created_at` / `idx_fretes_updated_at_status` (apenas se foram criados por esta migration), e reversão de `is_admin_with_permission` para a versão da migration 035 (sem `DASHBOARD_VIEW`). **Não** auto-aplicado; serve como referência de recovery.

### Requirement 15: Auditoria do export

**User Story:** Como SUPER_ADMIN, quero rastreabilidade completa de exports do dashboard, para compliance e análise forense.

#### Acceptance Criteria

1. THE Dashboard_Service.exportCSV SHALL chamar `logAdminAction({ action: 'DASHBOARD_EXPORTED', target_type: null, target_id: null, after: { filters, kpis_count, series_count, total_rows, requested_limit: 10000, omitted_blocks?: string[], truncated?: boolean } })` antes de retornar o CSV.
2. THE audit log SHALL gravar o objeto `filters` resolvido (não o `Dashboard_Filters` cru, mas o `Dashboard_Period_Resolved` final com `from`/`to` em ISOString).
3. WHEN o admin não tem `FINANCEIRO_VIEW`, THE audit log SHALL incluir `omitted_blocks: ['volume','volume_diario','top_embarcadores']`.
4. WHEN o admin não tem `AUDIT_VIEW`, THE audit log SHALL incluir `omitted_blocks: [...,'logins_admin','alertas_seguranca_24h','security_alerts']`.
5. WHEN o export trunca em 10000 linhas, THE audit log SHALL incluir `truncated: true, total_rows: 10000`.
6. THE Dashboard_Service.exportCSV SHALL NÃO usar `executeAdminMutation` (não há mutação de banco; apenas leitura agregada + log isolado via `logAdminAction`).
7. IF `logAdminAction` falha, THEN THE Dashboard_Service.exportCSV SHALL prosseguir com o download do CSV (best-effort — não bloqueia funcionalidade) E gravar `console.error` para diagnóstico futuro.

### Requirement 16: Compatibilidade com padrões herdados

**User Story:** Como engenheiro do FreteGO, quero que o dashboard reuse padrões já em produção, para manter consistência visual e arquitetural.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL reusar `AdminGuard`, `AdminShell`, `AdminProvider` sem modificação.
2. THE Dashboard_Page SHALL seguir o padrão compacto pós-cleanup: SEM título grande no topo; filtros em popover via botão de ícone; botões de ação com classes `text-xs px-2.5 py-1`.
3. THE Dashboard_Service SHALL reusar `executeAdminMutation` quando aplicável (não é o caso desta spec — apenas exports passam por `logAdminAction`).
4. THE Dashboard_Service.exportCSV SHALL gerar CSV no formato `CSV_Format` herdado de `admin-users` / `admin-blacklist`.
5. THE Dashboard_Page SHALL exibir `Stealth_404` quando admin não tem `DASHBOARD_VIEW` — comportamento idêntico aos demais módulos admin.
6. THE blocos com erro SHALL seguir o padrão `Dashboard_Block_Error` herdado de `getUserDetail` / `getBlacklistDetail` (degradação parcial).
7. THE Dashboard_Service SHALL importar `supabase` de `src/services/supabase.ts` (cliente único do projeto).
8. THE Dashboard_Page SHALL usar `useAdminPermission(action)` para todos os gates client-side (importado de `src/hooks/useAdminPermission.ts`).
9. THE strings user-facing SHALL ser pt-BR; action codes (`DASHBOARD_VIEW`, `DASHBOARD_EXPORTED`, `DASHBOARD_VIEW_DENIED`) e error codes (`INVALID_PERIOD`, `INVALID_USER_TYPE`, `INVALID_UF`, `permission_denied`, `TIMEOUT`) SHALL ser em inglês (constante).

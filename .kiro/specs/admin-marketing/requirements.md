# Requirements Document

## Introduction

Esta spec entrega o módulo **Marketing** do painel administrativo do FreteGO, acessível em
`/admin/marketing`. O módulo conecta o FreteGO à **Meta Marketing API** para exibir métricas de
anúncios de Facebook/Instagram dentro do painel e implementa **Meta Pixel + Conversions API (CAPI)**
para rastreamento de eventos com deduplicação.

O módulo se assenta sobre as fundações já em produção, reusadas sem reinventar (ver
`admin-patterns.md`):

- **admin-foundation (migration 030)**: RBAC `is_admin_with_permission`, `Permission_Matrix` em
  `src/services/admin/permissions.ts`, `executeAdminMutation` (audit-by-construction), `Stealth_404`,
  versionamento otimista por `updated_at`, RPC `SECURITY DEFINER` com `SET search_path = public` +
  `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, padrão de UI compacto
  (`Compact_Layout_Pattern`), cards mobile `<768px`, WCAG AA, gráficos SVG inline (sem
  Recharts/Chart.js).
- **Supabase Vault (migration 042b)**: armazenamento criptografado server-side de segredos. O
  **Meta Marketing API Access Token** é guardado no Vault, nunca em coluna legível e nunca exposto
  ao frontend.
- **Edge Functions (padrão `send-push-notification`)**: toda chamada à Meta API (leitura de métricas
  e envio de eventos CAPI) passa por Edge Functions. O frontend nunca chama a Meta diretamente e
  nunca recebe o token.

### Escopo (MVP enxuto)

1. **Configuração da integração** em `/admin/marketing/configuracoes`, gated por `MARKETING_EDIT`:
   tela onde o admin informa o Meta Access Token (segredo no Vault), o Ad Account ID, o Pixel ID,
   o período default e as configurações de consentimento. Token armazenado **criptografado** no
   Vault, **nunca** exposto no frontend.
2. **Painel de métricas** em `/admin/marketing`, gated por `MARKETING_VIEW`: métricas em quase tempo
   real das campanhas ativas — gasto total, impressões, cliques, CPL, CPC, CTR e conversões — com
   filtro de período (hoje / últimos 7 dias / últimos 30 dias) e ranking de criativos
   (melhores e piores desempenhos). Toda leitura passa pela `Meta_Read_Function` (Edge Function),
   nunca chamando a Meta diretamente do navegador.
3. **Meta Pixel + CAPI**: Pixel no frontend público do FreteGO para rastrear eventos importantes
   (`motorista_registration`, `embarcador_registration`, `frete_published`, além de `PageView` e
   `Lead`), carregado **somente após o consentimento de cookies (LGPD)**. CAPI via Edge Function
   envia os mesmos eventos server-side, garantindo rastreamento mesmo com bloqueadores de anúncios
   ou restrições do iOS. Pixel e CAPI compartilham um `event_id` por evento para que a Meta faça a
   deduplicação. Dados pessoais enviados via CAPI são hasheados em SHA-256 conforme exigência da
   Meta.

A stack permanece TypeScript (strict) + React 18 + Vite + TailwindCSS + Supabase (Postgres + Auth +
Vault + Edge Functions) + Vitest + fast-check. Gráficos em SVG inline. Esta spec adiciona a
**migration 048** (`048_admin_marketing.sql` + par de rollback documentado), o service
`src/services/admin/marketing.ts`, componentes em `src/components/admin/marketing/`, a página
`/admin/marketing` (+ subrotas), o registro de rota no `AdminGuard`, duas Edge Functions
(`meta-marketing-read` e `meta-capi-forward`) e a integração do Pixel/consentimento no site público.

### Fora de escopo

Estão explicitamente **FORA** de escopo desta spec:

- **Criar, editar ou pausar campanhas** a partir do painel — o módulo é **somente leitura** de
  métricas.
- Gestão de orçamento (budget) de campanhas.
- Criação de testes A/B.
- O **módulo de assistente de IA** (spec separada `admin-assistant`).
- Integração real de **WhatsApp**.
- Públicos personalizados (Custom Audiences), retargeting e upload de listas para a Meta.
- Atribuição multi-touch ou modelagem de atribuição própria.

## Glossary

- **Admin_Panel**: painel administrativo entregue em `admin-foundation` (migration 030), acessível
  em `/admin/*`.
- **AdminGuard / AdminProvider / AdminLayoutRoute / AdminShell / AdminSidebar**: componentes de
  fundação do painel, reusados sem alteração de contrato.
- **Stealth_404**: página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Permission_Matrix**: matriz `(AdminRole, AdminAction) -> boolean` em
  `src/services/admin/permissions.ts`, espelhada server-side por `is_admin_with_permission`.
- **MARKETING_VIEW**: nova `AdminAction` de leitura (métricas, ranking, configuração mascarada).
  Concedida a `SUPER_ADMIN` e `ADMIN`.
- **MARKETING_EDIT**: nova `AdminAction` de escrita (configurar token/ad account/pixel/período/
  consentimento). Concedida a `SUPER_ADMIN` e `ADMIN`.
- **executeAdminMutation**: wrapper de audit-by-construction em `src/services/admin/audit.ts`. Toda
  mutação de configuração de marketing passa por aqui.
- **logAdminAction**: helper que registra um audit log isolado (usado em leituras negadas).
- **is_admin_with_permission**: função SQL (migration 030) que reproduz a `Permission_Matrix`
  server-side, usada em toda RPC `SECURITY DEFINER`.
- **Vault**: extensão `supabase_vault` (em uso desde a migration 042b) usada para guardar o
  `Meta_Access_Token` de forma criptografada server-side.
- **Meta_Access_Token**: token de acesso da Meta Marketing API. Armazenado **somente** no Vault.
  Nunca persistido em coluna legível de `marketing_config` e nunca retornado ao frontend.
- **Meta_Marketing_API**: API externa da Meta consultada para obter métricas de anúncios.
- **Ad_Account_Id**: identificador da conta de anúncios da Meta (formato `act_<digits>`).
- **Pixel_Id**: identificador numérico do Meta Pixel.
- **marketing_config**: tabela com a configuração vigente da integração: `ad_account_id`,
  `pixel_id`, `default_period`, `consent_required`, `token_secret_id` (referência ao segredo no
  Vault, não o valor), `updated_at`, `updated_by`. Snapshot único (linha vigente).
- **marketing_events**: tabela de log server-side dos eventos enviados via CAPI: `event_id`
  (UUID compartilhado com o Pixel para dedup), `event_name`, `visitor_id_hash`, `user_id_hash`,
  `email_hash`, `phone_hash`, `event_time`, `send_status`, `created_at`.
- **marketing_metrics_cache**: tabela opcional de cache de snapshots de métricas por
  `(ad_account_id, period_key, fetched_at)`, evitando consultas excessivas à Meta_Marketing_API.
- **Meta_Read_Function**: Edge Function `meta-marketing-read`. Único caminho de leitura da
  Meta_Marketing_API. Lê o `Meta_Access_Token` do Vault server-side, aplica o filtro de período e
  retorna métricas agregadas e ranking ao painel. O token nunca sai da função.
- **Meta_CAPI_Function**: Edge Function `meta-capi-forward`. Recebe eventos do site/server, hasheia
  PII em SHA-256, anexa o `event_id` compartilhado e encaminha o evento server-side à Meta via CAPI.
- **Pixel_Loader**: módulo do frontend público responsável por injetar o script do Meta Pixel e
  inicializar `fbq`. Só injeta o script **após** o consentimento.
- **Consent_State**: estado de consentimento de cookies do visitante (LGPD): `granted` ou `denied`.
- **Tracked_Event**: evento de marketing rastreado. Domínio fechado:
  `'page_view'`, `'lead'`, `'motorista_registration'`, `'embarcador_registration'`,
  `'frete_published'`.
- **Event_Id**: UUID v4 gerado uma vez por ocorrência lógica de um `Tracked_Event` e compartilhado
  entre o disparo do Pixel (browser) e o disparo do CAPI (server) para deduplicação na Meta.
- **PII_Hash**: hash SHA-256 (hex minúsculo, 64 caracteres) de um dado pessoal normalizado
  (trim + lowercase; telefone reduzido a dígitos com DDI) conforme exigência da Meta CAPI.
- **Metric_Period**: filtro de período. Domínio fechado: `'today'`, `'7d'`, `'30d'`.
- **Period_Range**: intervalo `{ from, to }` derivado deterministicamente de um `Metric_Period` e de
  um instante de referência, no timezone `America/Sao_Paulo`.
- **Campaign_Metrics**: métricas agregadas de uma campanha ativa: `spend`, `impressions`, `clicks`,
  `leads`, `conversions`, e derivadas `ctr`, `cpc`, `cpl`.
- **Creative_Performance**: métricas por criativo usadas para o ranking de melhores e piores.
- **Compute_Metrics**: função pura TS que deriva `ctr`, `cpc` e `cpl` a partir de
  `spend`, `impressions`, `clicks`, `leads`, com guardas de divisão por zero determinísticas.
- **Rank_Creatives**: função pura TS que ordena `Creative_Performance` por uma métrica escolhida,
  produzindo uma ordem total com desempate estável.
- **Resolve_Period**: função pura TS que mapeia `(Metric_Period, referenceInstant)` para um
  `Period_Range`.
- **Compact_Layout_Pattern**: padrão de UI compacta do painel admin (sem `<h1>` grande, filtros em
  popover via ícone `SlidersHorizontal`, paginação `10/50/100`, botões `text-xs px-2.5 py-1`).
- **Migration_048**: `supabase/migrations/048_admin_marketing.sql`, idempotente, com par de rollback
  documentado (`048_admin_marketing_rollback.sql`), próxima numeração livre após 047
  (reservada por `admin-assistant`; 045 `admin-settings`, 046 `financeiro`).
- **Action codes** (inglês, gravados em `admin_audit_logs`): `MARKETING_CONFIG_UPDATED`,
  `MARKETING_TOKEN_UPDATED`, `MARKETING_TOKEN_CLEARED`, `MARKETING_VIEW_DENIED`.

## Padrões de Sucesso

- **TypeScript**: `npx tsc --noEmit` zero erros.
- **Lint**: `npm run lint` zero warnings.
- **Build**: `npm run build` limpa.

### Propriedades de Correção obrigatórias (sem asterisco em tasks.md)

- **CP-1 — Mapeamento determinístico de período**: para todo `(Metric_Period, referenceInstant)`,
  `Resolve_Period` é função pura e determinística e produz um `Period_Range` com `from <= to`,
  `to == referenceInstant` (normalizado), e `from` correto por período (`today` = início do dia
  local; `7d` = `to - 7 dias`; `30d` = `to - 30 dias`) no timezone `America/Sao_Paulo`. Mesmo input
  ⇒ mesmo output.
- **CP-2 — Derivação correta de métricas**: para todo `Campaign_Metrics` de entrada,
  `Compute_Metrics` satisfaz: `ctr == clicks / impressions` quando `impressions > 0` e `ctr == 0`
  quando `impressions == 0`; `cpc == spend / clicks` quando `clicks > 0` e `cpc == null` quando
  `clicks == 0` (incluindo `cpc == 0` quando `spend == 0` e `clicks > 0`); `cpl == spend / leads`
  quando `leads > 0` e `cpl == null` quando `leads == 0`. `Compute_Metrics` exige a invariante de
  entrada `clicks <= impressions` (entradas que a violem são rejeitadas como inválidas). A função é
  pura e nunca lança por divisão por zero.
- **CP-3 — Ordenação total e estável do ranking de criativos**: para toda lista de
  `Creative_Performance` e métrica escolhida, `Rank_Creatives` produz uma permutação da entrada
  (mesmo multiconjunto, sem perdas nem duplicações), ordenada de forma monotônica pela métrica, com
  desempate estável e determinístico por `creative_id` ascendente — definindo uma **ordem total**.
  O "melhor" é o primeiro e o "pior" é o último para a direção escolhida; a operação é idempotente
  (reordenar o resultado não altera a ordem).
- **CP-4 — Invariante de deduplicação por `event_id`**: para toda ocorrência de `Tracked_Event`, o
  payload enviado ao Pixel (browser) e o payload enviado ao CAPI (server) compartilham exatamente o
  mesmo `Event_Id`; o `Event_Id` é um UUID v4 válido e estável para aquela ocorrência.
- **CP-5 — Porta de consentimento do Pixel**: para todo `Consent_State`, enquanto
  `consent == 'denied'`, o `Pixel_Loader` não injeta o script do Pixel nem inicializa `fbq`;
  quando `consent` transiciona para `granted`, o `Pixel_Loader` injeta o script no máximo uma vez
  (idempotente).
- **CP-6 — Hashing de PII (formato e normalização)**: para todo dado pessoal de entrada,
  `PII_Hash` produz uma string de exatamente 64 caracteres hexadecimais minúsculos; a normalização
  (trim + lowercase; telefone reduzido a dígitos) é idempotente; o hashing é determinístico
  (mesmo input normalizado ⇒ mesmo hash) e um valor já hasheado não é hasheado novamente
  (detecção por formato).
- **CP-7 — Token ausente de qualquer payload voltado ao frontend**: para toda resposta de leitura
  de configuração retornada ao cliente (RPC e Edge Function), o payload serializado não contém o
  `Meta_Access_Token` em texto claro; apenas o `Masked_Token` (últimos 4 caracteres) e o indicador
  `is_set` são expostos.

## Requirements

### Requirement 1: Rotas /admin/marketing, gating e padrão compacto

**User Story:** Como admin com `MARKETING_VIEW`, quero acessar `/admin/marketing` para ver o painel
de métricas seguindo o padrão visual compacto dos demais módulos admin.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/marketing` renderizando a Marketing_Metrics_Page.
2. THE Admin_Panel SHALL registrar a rota `/admin/marketing/configuracoes` renderizando a
   Marketing_Config_Page.
3. WHEN um admin com `MARKETING_VIEW` acessa `/admin/marketing`, THE AdminGuard SHALL renderizar a
   Marketing_Metrics_Page.
4. IF um admin sem `MARKETING_VIEW` acessa `/admin/marketing`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
5. IF um admin sem `MARKETING_EDIT` acessa `/admin/marketing/configuracoes`, THEN THE AdminGuard
   SHALL renderizar Stealth_404.
6. WHERE o usuário atual tem perfil `SUPORTE`, `FINANCEIRO` ou `MODERADOR`, THE AdminGuard SHALL
   renderizar Stealth_404 ao acessar qualquer rota `/admin/marketing*`.
7. THE Marketing_Metrics_Page SHALL omitir o `<h1>` grande no topo da página, seguindo o
   Compact_Layout_Pattern.
8. THE AdminSidebar SHALL exibir o item Marketing apontando para `/admin/marketing`, gated por
   `MARKETING_VIEW`.
9. WHEN um admin sem `MARKETING_EDIT` está em `/admin/marketing`, THE Admin_Panel SHALL ocultar
   (não desabilitar) o link Configurar integração.

### Requirement 2: Permissões MARKETING_VIEW e MARKETING_EDIT

**User Story:** Como sistema, quero garantir defesa em profundidade (UI + servidor) com o menor
número possível de novas actions, para que o acesso ao módulo Marketing seja controlado.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL adicionar as actions `MARKETING_VIEW` e `MARKETING_EDIT` ao enum
   `ADMIN_ACTIONS`.
2. THE Permission_Matrix SHALL conceder `MARKETING_VIEW` e `MARKETING_EDIT` a `SUPER_ADMIN` e
   `ADMIN`.
3. THE Permission_Matrix SHALL NEGAR `MARKETING_VIEW` e `MARKETING_EDIT` a `SUPORTE`, `FINANCEIRO` e
   `MODERADOR`.
4. THE is_admin_with_permission SHALL reconhecer `MARKETING_VIEW` e `MARKETING_EDIT` server-side com
   o mesmo mapeamento de papéis da Permission_Matrix.
5. WHEN um admin sem `MARKETING_VIEW` invoca qualquer RPC ou Edge Function de leitura de marketing,
   THE servidor SHALL negar a operação e registrar `MARKETING_VIEW_DENIED` em `admin_audit_logs`
   com `before` nulo e `after` contendo `user_id` e `reason`.
6. WHEN um admin sem `MARKETING_EDIT` invoca qualquer RPC ou Edge Function de mutação de
   configuração, THE servidor SHALL retornar `permission_denied` sem mutar.
7. WHEN o caller é anônimo, com `auth.uid()` nulo, THE RPCs e Edge Functions administrativas de
   marketing SHALL retornar `permission_denied`.
8. THE UI SHALL ocultar (não desabilitar) botões e links cujas ações requerem permissão ausente.

### Requirement 3: Configuração da integração Meta

**User Story:** Como admin com `MARKETING_EDIT`, quero configurar o Access Token, o Ad Account ID,
o Pixel ID, o período default e as opções de consentimento, para que o painel consuma a
Meta Marketing API com segurança.

#### Acceptance Criteria

1. THE Marketing_Config_Page SHALL renderizar formulário com: campo Access Token (segredo), campo
   Ad Account ID, campo Pixel ID, seletor Período default e toggle Exigir consentimento para o
   Pixel.
2. WHEN um admin com `MARKETING_EDIT` salva o Access Token, THE Marketing_Service SHALL armazenar o
   valor bruto server-side via Vault e persistir em `marketing_config` apenas a referência
   `token_secret_id`, sem gravar o valor bruto em coluna legível.
3. WHEN a leitura da configuração inclui o Access Token, THE Marketing_Service SHALL retornar o
   Masked_Token com os últimos 4 caracteres visíveis e o indicador `is_set`, sem retornar o valor
   bruto (CP-7).
4. WHEN um admin com `MARKETING_EDIT` salva a configuração, THE Marketing_Service SHALL persistir
   através de `executeAdminMutation` com `action` igual a `MARKETING_CONFIG_UPDATED` e `targetType`
   igual a `marketing_config`.
5. WHEN um admin com `MARKETING_EDIT` define ou substitui o Access Token, THE Marketing_Service SHALL
   gravar audit log com `action` igual a `MARKETING_TOKEN_UPDATED`, registrando apenas metadados não
   sensíveis (`is_set`, últimos 4 caracteres), sem o valor bruto.
6. WHEN um admin com `MARKETING_EDIT` remove o Access Token já definido, THE Marketing_Service SHALL
   apagar o segredo no Vault, definir `is_set` como falso e gravar audit log com `action` igual a
   `MARKETING_TOKEN_CLEARED`.
7. WHEN um admin envia o campo Access Token em branco em um salvamento que não é de remoção, THE
   Marketing_Service SHALL preservar o segredo existente no Vault sem alterá-lo.
8. WHEN um admin salva o Ad Account ID, THE Marketing_Service SHALL validar o formato `act_` seguido
   de um ou mais dígitos.
9. IF o Ad Account ID não corresponde ao formato `act_<digits>`, THEN THE Marketing_Config_Page SHALL
   exibir erro inline e desabilitar o botão Salvar.
10. WHEN um admin salva o Pixel ID, THE Marketing_Service SHALL validar que o valor é composto
    somente por dígitos.
11. THE Marketing_Service SHALL aplicar versionamento otimista usando `updated_at` na atualização da
    configuração; IF o `expected_updated_at` enviado não corresponde ao `updated_at` atual, THEN a
    atualização SHALL ser rejeitada com `STALE_VERSION` sem mutar.
12. THE Period default SHALL pertencer ao domínio fechado de Metric_Period (`today`, `7d`, `30d`),
    com valor inicial `7d`.
13. WHEN o salvamento conclui com sucesso, THE Marketing_Config_Page SHALL exibir toast
    `Configuração salva.` com `role` igual a `status` e recarregar os valores vigentes.

### Requirement 4: Edge Function de leitura da Meta Marketing API

**User Story:** Como plataforma, quero que toda leitura da Meta Marketing API passe por uma Edge
Function, para que o token nunca seja exposto ao navegador e o frontend nunca chame a Meta
diretamente.

#### Acceptance Criteria

1. THE Meta_Read_Function SHALL ser o único caminho pelo qual o painel obtém métricas da
   Meta_Marketing_API.
2. THE Meta_Read_Function SHALL ler o Meta_Access_Token do Vault server-side e nunca incluí-lo em
   nenhuma resposta retornada ao cliente (CP-7).
3. WHEN o painel solicita métricas, THE Meta_Read_Function SHALL exigir um caller autenticado com
   `MARKETING_VIEW` antes de consultar a Meta_Marketing_API.
4. IF o caller não tem `MARKETING_VIEW`, THEN THE Meta_Read_Function SHALL retornar
   `permission_denied` e registrar `MARKETING_VIEW_DENIED`.
5. WHEN a Meta_Read_Function recebe um Metric_Period, THE Meta_Read_Function SHALL derivar o
   Period_Range via Resolve_Period (CP-1) e aplicar o intervalo correspondente na consulta à
   Meta_Marketing_API.
6. IF o Metric_Period recebido está fora do domínio fechado (`today`, `7d`, `30d`), THEN THE
   Meta_Read_Function SHALL rejeitar a requisição com erro de validação `INVALID_PERIOD`.
7. IF o Meta_Access_Token não está configurado no Vault, THEN THE Meta_Read_Function SHALL retornar
   o erro `TOKEN_NOT_CONFIGURED` sem chamar a Meta_Marketing_API.
8. IF a Meta_Marketing_API retorna erro ou está indisponível, THEN THE Meta_Read_Function SHALL
   retornar um erro estruturado `META_API_UNAVAILABLE` com o status de origem, sem vazar o token.
9. THE Meta_Read_Function SHALL retornar Campaign_Metrics agregadas e a lista de
   Creative_Performance necessárias ao painel.
10. IF a Meta_Marketing_API retorna métricas em que `clicks` excede `impressions`, THEN THE
    Meta_Read_Function SHALL rejeitar o registro como inválido com erro `INVALID_METRICS` em vez de
    derivar um CTR maior que 100%.

### Requirement 5: Painel de métricas com filtro de período

**User Story:** Como admin com `MARKETING_VIEW`, quero ver as principais métricas das campanhas
ativas em quase tempo real, com filtro de período, para acompanhar o desempenho dos anúncios.

#### Acceptance Criteria

1. THE Marketing_Metrics_Page SHALL exibir cards de KPI para gasto total, impressões, cliques, CPL,
   CPC, CTR e conversões, seguindo o estilo de cards do Compact_Layout_Pattern.
2. THE Marketing_Metrics_Page SHALL oferecer um seletor de período com as opções Hoje, Últimos 7
   dias e Últimos 30 dias, mapeadas para Metric_Period `today`, `7d` e `30d`.
3. WHEN a Marketing_Metrics_Page é aberta sem período na URL, THE Marketing_Metrics_Page SHALL
   aplicar o Period default vindo de marketing_config.
4. WHEN o admin seleciona um período, THE Marketing_Metrics_Page SHALL preservar o Metric_Period
   como query param na URL e re-buscar as métricas via Meta_Read_Function.
5. IF um query param de período recebe valor fora do domínio Metric_Period, THEN THE
   Marketing_Metrics_Page SHALL ignorar o param e aplicar o Period default.
6. THE Marketing_Metrics_Page SHALL derivar `ctr`, `cpc` e `cpl` exclusivamente via Compute_Metrics
   (CP-2).
7. WHEN `impressions` é 0, THE Marketing_Metrics_Page SHALL exibir CTR como `0%`.
8. WHEN `clicks` é 0, THE Marketing_Metrics_Page SHALL exibir CPC como um traço (`—`) indicando
   valor indefinido, refletindo `cpc == null`.
9. WHEN `clicks` é maior que 0 e `spend` é 0, THE Marketing_Metrics_Page SHALL exibir CPC como
   `0,00`, refletindo `cpc == 0`.
10. WHEN `leads` é 0, THE Marketing_Metrics_Page SHALL exibir CPL como um traço (`—`) indicando valor
    indefinido, refletindo `cpl == null`.
11. WHEN a Meta_Read_Function retorna `TOKEN_NOT_CONFIGURED`, THE Marketing_Metrics_Page SHALL exibir
    um estado vazio orientando o admin a configurar a integração, com link gated por `MARKETING_EDIT`.
12. WHEN a Meta_Read_Function retorna `META_API_UNAVAILABLE`, THE Marketing_Metrics_Page SHALL exibir
    estado de erro com botão Tentar novamente, sem quebrar a página.
13. THE Marketing_Metrics_Page SHALL renderizar a evolução das métricas em gráfico SVG inline, sem
    usar Recharts/Chart.js.
14. WHEN o viewport tem largura menor que 768px, THE Marketing_Metrics_Page SHALL empilhar os cards
    de KPI em coluna única.
15. THE cards de KPI SHALL ter `role` igual a `region` e `aria-label` agregando rótulo e valor.

### Requirement 6: Ranking de criativos

**User Story:** Como admin com `MARKETING_VIEW`, quero ver quais criativos têm melhor desempenho e
quais estão desperdiçando dinheiro, para otimizar os anúncios.

#### Acceptance Criteria

1. THE Marketing_Metrics_Page SHALL exibir uma seção de ranking de criativos baseada nas
   Creative_Performance retornadas pela Meta_Read_Function.
2. THE Marketing_Metrics_Page SHALL ordenar os criativos via Rank_Creatives (CP-3) pela métrica
   selecionada.
3. THE Rank_Creatives SHALL produzir uma ordem total com desempate estável e determinístico por
   `creative_id` ascendente quando dois criativos têm o mesmo valor da métrica.
4. THE Marketing_Metrics_Page SHALL destacar os melhores criativos (melhor desempenho) e os piores
   (maior desperdício) conforme a direção da métrica escolhida.
5. WHEN não há criativos no período, THE Marketing_Metrics_Page SHALL exibir a mensagem
   `Nenhum criativo no período selecionado.`.
6. THE seção de ranking SHALL respeitar o Compact_Layout_Pattern e virar lista de cards
   single-column quando a largura do viewport for menor que 768px.

### Requirement 7: Cache de snapshots de métricas

**User Story:** Como plataforma, quero cachear snapshots de métricas, para evitar consultas
excessivas à Meta Marketing API e exibir dados em quase tempo real sem ultrapassar limites de taxa.

#### Acceptance Criteria

1. THE Migration_048 SHALL criar a tabela marketing_metrics_cache indexada por `(ad_account_id,
   period_key)`.
2. WHEN a Meta_Read_Function obtém métricas frescas da Meta_Marketing_API, THE Meta_Read_Function
   SHALL gravar um snapshot em marketing_metrics_cache com o `fetched_at` corrente.
3. WHEN o painel solicita métricas e existe um snapshot com idade menor ou igual à janela de
   frescor configurada, THE Meta_Read_Function SHALL retornar o snapshot cacheado sem chamar a
   Meta_Marketing_API.
4. WHEN existe snapshot porém a Meta_Marketing_API está indisponível em uma atualização, THE
   Meta_Read_Function SHALL retornar o último snapshot disponível marcado como `stale` igual a
   verdadeiro, incluindo sempre o indicador `stale` na resposta.
5. THE Meta_Read_Function SHALL incluir na resposta o `fetched_at` do snapshot e o indicador `stale`
   (verdadeiro ou falso) para que o painel comunique a idade dos dados.

### Requirement 8: Meta Pixel no frontend com consentimento LGPD

**User Story:** Como visitante do site público, quero que o Meta Pixel só seja carregado após meu
consentimento de cookies, para que minha privacidade seja respeitada conforme a LGPD.

#### Acceptance Criteria

1. WHILE o Consent_State é `denied`, THE Pixel_Loader SHALL NÃO injetar o script do Meta Pixel nem
   inicializar `fbq` (CP-5).
2. WHEN o Consent_State transiciona para `granted`, THE Pixel_Loader SHALL injetar o script do Meta
   Pixel e inicializar `fbq` no máximo uma vez (idempotente).
3. WHEN o Pixel está inicializado e ocorre um Tracked_Event, THE Pixel_Loader SHALL disparar o
   evento correspondente via `fbq` incluindo o Event_Id daquela ocorrência (CP-4).
4. WHILE o Consent_State é `denied`, THE Pixel_Loader SHALL NÃO disparar nenhum evento `fbq`,
   independentemente do estado de inicialização do Pixel.
5. THE Pixel_Loader SHALL mapear os Tracked_Event para eventos da Meta: `page_view` para `PageView`,
   `lead`/`motorista_registration`/`embarcador_registration` para `Lead`, e `frete_published` para
   um evento de conteúdo (`CustomizeProduct` ou custom equivalente documentado no design).
6. WHERE `consent_required` é falso em marketing_config, THE Pixel_Loader SHALL ainda assim respeitar
   o Consent_State do visitante para o Pixel do navegador (decisão confirmada LGPD: o Pixel do
   navegador carrega somente após consentimento).
7. THE Pixel_Id usado pelo Pixel_Loader SHALL vir de marketing_config (não hardcoded).
8. THE integração do Pixel SHALL ocorrer no site público e NÃO SHALL ser gated por permissões
   administrativas.

### Requirement 9: Conversions API (CAPI) server-side

**User Story:** Como plataforma, quero enviar os eventos importantes via CAPI server-side, para
garantir rastreamento preciso mesmo com bloqueadores de anúncios ou restrições do iOS.

#### Acceptance Criteria

1. WHEN um Tracked_Event relevante ocorre no sistema (`motorista_registration`,
   `embarcador_registration`, `frete_published`), THE Meta_CAPI_Function SHALL encaminhar o evento
   server-side à Meta via CAPI.
2. THE Meta_CAPI_Function SHALL enviar o evento com o mesmo Event_Id usado pelo Pixel para aquela
   ocorrência, para que a Meta faça a deduplicação (CP-4).
3. THE Meta_CAPI_Function SHALL continuar enviando os eventos originados pelo sistema
   independentemente do Consent_State do navegador, enquanto o Pixel do navegador respeita o
   consentimento (a deduplicação por Event_Id evita contagem dupla).
4. WHEN a Meta_CAPI_Function recebe dados pessoais (e-mail, telefone), THE Meta_CAPI_Function SHALL
   normalizá-los e hasheá-los em SHA-256 antes do envio (CP-6), nunca enviando PII em texto claro.
5. THE Meta_CAPI_Function SHALL registrar cada evento enviado em marketing_events com `event_id`,
   `event_name`, identificadores hasheados, `event_time` e `send_status`.
6. IF a chamada CAPI à Meta falha, THEN THE Meta_CAPI_Function SHALL gravar o evento com
   `send_status` igual a `failed` e retornar erro estruturado sem vazar segredos.
7. THE Meta_CAPI_Function SHALL ler o Meta_Access_Token do Vault server-side e nunca expô-lo em
   respostas (CP-7).
8. THE marketing_events SHALL impor unicidade em `event_id` para que reenvios não dupliquem o
   registro de log.

### Requirement 10: Eventos rastreados e geração de event_id compartilhado

**User Story:** Como sistema, quero gerar um event_id único por ocorrência e usá-lo tanto no Pixel
quanto no CAPI, para que a Meta deduplique corretamente os eventos.

#### Acceptance Criteria

1. THE sistema SHALL suportar os Tracked_Event do domínio fechado: `page_view`, `lead`,
   `motorista_registration`, `embarcador_registration`, `frete_published`.
2. WHEN um Tracked_Event ocorre, THE sistema SHALL gerar um Event_Id UUID v4 uma única vez para
   aquela ocorrência.
3. THE sistema SHALL fornecer o mesmo Event_Id ao disparo do Pixel (browser) e ao disparo do CAPI
   (server) para aquela ocorrência (CP-4).
4. WHEN o cadastro de um motorista é concluído, THE sistema SHALL emitir o Tracked_Event
   `motorista_registration`.
5. WHEN o cadastro de um embarcador é concluído, THE sistema SHALL emitir o Tracked_Event
   `embarcador_registration`.
6. WHEN um frete é publicado, THE sistema SHALL emitir o Tracked_Event `frete_published`.
7. THE Event_Id SHALL ser um UUID v4 válido.

### Requirement 11: Hashing de PII conforme exigência da Meta

**User Story:** Como plataforma, quero hashear os dados pessoais enviados via CAPI em SHA-256, para
cumprir a exigência da Meta e proteger os dados dos usuários.

#### Acceptance Criteria

1. THE Meta_CAPI_Function SHALL normalizar e-mails com trim e lowercase antes do hash.
2. THE Meta_CAPI_Function SHALL normalizar telefones removendo caracteres não numéricos e mantendo o
   DDI antes do hash.
3. THE Meta_CAPI_Function SHALL produzir o PII_Hash como SHA-256 em hexadecimal minúsculo de
   exatamente 64 caracteres (CP-6).
4. THE normalização de PII SHALL ser idempotente: normalizar um valor já normalizado produz o mesmo
   valor (CP-6).
5. WHEN um valor recebido já está no formato de PII_Hash (64 hex minúsculos), THE Meta_CAPI_Function
   SHALL NÃO hasheá-lo novamente (CP-6).
6. THE Meta_CAPI_Function SHALL persistir em marketing_events apenas os valores hasheados, nunca o
   PII em texto claro.

### Requirement 12: Segurança do token (nunca exposto ao frontend)

**User Story:** Como plataforma, quero garantir que o Meta Access Token nunca apareça em payloads
voltados ao frontend, para que a credencial não vaze pelo painel ou pela rede.

#### Acceptance Criteria

1. THE leitura da configuração de marketing retornada ao cliente SHALL conter apenas o Masked_Token
   (últimos 4 caracteres) e o indicador `is_set`, nunca o valor bruto (CP-7).
2. THE Meta_Read_Function e a Meta_CAPI_Function SHALL ler o Meta_Access_Token do Vault apenas
   server-side e nunca incluí-lo em respostas, logs de cliente ou mensagens de erro (CP-7).
3. THE Marketing_Service do frontend SHALL NÃO conter nenhuma chamada direta à Meta_Marketing_API
   nem qualquer referência ao Meta_Access_Token em texto claro.
4. WHEN qualquer Edge Function de marketing retorna erro, THE mensagem de erro SHALL ser estruturada
   e livre do Meta_Access_Token e de outros segredos.

### Requirement 13: Migration 048 e idempotência

**User Story:** Como engenheiro, quero aplicar a migration 048 sem efeitos colaterais em
reexecuções, para que o deploy seja seguro e reversível.

#### Acceptance Criteria

1. THE Migration_048 SHALL ser nomeada `supabase/migrations/048_admin_marketing.sql`, sendo a
   próxima numeração livre após 047 (`admin-assistant`), sem buracos.
2. THE Migration_048 SHALL ser envelopada em `BEGIN; ... COMMIT;`.
3. THE Migration_048 SHALL ser idempotente em reexecução, usando `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de
   `CREATE POLICY` e `INSERT ... ON CONFLICT DO NOTHING` em seeds.
4. THE Migration_048 SHALL incluir bloco `DO $check$` defensivo validando que
   `is_admin_with_permission` e `admin_audit_logs` existem e que a extensão `supabase_vault` está
   habilitada, levantando exceção clara caso ausentes.
5. THE Migration_048 SHALL criar as tabelas marketing_config, marketing_events e
   marketing_metrics_cache.
6. THE Migration_048 SHALL definir as RPCs de leitura e mutação de configuração como
   `SECURITY DEFINER` com `SET search_path = public`, `REVOKE ALL FROM PUBLIC` e
   `GRANT EXECUTE TO authenticated`.
7. THE Migration_048 SHALL ser acompanhada de `048_admin_marketing_rollback.sql` que documenta os
   `DROP` reversos, não auto-aplicado, com comentário avisando que o segredo no Vault deve ser
   removido manualmente.
8. THE Migration_048 SHALL conter, ao final, um bloco `-- VERIFY` comentado com SELECTs de smoke
   test.

### Requirement 14: Acessibilidade e responsividade

**User Story:** Como admin usando teclado, leitor de tela ou dispositivo móvel, quero usar o módulo
Marketing com a mesma cobertura, para que o módulo seja acessível.

#### Acceptance Criteria

1. THE Marketing_Metrics_Page SHALL associar o seletor de período e os campos de configuração a
   rótulos via `htmlFor` ou `aria-label`.
2. THE Marketing_Metrics_Page SHALL ser responsiva, empilhando cards e seções em coluna única em
   telas menores que 768px; em telas maiores ou iguais a 768px, as seções SHALL empilhar
   verticalmente enquanto os cards de KPI permanecem lado a lado em grade.
3. THE Marketing_Metrics_Page SHALL exibir toasts de sucesso e erro com `role` igual a `status` ou
   `alert`, conforme apropriado.
4. WHERE um controle de ação é apenas ícone, THE Marketing_Metrics_Page SHALL prover `aria-label`
   descritivo.
5. THE Marketing_Metrics_Page SHALL manter contraste mínimo WCAG AA nos textos e controles
   interativos.
6. THE gráficos SVG inline SHALL prover alternativa textual acessível (ex.: `aria-label` ou
   `<title>`/`<desc>`) descrevendo a métrica representada.

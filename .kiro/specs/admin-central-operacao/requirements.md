# Requirements Document

## Introduction

A **Central de Operação** (`Central_Operacao`) entrega ao painel admin do FreteGO o "centro de comando"
operacional do dono — administrador único inicial — reunindo três superfícies que andam juntas: um
**Painel Operacional em tempo real** (`Operations_Dashboard`), um **Sistema de Alertas**
(`Alerts_Center`) e um **Visualizador de Logs** (`Logs_Viewer`). Esta spec cobre as partes **7
(Painel Administrativo)**, **8 (Sistema de Alertas)** e **9 (Logs)** do documento de ideias do dono
(`Credencial/Ideias`):

7. **Painel Administrativo** — um dashboard mostrando, com atualização automática: Usuários
   cadastrados, Usuários online, Novos cadastros do dia, Assinaturas ativas, Assinaturas vencidas,
   Tickets abertos, Tickets em andamento, Tickets resolvidos, Mensagens enviadas, Mensagens
   programadas e Mensagens com erro.
8. **Sistema de Alertas** — o sistema gera alertas para situações importantes: WhatsApp desconectado,
   Campanha pausada, Campanha com erro, Falha de integração, Assinatura vencendo e Cliente aguardando
   resposta.
9. **Logs** — uma área que mostra tudo que aconteceu no sistema, com data e hora: Login realizado,
   Logout, Disparo iniciado, Disparo concluído, Erro ocorrido, Cliente criado, Plano alterado, IA
   respondeu e Atendimento humano assumiu.

Esta é a **terceira de quatro specs** derivadas do documento do dono. As anteriores são
`suporte-inteligente` (migration 115, partes 1/4/5/6/10) e `admin-cliente-360` (migration 116, partes
2/3). A quarta, reservada, é `admin-ia-supervisora` (migration 118). Esta spec **não** recria módulos
existentes: ela **amplia e compõe** o que já está em produção, em especial o padrão de métricas
agregadas de `admin-dashboard`, as fontes de evento de `whatsapp-automation`/`notifications-hub` e o
registro de ações administrativas de `admin-foundation`.

### Governança embutida (Complemento "Segurança, Qualidade e Testes" do documento)

Esta spec **não** cria uma spec de governança à parte. Cada funcionalidade entrega a própria camada
de validação e proteção, impede vazamento de dados entre usuários e contas, impede ações sem
permissão, é testável (unit + property + cenários de falha + validações no frontend **e** no
backend), trata erros de forma segura (erro tratado, registrado, sistema segue) e segue arquitetura
modular. A spec adere integralmente aos steerings `testing-governance`, `project-conventions` e
`admin-patterns`.

### Reuso obrigatório (não duplicar, não quebrar)

- **admin-dashboard (migration 036)**: o `Operations_Dashboard` (parte 7) **amplia** o padrão de
  métricas agregadas já entregue, reusando a forma de `Dashboard_Service.getMetrics` (uma RPC única
  que retorna um bundle `jsonb`), a degradação parcial via `Promise.allSettled`, os `Dashboard_KPI_Card`
  compactos e o `Dashboard_Block_Error`. Esta spec **não** substitui a página analítica de `/admin`:
  adiciona uma RPC nova `admin_operations_metrics` e uma superfície nova em `/admin/operacao` com os
  KPIs operacionais que faltam (Usuários online, Tickets por estado, Mensagens enviadas/programadas/
  com erro) e atualização automática.
- **whatsapp-automation (migrations 092+)**: fonte dos KPIs de mensagens e dos alertas de WhatsApp.
  As contagens de mensagens derivam de `Dispatch_Recipient` (estados `SENT`/`FAILED`/`PENDING`) e de
  `Scheduled_Dispatch`; os alertas derivam de `WhatsApp_Session` (estados `DISCONNECTED`/`EXPIRED`) e
  de `Dispatch_Job` (estados `PAUSED`/`FAILED`). Esta spec **lê** essas fontes sem afrouxar a RLS nem
  recriar tabelas, e degrada de forma controlada quando o módulo não está presente.
- **notifications-hub (migration 041) + suporte-inteligente (migration 115)**: fonte dos KPIs de
  tickets (`support_tickets.status` no domínio de cinco estados) e do alerta "Cliente aguardando
  resposta". Esta spec reusa/compõe o hub e o console de suporte sem recriá-los.
- **assinaturas-pagamento (migrations 055/057/060)**: fonte dos KPIs de assinaturas ativas/vencidas e
  do alerta "Assinatura vencendo", lidos como contagens agregadas (sem expor PII nem detalhes de
  cobrança no painel operacional).
- **admin-foundation (migration 030) + `admin_audit_logs` + steering `admin-patterns`**: o
  `Logs_Viewer` (parte 9) **lê** de `admin_audit_logs` (que já registra ações administrativas) e
  demais fontes de evento. Reusa AdminGuard + Stealth_404, gating em duas camadas (UI
  `useAdminPermission` + RPC `is_admin_with_permission`), `executeAdminMutation` (audit-by-construction)
  para o ack/resolve de alertas, versionamento otimista (`expected_updated_at` + `STALE_VERSION`),
  idempotência `_SKIPPED`, postura de segurança de RPC, master admin `Nexus_Vortex99` imutável e a UI
  compacta (sem `<h1>`, filtros em popover `SlidersHorizontal`, paginação `10/50/100`).

### Fonte de eventos e dependências futuras declaradas

Esta spec **não inventa fontes inexistentes**. Quando um KPI ou tipo de log do documento não possui
fonte de dados disponível hoje, a dependência é declarada e a superfície degrada de forma honesta
(KPI exibe `indisponível`; tipo de log retorna conjunto vazio), sem fabricar números:

- **Usuários online**: não há, hoje, sistema de presença por cliente final. O KPI `Online_Users`
  deriva do `Presence_Source` disponível (atividade dentro do `Online_Window`); enquanto não houver
  fonte de presença, o KPI SHALL exibir `indisponível`, e a fonte é declarada como dependência futura
  (Requirement 5).
- **Logout / Cliente criado**: `admin_audit_logs` registra hoje ações administrativas, não eventos
  de logout de cliente nem de criação de conta de cliente. Os `Log_Event_Type` `LOGOUT` e
  `CLIENT_CREATED` mapeiam para action codes que podem ainda não ser emitidos; nesse caso o
  `Logs_Viewer` retorna zero linhas para o tipo, sem fabricar registros, e a emissão da fonte é
  declarada como dependência futura (Requirement 12).
- **Disparo iniciado/concluído, IA respondeu, Atendimento humano assumiu, Plano alterado**: mapeiam
  para action codes de `whatsapp-automation` (092+), `suporte-inteligente` (115) e
  `assinaturas-pagamento`/`admin-subscriptions` (055/057/060). Os códigos exatos são resolvidos no
  design; tipos sem fonte presente retornam conjunto vazio sem erro.

### Migration

A entrega adiciona a **migration 117** (`117_admin_central_operacao.sql` + par documentado
`117_admin_central_operacao_rollback.sql`), próxima numeração livre (115/115b pertencem a
`suporte-inteligente`; 116 a `admin-cliente-360`; 118 reservada à quarta spec, `admin-ia-supervisora`).
Caso seja necessária uma segunda migration, esta SHALL usar o sufixo de letra `117b_...`, preservando
o número 118.

### Idioma e convenções

Requisitos, UI e mensagens user-facing em **pt-BR**; action codes, error codes e identifiers em
**inglês** (UPPER_SNAKE). Mensagens canônicas anti-enumeração quando aplicável. As Correctness
Properties (Propriedades de Corretude) desta spec do painel são **obrigatórias** (sem asterisco);
propriedades opcionais, quando houver, são marcadas com `*`.

## Glossary

- **Central_Operacao**: Módulo desta spec, que reúne o `Operations_Dashboard` (parte 7), o
  `Alerts_Center` (parte 8) e o `Logs_Viewer` (parte 9) sob a área `/admin/operacao`.
- **Admin_Panel**: Painel administrativo de `admin-foundation` (migration 030), acessível em
  `/admin/*`.
- **AdminGuard / AdminShell / AdminSidebar / useAdminPermission**: Componentes e hook de fundação
  reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Master_Admin**: Dono do sistema, `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique),
  imutável.
- **Cliente**: Usuário comum sob administração, com `users.user_type ∈ {motorista, embarcador}`.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) → boolean` em
  `src/services/admin/permissions.ts`, espelhada server-side por `is_admin_with_permission`.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a Permission_Matrix
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`; toda
  mutação admin desta spec (ack/resolve de alerta) passa por aqui.
- **STALE_VERSION**: Erro padrão do projeto quando `expected_updated_at` não corresponde ao
  `updated_at` atual da linha (versionamento otimista).
- **Partial_Degradation**: Padrão herdado de `getMetrics`/`getUserDetail`: cada bloco/KPI é carregado
  de forma isolada (`Promise.allSettled`); a falha de um bloco registra `bundle.errors[bloco]` e
  renderiza erro apenas naquele bloco, sem derrubar os demais.

### Painel Operacional (parte 7)

- **Operations_Dashboard**: Superfície de dashboard em tempo real renderizada em `/admin/operacao`,
  que exibe os `Dashboard_KPI` operacionais com atualização automática.
- **Operations_Service**: Camada de serviço em `src/services/admin/operacao.ts` que monta o
  `Operations_Metrics_Bundle`, reusando a forma de `Dashboard_Service.getMetrics`.
- **Operations_Metrics_RPC**: Função SQL `admin_operations_metrics()` `SECURITY DEFINER`, `STABLE`,
  gated por `DASHBOARD_VIEW`, que retorna o `Operations_Metrics_Bundle` completo em uma única chamada
  server-side.
- **Operations_Metrics_Bundle**: Estrutura agregada `jsonb` retornada pela `Operations_Metrics_RPC`,
  contendo os `Dashboard_KPI` por grupo e um mapa `errors` de grupos indisponíveis
  (`Partial_Degradation`).
- **Dashboard_KPI**: Estrutura de um indicador `{ value: number | null, available: boolean }`
  reusada de `admin-dashboard`. `available = false` (UI exibe `indisponível`) quando a fonte do KPI
  não está presente; `value = null` nunca é exibido como `0`.
- **Dashboard_KPI_Card**: Card visual compacto que renderiza um `Dashboard_KPI` (label
  `text-[10px] uppercase`, valor `text-base sm:text-lg font-semibold`), reusado de `admin-dashboard`.
- **Dashboard_Block_Error**: Estado de erro local de um grupo de KPIs, com mensagem `Dados
  indisponíveis` e botão `Tentar novamente`, reusado de `admin-dashboard`.
- **Operations_KPI**: Domínio fechado dos onze indicadores da parte 7: `USERS_TOTAL` (Usuários
  cadastrados), `USERS_ONLINE` (Usuários online), `SIGNUPS_TODAY` (Novos cadastros do dia),
  `SUBSCRIPTIONS_ACTIVE` (Assinaturas ativas), `SUBSCRIPTIONS_EXPIRED` (Assinaturas vencidas),
  `TICKETS_OPEN` (Tickets abertos), `TICKETS_IN_PROGRESS` (Tickets em andamento), `TICKETS_RESOLVED`
  (Tickets resolvidos), `MESSAGES_SENT` (Mensagens enviadas), `MESSAGES_SCHEDULED` (Mensagens
  programadas) e `MESSAGES_ERROR` (Mensagens com erro).
- **Today_Window**: Intervalo `[início do dia atual em UTC, NOW()]`, usado pelos KPIs de fluxo do dia
  (`SIGNUPS_TODAY`, `MESSAGES_SENT`, `MESSAGES_ERROR`).
- **Online_Window**: Janela de atividade recente (padrão 5 minutos, configurável) que define o
  conjunto de `Online_User`.
- **Presence_Source**: Fonte de sinal de presença/atividade recente usada para `USERS_ONLINE`.
  Declarada como dependência: enquanto ausente, `USERS_ONLINE.available = false`.
- **Online_User**: Cliente com atividade no `Presence_Source` dentro do `Online_Window`.
- **Realtime_Refresh**: Mecanismo de atualização automática do `Operations_Dashboard`, que re-invoca a
  `Operations_Metrics_RPC` em intervalo fixo (`Refresh_Interval`), pausa quando a aba está oculta,
  retoma ao ficar visível, garante uma única requisição em voo por vez (sem sobreposição) e permite
  atualização manual que reinicia o temporizador.
- **Refresh_Interval**: Intervalo do `Realtime_Refresh` (padrão 30 segundos, configurável), nunca
  inferior a um piso de segurança para evitar sobrecarga.

### Sistema de Alertas (parte 8)

- **Alerts_Center**: Superfície renderizada em `/admin/operacao/alertas` que lista, filtra e opera os
  `System_Alert`.
- **System_Alert**: Alerta persistido em `system_alerts` que representa uma situação importante
  detectada pelo sistema. Contém ao menos: `id`, `alert_type`, `severity`, `state`, `source_type`,
  `source_id`, `dedup_key`, `title`, `detail` (jsonb sem PII nem segredos), `first_seen_at`,
  `last_seen_at`, `acknowledged_at`, `acknowledged_by`, `resolved_at`, `resolved_by`, `created_at` e
  `updated_at`.
- **Alert_Type**: Domínio fechado dos seis tipos da parte 8: `WHATSAPP_DISCONNECTED`,
  `CAMPAIGN_PAUSED`, `CAMPAIGN_ERROR`, `INTEGRATION_FAILURE`, `SUBSCRIPTION_EXPIRING` e
  `CUSTOMER_AWAITING`.
- **Alert_Severity**: Domínio fechado `{CRITICAL, WARNING, INFO}` de severidade do alerta.
- **Alert_Severity_Map**: Mapeamento determinístico `Alert_Type → Alert_Severity`:
  `WHATSAPP_DISCONNECTED → CRITICAL`, `CAMPAIGN_ERROR → CRITICAL`, `INTEGRATION_FAILURE → CRITICAL`,
  `CAMPAIGN_PAUSED → WARNING`, `SUBSCRIPTION_EXPIRING → WARNING`, `CUSTOMER_AWAITING → WARNING`.
- **Alert_State**: Domínio fechado `{OPEN, ACKNOWLEDGED, RESOLVED}` do ciclo de vida do alerta.
- **Alert_Source**: Origem do alerta: par `(source_type, source_id)`, por exemplo
  `('whatsapp_session', <instance_id>)`, `('dispatch_job', <dispatch_id>)`, `('integration', <key>)`,
  `('subscription', <user_id>)`, `('support_ticket', <ticket_id>)`.
- **Alert_Dedup_Key**: Chave de deduplicação determinística derivada de `(alert_type, source_type,
  source_id)`. Um índice único parcial sobre `dedup_key WHERE state IN ('OPEN','ACKNOWLEDGED')`
  garante no máximo um alerta ativo por situação.
- **Alert_Evaluator**: Função determinística que, dado o estado atual das fontes (`whatsapp_sessions`,
  `dispatch_jobs`, integrações, `subscriptions`, `support_tickets`), produz o conjunto de
  `(Alert_Type, Alert_Source)` que devem estar ativos no momento.
- **Alerts_Evaluate_RPC**: Função SQL `admin_alerts_evaluate()` `SECURITY DEFINER`, invocada por
  agendador durável (`pg_cron`) e/ou sob demanda por admin com `ALERT_VIEW`, que reconcilia
  `system_alerts` com o `Alert_Evaluator`: abre alertas novos, atualiza `last_seen_at` dos já ativos
  (sem duplicar) e resolve automaticamente os alertas cuja condição deixou de valer.
- **Alerts_List_RPC**: Função SQL `admin_alerts_list(p_state, p_type, p_severity, p_limit, p_offset)`
  `SECURITY DEFINER`, gated por `ALERT_VIEW`, que retorna os `System_Alert` filtrados e paginados.
- **Alert_Acknowledge_RPC**: Função SQL `admin_alert_acknowledge(p_id, p_expected_updated_at)`
  `SECURITY DEFINER`, gated por `ALERT_ACK`, que reconhece um alerta `OPEN`.
- **Alert_Resolve_RPC**: Função SQL `admin_alert_resolve(p_id, p_expected_updated_at)`
  `SECURITY DEFINER`, gated por `ALERT_RESOLVE`, que resolve um alerta `OPEN` ou `ACKNOWLEDGED`.
- **Expiring_Window**: Janela de antecedência (padrão 3 dias, configurável) que caracteriza uma
  assinatura como "vencendo" para o alerta `SUBSCRIPTION_EXPIRING`.
- **Awaiting_Threshold**: Tempo mínimo de espera (padrão configurável em minutos) sem resposta humana
  que caracteriza um atendimento como "cliente aguardando resposta" para o alerta `CUSTOMER_AWAITING`.

### Visualizador de Logs (parte 9)

- **Logs_Viewer**: Superfície somente-leitura renderizada em `/admin/operacao/logs` que exibe os
  `Log_Entry` com data e hora, filtros em popover e paginação `10/50/100`.
- **Log_Entry**: Item somente-leitura de log, derivado de uma fonte de evento, com ao menos:
  `occurred_at`, `event_type`, `actor` (quando aplicável), `target_type`, `target_id` e `summary`
  (descrição em pt-BR sem PII bruta nem segredos).
- **Log_Source**: Fonte de eventos do `Logs_Viewer`. A fonte primária é `admin_audit_logs` (ações
  administrativas já registradas); fontes adicionais de evento são compostas conforme o
  `Log_Event_Map`.
- **Log_Event_Type**: Domínio fechado dos nove tipos da parte 9: `LOGIN` (Login realizado), `LOGOUT`
  (Logout), `DISPATCH_STARTED` (Disparo iniciado), `DISPATCH_COMPLETED` (Disparo concluído),
  `ERROR_OCCURRED` (Erro ocorrido), `CLIENT_CREATED` (Cliente criado), `PLAN_CHANGED` (Plano
  alterado), `AI_REPLIED` (IA respondeu) e `HUMAN_TAKEOVER` (Atendimento humano assumiu).
- **Log_Event_Map**: Mapeamento determinístico de cada `Log_Event_Type` para o conjunto de action
  codes / fontes que o originam. Tipos sem fonte emissora presente resolvem para conjunto vazio.
- **Log_Filter**: Conjunto de filtros do `Logs_Viewer` (tipo de evento, intervalo de datas, ator,
  tipo de alvo), exposto em popover via ícone `SlidersHorizontal`.
- **Logs_List_RPC**: Função SQL `admin_logs_list(p_event_types, p_from, p_to, p_actor, p_limit,
  p_offset)` `SECURITY DEFINER`, gated por `LOG_VIEW`, que retorna os `Log_Entry` filtrados,
  ordenados por `occurred_at` decrescente e paginados, sem expor PII bruta nem segredos.

### Permissões e códigos

- **DASHBOARD_VIEW**: Permissão **reusada** de `admin-dashboard` (migration 036), exigida para o
  `Operations_Dashboard`.
- **ALERT_VIEW / ALERT_ACK / ALERT_RESOLVE**: Permissões **novas** desta spec para ler alertas,
  reconhecer alertas e resolver alertas, respectivamente.
- **LOG_VIEW**: Permissão **nova** desta spec para ler o `Logs_Viewer`.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `ALERT_ACK`, `ALERT_RESOLVE`,
  `ALERT_GENERATED`, `ALERT_ACK_SKIPPED`, `ALERT_RESOLVE_SKIPPED`, `DASHBOARD_VIEW_DENIED`,
  `ALERT_VIEW_DENIED`, `LOG_VIEW_DENIED`.
- **Migration_117**: Arquivo `supabase/migrations/117_admin_central_operacao.sql`, dependente das
  migrations `001..116`, idempotente, com par `117_admin_central_operacao_rollback.sql`.
- **Canonical_Anti_Enumeration_Message**: Mensagem user-facing genérica que não revela existência de
  dado/rota a quem não tem permissão (`Stealth_404` na navegação; `permission_denied` na RPC).

## Requirements

### Requirement 1: Área `/admin/operacao`, rotas e gating em duas camadas

**User Story:** Como administrador autorizado, quero acessar a Central de Operação com rotas próprias
para painel, alertas e logs, seguindo o padrão compacto do painel, para que apenas pessoas
autorizadas operem cada superfície.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/operacao` renderizando o Operations_Dashboard, a
   rota `/admin/operacao/alertas` renderizando o Alerts_Center e a rota `/admin/operacao/logs`
   renderizando o Logs_Viewer.
2. WHEN um administrador com `DASHBOARD_VIEW` acessa `/admin/operacao`, THE AdminGuard SHALL renderizar
   o Operations_Dashboard.
3. IF um usuário sem `DASHBOARD_VIEW` acessa `/admin/operacao`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
4. WHEN um administrador com `ALERT_VIEW` acessa `/admin/operacao/alertas`, THE AdminGuard SHALL
   renderizar o Alerts_Center.
5. IF um usuário sem `ALERT_VIEW` acessa `/admin/operacao/alertas`, THEN THE AdminGuard SHALL
   renderizar Stealth_404.
6. WHEN um administrador com `LOG_VIEW` acessa `/admin/operacao/logs`, THE AdminGuard SHALL renderizar
   o Logs_Viewer.
7. IF um usuário sem `LOG_VIEW` acessa `/admin/operacao/logs`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
8. THE AdminSidebar SHALL exibir o item `Operação` apontando para `/admin/operacao`, gated por
   `DASHBOARD_VIEW`.
9. THE Operations_Dashboard, o Alerts_Center e o Logs_Viewer SHALL omitir o `<h1>` grande no topo da
   página, seguindo o padrão compacto do painel.
10. WHEN `auth.uid()` é nulo em qualquer RPC desta spec, THE Central_Operacao SHALL negar a operação
    com `permission_denied`.

### Requirement 2: Permissões RBAC reusadas e novas

**User Story:** Como mantenedor da plataforma, quero permissões dedicadas e gating em duas camadas
para a Central de Operação, para que cada papel acesse apenas o que lhe compete.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL reusar `DASHBOARD_VIEW` para a leitura do Operations_Dashboard, sem
   redefinir a concessão por papel já estabelecida em `admin-dashboard`.
2. THE Permission_Matrix SHALL definir as ações novas `ALERT_VIEW`, `ALERT_ACK`, `ALERT_RESOLVE` e
   `LOG_VIEW`.
3. THE Permission_Matrix SHALL conceder `ALERT_VIEW`, `ALERT_ACK`, `ALERT_RESOLVE` e `LOG_VIEW`
   apenas a `SUPER_ADMIN` e `ADMIN`, negando a `SUPORTE`, `FINANCEIRO` e `MODERADOR` por construção
   (deny-by-default).
4. THE função `is_admin_with_permission` SHALL reconhecer `ALERT_VIEW`, `ALERT_ACK`, `ALERT_RESOLVE`
   e `LOG_VIEW` com a mesma concessão por papel definida na Permission_Matrix.
5. WHEN o caller é anônimo, com `auth.uid()` nulo, THE `is_admin_with_permission` SHALL retornar
   falso para `ALERT_VIEW`, `ALERT_ACK`, `ALERT_RESOLVE` e `LOG_VIEW`.
6. THE Permission_Matrix SHALL manter o princípio deny-by-default, negando qualquer ação fora do
   domínio conhecido de ações.
7. IF a checagem de permissão de uma ação protegida desta spec falha para o caller, THEN THE
   Central_Operacao SHALL negar a ação independentemente do papel do caller, sem conceder exceção por
   papel.

### Requirement 3: KPIs do Painel Operacional

**User Story:** Como administrador, quero ver, em um único painel, os onze indicadores operacionais do
sistema, para entender a saúde da operação sem navegar entre módulos.

#### Acceptance Criteria

1. THE Operations_Dashboard SHALL renderizar exatamente os onze `Operations_KPI` em `Dashboard_KPI_Card`
   compactos: `USERS_TOTAL`, `USERS_ONLINE`, `SIGNUPS_TODAY`, `SUBSCRIPTIONS_ACTIVE`,
   `SUBSCRIPTIONS_EXPIRED`, `TICKETS_OPEN`, `TICKETS_IN_PROGRESS`, `TICKETS_RESOLVED`, `MESSAGES_SENT`,
   `MESSAGES_SCHEDULED` e `MESSAGES_ERROR`.
2. THE Operations_Metrics_RPC SHALL computar `USERS_TOTAL` como a contagem de `users` com
   `user_type ∈ {motorista, embarcador}`.
3. THE Operations_Metrics_RPC SHALL computar `SIGNUPS_TODAY` como a contagem de `users` com
   `user_type ∈ {motorista, embarcador}` e `created_at` dentro do `Today_Window`.
4. THE Operations_Metrics_RPC SHALL computar `SUBSCRIPTIONS_ACTIVE` e `SUBSCRIPTIONS_EXPIRED` como
   contagens agregadas derivadas das fontes de assinatura de `assinaturas-pagamento`, sem expor PII
   nem detalhes individuais de cobrança no painel.
5. THE Operations_Metrics_RPC SHALL computar `TICKETS_OPEN`, `TICKETS_IN_PROGRESS` e
   `TICKETS_RESOLVED` como as contagens de `support_tickets` nos estados `open`, `in_progress` e
   `resolved`, respectivamente, conforme o domínio de cinco estados de `suporte-inteligente`.
6. THE Operations_Metrics_RPC SHALL computar `MESSAGES_SENT` como a contagem de `Dispatch_Recipient`
   em estado `SENT` dentro do `Today_Window`, `MESSAGES_ERROR` como a contagem em estado `FAILED`
   dentro do `Today_Window` e `MESSAGES_SCHEDULED` como a contagem de destinatários pendentes em
   `Scheduled_Dispatch` com execução futura, agregadas em todas as WhatsApp_Instances.
7. THE Operations_Metrics_RPC SHALL computar `USERS_ONLINE` como a contagem de `Online_User` com
   atividade no `Presence_Source` dentro do `Online_Window`.
8. WHERE o `Presence_Source` não está presente, THE Operations_Dashboard SHALL exibir o
   `Dashboard_KPI_Card` de `USERS_ONLINE` com `available = false` e o texto `indisponível`, sem
   exibir o valor `0` como se fosse uma contagem real.
9. THE Operations_Dashboard SHALL formatar cada valor numérico com separador de milhares pt-BR e
   SHALL exibir `indisponível` para qualquer `Dashboard_KPI` com `available = false`.
10. THE Operations_Dashboard SHALL apresentar os onze KPIs em layout grid responsivo, virando lista
    de cards em coluna única em viewport `<768px`.

### Requirement 4: Atualização automática e degradação parcial do painel

**User Story:** Como administrador, quero que o painel se atualize automaticamente e que a falha de
uma fonte não derrube a tela inteira, para acompanhar a operação sem recarregar a página e sempre ver
os dados disponíveis.

#### Acceptance Criteria

1. THE Operations_Dashboard SHALL aplicar o Realtime_Refresh, re-invocando a Operations_Metrics_RPC a
   cada `Refresh_Interval`, com valor inicial de 30 segundos.
2. WHILE a aba do navegador está oculta (documento não visível), THE Realtime_Refresh SHALL pausar as
   atualizações automáticas e SHALL retomá-las quando a aba voltar a ficar visível.
3. THE Realtime_Refresh SHALL garantir no máximo uma requisição de métricas em voo por vez, não
   iniciando uma nova atualização enquanto a anterior não tiver concluído.
4. WHEN o administrador aciona a atualização manual, THE Operations_Dashboard SHALL re-invocar a
   Operations_Metrics_RPC imediatamente e SHALL reiniciar o temporizador do Realtime_Refresh.
5. THE Refresh_Interval SHALL ser limitado a um piso mínimo de segurança, de modo que nenhum valor
   configurado dispare atualizações em intervalo inferior a esse piso.
6. THE Operations_Service SHALL carregar os grupos de KPIs de forma isolada via `Promise.allSettled`,
   conforme o padrão `Partial_Degradation` herdado de `getMetrics`.
7. IF a fonte de um grupo de KPIs falha em carregar, THEN THE Operations_Metrics_RPC SHALL registrar
   `errors[grupo]` no `Operations_Metrics_Bundle` e SHALL retornar os demais grupos normalmente.
8. WHEN `errors[grupo]` está presente, THE Operations_Dashboard SHALL renderizar o `Dashboard_Block_Error`
   apenas naquele grupo, com opção de tentar novamente, mantendo os demais KPIs renderizados.
9. WHILE múltiplas fontes de KPI estão indisponíveis simultaneamente, THE Operations_Dashboard SHALL
   manter a degradação controlada, renderizando os KPIs disponíveis sem falha total da tela.

### Requirement 5: Privacidade, isolamento e auditoria do Painel Operacional

**User Story:** Como engenharia de segurança, quero que o painel operacional só seja acessível a quem
tem permissão e nunca exponha PII nem dados de outra conta, para que não haja vazamento de
informação.

#### Acceptance Criteria

1. WHERE o caller não satisfaz `is_admin_with_permission('DASHBOARD_VIEW')`, THE Operations_Metrics_RPC
   SHALL recusar a execução com `permission_denied` e SHALL não retornar nenhum KPI.
2. WHEN a Operations_Metrics_RPC recusa por falta de permissão, THE Operations_Metrics_RPC SHALL
   gravar audit log negativo `DASHBOARD_VIEW_DENIED` com `before` nulo e `after` contendo `user_id` e
   `reason`, antes de abortar.
3. THE Operations_Metrics_RPC SHALL rodar `SECURITY DEFINER` com `SET search_path = public`,
   `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`, nunca exposta ao role `anon`.
4. THE Operations_Metrics_Bundle SHALL conter apenas contagens agregadas e marcadores de
   disponibilidade, sem incluir PII de Cliente (nome, e-mail, telefone, CPF, CNPJ), conteúdo de
   mensagens nem detalhes individuais de cobrança.
5. THE Operations_Metrics_RPC SHALL não registrar PII bruta nem segredos em logs estruturados ou
   traces.
6. WHEN o Presence_Source agrega atividade de Clientes, THE Operations_Metrics_RPC SHALL expor apenas
   a contagem de `Online_User`, sem identificar quais Clientes estão online.

### Requirement 6: Modelo de alertas — tabela, domínios fechados e RLS

**User Story:** Como administrador, quero que cada situação importante vire um alerta com tipo,
severidade, estado e origem bem definidos, para que eu acompanhe e trate cada uma com segurança.

#### Acceptance Criteria

1. THE Migration_117 SHALL criar a tabela `system_alerts` com ao menos `id` (uuid pk), `alert_type`,
   `severity`, `state`, `source_type`, `source_id`, `dedup_key`, `title`, `detail` (jsonb),
   `first_seen_at`, `last_seen_at`, `acknowledged_at`, `acknowledged_by`, `resolved_at`,
   `resolved_by`, `created_at` e `updated_at` (timestamptz).
2. THE `system_alerts.alert_type` SHALL pertencer ao domínio fechado `{WHATSAPP_DISCONNECTED,
   CAMPAIGN_PAUSED, CAMPAIGN_ERROR, INTEGRATION_FAILURE, SUBSCRIPTION_EXPIRING, CUSTOMER_AWAITING}`,
   restrito por `CHECK`.
3. THE `system_alerts.severity` SHALL pertencer ao domínio fechado `{CRITICAL, WARNING, INFO}` e
   `system_alerts.state` ao domínio fechado `{OPEN, ACKNOWLEDGED, RESOLVED}`, ambos restritos por
   `CHECK`.
4. THE Alert_Severity_Map SHALL atribuir a severidade de cada alerta de forma determinística:
   `WHATSAPP_DISCONNECTED`, `CAMPAIGN_ERROR` e `INTEGRATION_FAILURE` como `CRITICAL`; `CAMPAIGN_PAUSED`,
   `SUBSCRIPTION_EXPIRING` e `CUSTOMER_AWAITING` como `WARNING`.
5. THE Migration_117 SHALL criar um índice único parcial sobre `dedup_key` restrito a
   `state IN ('OPEN','ACKNOWLEDGED')`, garantindo no máximo um `System_Alert` ativo por
   `Alert_Dedup_Key`.
6. THE Migration_117 SHALL habilitar RLS em `system_alerts` admitindo SELECT apenas para
   administradores que satisfaçam `is_admin_with_permission('ALERT_VIEW')`.
7. THE Migration_117 SHALL impedir, via RLS, qualquer SELECT, INSERT, UPDATE ou DELETE de
   `system_alerts` por role `anon` ou por usuário não-admin, incluindo qualquer Cliente.
8. THE `system_alerts.detail` SHALL conter apenas dados de contexto não sensíveis (identificadores de
   origem, rótulos, contadores e timestamps), sem PII bruta de Cliente, conteúdo de mensagens nem
   segredos de integração.

### Requirement 7: Geração, deduplicação e auto-resolução de alertas

**User Story:** Como dono, quero que o sistema gere os alertas automaticamente sem duplicar a mesma
situação e os resolva sozinho quando a condição deixar de existir, para que a lista de alertas reflita
o estado real.

#### Acceptance Criteria

1. THE Alert_Evaluator SHALL ser determinístico: para o mesmo estado das fontes, SHALL produzir
   sempre o mesmo conjunto de `(Alert_Type, Alert_Source)` ativos.
2. WHEN a Alerts_Evaluate_RPC executa e o Alert_Evaluator indica uma situação ativa sem `System_Alert`
   ativo correspondente, THE Alerts_Evaluate_RPC SHALL inserir um novo `System_Alert` em estado `OPEN`
   com a severidade do Alert_Severity_Map e SHALL gravar audit log `ALERT_GENERATED`.
3. WHEN a Alerts_Evaluate_RPC executa e já existe um `System_Alert` ativo (`OPEN` ou `ACKNOWLEDGED`)
   para a mesma `Alert_Dedup_Key`, THE Alerts_Evaluate_RPC SHALL atualizar apenas `last_seen_at`
   daquele alerta, sem inserir um novo registro nem alterar o estado.
4. WHEN a Alerts_Evaluate_RPC executa e um `System_Alert` ativo não corresponde a nenhuma situação
   ativa do Alert_Evaluator, THE Alerts_Evaluate_RPC SHALL transicionar esse alerta para `RESOLVED`,
   registrando `resolved_at`, marcando a resolução como automática (`resolved_by` nulo).
5. THE Alerts_Evaluate_RPC SHALL ser idempotente: executar a reconciliação repetidamente sobre o
   mesmo estado das fontes não cria alertas duplicados nem altera estados além da primeira aplicação.
6. THE Alerts_Evaluate_RPC SHALL ser invocável por agendador durável (`pg_cron`) e SHALL também
   aceitar invocação sob demanda por administrador que satisfaça `is_admin_with_permission('ALERT_VIEW')`.
7. IF a avaliação de uma fonte específica falha (fonte indisponível), THEN THE Alerts_Evaluate_RPC
   SHALL tratar o erro de forma segura, registrá-lo de forma estruturada e prosseguir com a avaliação
   das demais fontes, sem abortar toda a reconciliação.

### Requirement 8: Fontes de alerta — mapeamento das seis situações

**User Story:** Como dono, quero que os seis alertas do documento reflitam fontes reais do sistema,
para que cada alerta seja acionável e verdadeiro.

#### Acceptance Criteria

1. THE Alert_Evaluator SHALL gerar `WHATSAPP_DISCONNECTED` para cada `WhatsApp_Session` cujo status
   esteja em `{DISCONNECTED, EXPIRED}`, com `source_type = 'whatsapp_session'` e
   `source_id = instance_id`.
2. THE Alert_Evaluator SHALL gerar `CAMPAIGN_PAUSED` para cada `Dispatch_Job` em estado `PAUSED`, com
   `source_type = 'dispatch_job'` e `source_id = <dispatch_id>`.
3. THE Alert_Evaluator SHALL gerar `CAMPAIGN_ERROR` para cada `Dispatch_Job` em estado `FAILED`, com
   `source_type = 'dispatch_job'` e `source_id = <dispatch_id>`.
4. THE Alert_Evaluator SHALL gerar `INTEGRATION_FAILURE` quando uma integração externa (por exemplo,
   Evolution_API ou provedor de IA) acumula falhas de evento dentro de uma janela de avaliação, com
   `source_type = 'integration'` e `source_id` identificando a integração.
5. THE Alert_Evaluator SHALL gerar `SUBSCRIPTION_EXPIRING` para cada assinatura cuja data de
   vencimento/expiração caia dentro do `Expiring_Window`, com `source_type = 'subscription'` e
   `source_id = <user_id>`, sem expor PII no `detail`.
6. THE Alert_Evaluator SHALL gerar `CUSTOMER_AWAITING` para cada `support_ticket` aguardando resposta
   humana além do `Awaiting_Threshold`, em estado não terminal (não `resolved` nem `closed`), com
   `source_type = 'support_ticket'` e `source_id = <ticket_id>`.
7. WHERE uma fonte de alerta (módulo WhatsApp, suporte ou assinaturas) não está presente, THE
   Alert_Evaluator SHALL omitir os alertas daquele tipo sem erro, em vez de fabricar alertas.
8. THE Alerts_Center SHALL exibir cada `System_Alert` com seu tipo, severidade, estado, origem,
   `first_seen_at` e `last_seen_at`, ordenados por severidade (`CRITICAL` antes de `WARNING` antes de
   `INFO`) e, em empate, por `last_seen_at` decrescente, com filtros em popover (`SlidersHorizontal`)
   por estado, tipo e severidade e paginação `10/50/100`.

### Requirement 9: Reconhecimento e resolução de alertas com versionamento e auditoria

**User Story:** Como administrador, quero reconhecer e resolver alertas com segurança e sem conflito
entre admins, para manter a lista de alertas consistente.

#### Acceptance Criteria

1. WHERE o administrador satisfaz `is_admin_with_permission('ALERT_ACK')`, THE Alerts_Center SHALL
   exibir o controle de reconhecer alertas `OPEN`; caso contrário, SHALL ocultá-lo.
2. WHERE o administrador satisfaz `is_admin_with_permission('ALERT_RESOLVE')`, THE Alerts_Center SHALL
   exibir o controle de resolver alertas `OPEN` ou `ACKNOWLEDGED`; caso contrário, SHALL ocultá-lo.
3. WHEN um administrador com `ALERT_ACK` reconhece um alerta `OPEN`, THE Alert_Acknowledge_RPC SHALL
   transicionar o alerta para `ACKNOWLEDGED` usando `expected_updated_at`, registrar `acknowledged_at`
   e `acknowledged_by` e SHALL gravar audit log `ALERT_ACK` via `executeAdminMutation`.
4. WHEN um administrador com `ALERT_RESOLVE` resolve um alerta `OPEN` ou `ACKNOWLEDGED`, THE
   Alert_Resolve_RPC SHALL transicionar o alerta para `RESOLVED` usando `expected_updated_at`,
   registrar `resolved_at` e `resolved_by` e SHALL gravar audit log `ALERT_RESOLVE` via
   `executeAdminMutation`.
5. IF o `expected_updated_at` informado diverge do `updated_at` atual do alerta, THEN a RPC de
   mutação SHALL recusar a operação com `STALE_VERSION` sem mutar.
6. WHEN o alerta alvo já está `ACKNOWLEDGED`, THE Alert_Acknowledge_RPC SHALL tratar a operação como
   idempotente, retornando `{ skipped: true, reason: 'ALREADY_ACKNOWLEDGED' }` e gravando
   `ALERT_ACK_SKIPPED`, sem nova mutação.
7. WHEN o alerta alvo já está `RESOLVED`, THE Alert_Resolve_RPC SHALL tratar a operação como
   idempotente, retornando `{ skipped: true, reason: 'ALREADY_RESOLVED' }` e gravando
   `ALERT_RESOLVE_SKIPPED`, sem nova mutação.
8. WHERE o estado do alerta é terminal `RESOLVED`, THE Alert_Acknowledge_RPC SHALL recusar o
   reconhecimento, tratando `RESOLVED` como estado que não retorna a `ACKNOWLEDGED`.
9. IF a checagem de permissão de `ALERT_ACK` ou `ALERT_RESOLVE` falha para o caller, THEN a RPC de
   mutação correspondente SHALL recusar com `permission_denied` e gravar audit log negativo
   `ALERT_VIEW_DENIED`, independentemente do papel do caller.
10. IF uma RPC de mutação de alerta encontra simultaneamente falta de permissão e erro de validação
    de input, THEN THE RPC SHALL responder `permission_denied`, dando precedência à falha de permissão
    sobre a de validação.

### Requirement 10: Visualizador de Logs — leitura, ordenação, filtros e paginação

**User Story:** Como administrador com `LOG_VIEW`, quero ver tudo que aconteceu no sistema com data e
hora, filtrável e paginado, para auditar a operação sem abrir cada módulo.

#### Acceptance Criteria

1. THE Logs_Viewer SHALL exibir cada `Log_Entry` com data e hora (`occurred_at`), tipo de evento
   (`Log_Event_Type`), ator (quando aplicável), tipo de alvo, identificador de alvo e um `summary` em
   pt-BR.
2. THE Logs_List_RPC SHALL retornar os `Log_Entry` ordenados por `occurred_at` decrescente,
   produzindo, em empate de timestamp, uma ordenação total e determinística por um critério de
   desempate estável.
3. THE Logs_Viewer SHALL expor os filtros (`Log_Filter`) em popover acionado por botão com ícone
   `SlidersHorizontal`, sem painel inline largo, permitindo filtrar por tipo de evento, intervalo de
   datas, ator e tipo de alvo.
4. WHEN o administrador aplica um `Log_Filter`, THE Logs_List_RPC SHALL retornar somente os `Log_Entry`
   que satisfazem todos os critérios aplicados.
5. THE Logs_Viewer SHALL oferecer paginação com seletor de tamanho `10`, `50` e `100`, com valor
   inicial `10`, e THE Logs_List_RPC SHALL fixar `p_limit` ao conjunto `{10, 50, 100}` aplicando `10`
   quando ausente ou fora do conjunto.
6. THE Logs_Viewer SHALL ser somente-leitura, não expondo nenhum controle de criação, edição ou
   remoção de `Log_Entry`.
7. WHEN nenhum `Log_Entry` satisfaz os filtros aplicados, THE Logs_Viewer SHALL exibir o estado vazio
   `Nenhum registro encontrado.` sem erro.
8. IF o carregamento dos logs falha, THEN THE Logs_Viewer SHALL exibir erro isolado com opção de
   tentar novamente, sem derrubar a navegação do painel.

### Requirement 11: Domínio fechado de tipos de log e mapeamento de fontes

**User Story:** Como administrador, quero que os tipos de log correspondam às situações do documento e
sejam derivados de fontes reais, para que os logs sejam confiáveis e não inventados.

#### Acceptance Criteria

1. THE Log_Event_Type SHALL pertencer ao domínio fechado `{LOGIN, LOGOUT, DISPATCH_STARTED,
   DISPATCH_COMPLETED, ERROR_OCCURRED, CLIENT_CREATED, PLAN_CHANGED, AI_REPLIED, HUMAN_TAKEOVER}`.
2. THE Log_Event_Map SHALL mapear cada `Log_Event_Type` de forma determinística para um conjunto de
   action codes / fontes: `LOGIN` para o login de administrador registrado em `admin_audit_logs`;
   `DISPATCH_STARTED` e `DISPATCH_COMPLETED` para as ações de início e conclusão de disparo de
   `whatsapp-automation`; `AI_REPLIED` para as ações de resposta da IA de `suporte-inteligente` e de
   `whatsapp-automation`; `HUMAN_TAKEOVER` para a transferência para humano de `suporte-inteligente` e
   de `whatsapp-automation`; `PLAN_CHANGED` para as ações de mudança de assinatura de
   `assinaturas-pagamento`/`admin-subscriptions`; `ERROR_OCCURRED` para as ações de falha
   (`*_FAILED`) e eventos de erro estruturado.
3. WHERE um `Log_Event_Type` (por exemplo `LOGOUT` ou `CLIENT_CREATED`) não possui fonte emissora
   presente, THE Logs_List_RPC SHALL retornar conjunto vazio para aquele tipo, sem fabricar registros,
   e a emissão da fonte SHALL ser declarada como dependência futura.
4. THE Logs_List_RPC SHALL derivar o `Log_Source` primário de `admin_audit_logs`, compondo fontes
   adicionais conforme o `Log_Event_Map`.
5. THE Logs_Viewer SHALL exibir cada `Log_Event_Type` com um rótulo em pt-BR fixo (`LOGIN` → "Login
   realizado", `LOGOUT` → "Logout", `DISPATCH_STARTED` → "Disparo iniciado", `DISPATCH_COMPLETED` →
   "Disparo concluído", `ERROR_OCCURRED` → "Erro ocorrido", `CLIENT_CREATED` → "Cliente criado",
   `PLAN_CHANGED` → "Plano alterado", `AI_REPLIED` → "IA respondeu", `HUMAN_TAKEOVER` → "Atendimento
   humano assumiu").

### Requirement 12: Logs — segurança, privacidade e isolamento

**User Story:** Como engenharia de segurança, quero que os logs sejam acessíveis apenas a quem tem
permissão e nunca exponham PII bruta nem segredos, para que a auditoria não vire vetor de vazamento.

#### Acceptance Criteria

1. WHERE o caller não satisfaz `is_admin_with_permission('LOG_VIEW')`, THE Logs_List_RPC SHALL recusar
   a execução com `permission_denied` e SHALL não retornar nenhum `Log_Entry`.
2. WHEN a Logs_List_RPC recusa por falta de permissão, THE Logs_List_RPC SHALL gravar audit log
   negativo `LOG_VIEW_DENIED` com `before` nulo e `after` contendo `user_id` e `reason`, antes de
   abortar.
3. THE Logs_List_RPC SHALL rodar `SECURITY DEFINER` com `SET search_path = public`,
   `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`, nunca exposta ao role `anon`.
4. THE Logs_List_RPC SHALL compor o `summary` de cada `Log_Entry` sem incluir PII bruta de Cliente
   (e-mail, telefone, CPF, CNPJ), conteúdo de mensagens nem segredos, derivando apenas rótulos e
   identificadores não sensíveis.
5. IF a checagem de permissão falha simultaneamente a um erro de validação de input dos filtros, THEN
   THE Logs_List_RPC SHALL responder `permission_denied`, dando precedência à falha de permissão.
6. THE Logs_List_RPC SHALL garantir que um Cliente nunca acesse logs do sistema: toda leitura é
   mediada por gating de admin (`is_admin_with_permission('LOG_VIEW')`), sem cruzamento entre contas.

### Requirement 13: Privacidade transversal, precedência de permissão e não-vazamento

**User Story:** Como engenharia de segurança, quero que toda a Central de Operação respeite a
precedência de `permission_denied` e jamais exponha dados entre contas ou em logs, para que a feature
vá para produção sem risco de vazamento.

#### Acceptance Criteria

1. IF qualquer RPC desta spec encontra simultaneamente falta de permissão e erro de validação de
   input, THEN THE RPC SHALL responder `permission_denied`, dando precedência à falha de permissão
   sobre a de validação.
2. WHERE o caller é anônimo (`auth.uid()` nulo), THE RPCs desta spec SHALL recusar com
   `permission_denied`, exceto onde o caso de uso explicitamente suportasse `anon` (não há, nesta
   spec).
3. THE RPCs desta spec SHALL garantir que um Cliente nunca acesse dados de outro Cliente nem dados
   operacionais do sistema: toda leitura server-side é mediada por gating de admin
   (`is_admin_with_permission`) ou por RLS, sem cruzamento entre contas.
4. THE Central_Operacao e as RPCs desta spec SHALL não registrar PII bruta (e-mail, telefone, CPF,
   CNPJ), conteúdo de mensagens nem segredos em logs estruturados, traces, audit logs ou no `detail`
   de `System_Alert`.
5. THE RPCs desta spec SHALL rodar `SECURITY DEFINER` com `SET search_path = public`, validar
   `auth.uid()` não nulo, checar `is_admin_with_permission` quando aplicável e aplicar
   `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, sem expor RPC ao role `anon`.
6. THE mutações de alerta desta spec SHALL chamar a proteção do Master_Admin antes de qualquer
   escrita que toque dados associados a um usuário, preservando a imutabilidade do `Nexus_Vortex99`
   com a precedência do projeto.

### Requirement 14: Migration 117, idempotência e rollback

**User Story:** Como engenheiro, quero aplicar a migration 117 sem efeitos colaterais em reexecuções,
para manter o banco consistente e reversível.

#### Acceptance Criteria

1. THE Migration_117 SHALL ser nomeada `supabase/migrations/117_admin_central_operacao.sql` e SHALL
   ser envelopada em `BEGIN; ... COMMIT;`.
2. THE Migration_117 SHALL ser idempotente: reexecução não causa erro nem duplica objetos, usando
   `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` e
   `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
3. THE Migration_117 SHALL incluir blocos `DO $check$` defensivos validando que
   `is_admin_with_permission(text)`, `admin_audit_logs`, `users`, `support_tickets` e `subscriptions`
   existem, levantando exceção clara quando ausentes.
4. THE Migration_117 SHALL criar a tabela `system_alerts`, suas policies RLS, o índice único parcial
   de deduplicação, a Operations_Metrics_RPC, a Alerts_Evaluate_RPC, a Alerts_List_RPC, a
   Alert_Acknowledge_RPC, a Alert_Resolve_RPC e a Logs_List_RPC, todas seguindo a postura de segurança
   de RPC do projeto (`SET search_path = public`, `auth.uid()` checado, `is_admin_with_permission`
   quando aplicável, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`).
5. THE Migration_117 SHALL registrar as ações novas `ALERT_VIEW`, `ALERT_ACK`, `ALERT_RESOLVE` e
   `LOG_VIEW` no espelho server-side de `is_admin_with_permission`, com a concessão por papel do
   Requirement 2.
6. WHERE for necessária uma segunda migration, THE entrega SHALL usar o sufixo `117b_...`,
   preservando o número 118 para a spec futura.
7. THE Migration_117 SHALL ser acompanhada de `117_admin_central_operacao_rollback.sql` documentado e
   não auto-aplicado, que reverte as RPCs, policies, índices e a tabela `system_alerts` introduzidas.
8. THE Migration_117 SHALL incluir um bloco `-- VERIFY` comentado com SELECTs de smoke test e SHALL
   não reescrever nem destruir dados das tabelas reusadas (`users`, `support_tickets`, `subscriptions`,
   `admin_audit_logs` e as tabelas de `whatsapp-automation`).

### Requirement 15: Governança — validação, estabilidade, arquitetura e testes

**User Story:** Como mantenedor da plataforma, quero que esta feature seja entregue com validação,
estabilidade, arquitetura modular e testes completos, para que vá para produção sem comprometer o que
já existe.

#### Acceptance Criteria

1. THE Central_Operacao SHALL validar todo input (tipo, formato, regra de negócio, sanitização e
   consistência) no frontend **e** no backend, recusando entradas inválidas em ambas as camadas.
2. WHEN um controle de mutação de alerta (ack/resolve) é acionado com input inválido, THE Alerts_Center
   SHALL bloquear o envio efetivo ao backend (nenhum dado inválido é persistido) **e** exibir mensagem
   de erro em pt-BR, ambos, e o backend SHALL revalidar e rejeitar o input inválido (defesa em
   profundidade conforme 15.1).
3. IF qualquer operação desta spec encontra erro, THEN THE Central_Operacao SHALL tratar o erro de
   forma segura, registrá-lo de forma estruturada (sem PII bruta nem segredos) e manter o restante do
   sistema operável, sem interrupção desnecessária.
4. WHILE múltiplas fontes de dados estão indisponíveis simultaneamente, THE Operations_Dashboard e o
   Alerts_Center SHALL manter a degradação controlada, renderizando o que está disponível sem falha
   total da tela.
5. THE Central_Operacao SHALL ser implementada de forma modular (services, RPCs e componentes
   isolados por superfície), reusando os helpers canônicos de `src/services/admin/` e
   `src/__tests__/_helpers/` sem reimplementá-los.
6. THE Central_Operacao SHALL incluir testes automatizados unit + property (para as Correctness
   Properties), cenários de falha (caminhos negativos, limites, falha de fonte) e validações de
   frontend e backend, conforme o steering `testing-governance`.
7. THE Central_Operacao SHALL atualizar a Regression_Suite incorporando os novos testes, de modo que
   qualquer falha bloqueie merge e deploy.
8. THE Central_Operacao SHALL não reduzir a cobertura mínima dos Critical_Modules tocados, conforme
   `tests/coverage.config.ts`.

## Correctness Properties (a formalizar no design)

As propriedades abaixo são **obrigatórias** para esta spec do painel e serão formalizadas como testes
de propriedade (fast-check) no documento de design (`cp<N>_<nome>.property.test.ts`). Cada uma deriva
dos requisitos indicados. As opcionais levam `*`.

- **CP1 — Determinismo das métricas operacionais**: para o mesmo estado das fontes, a
  Operations_Metrics_RPC retorna sempre o mesmo `Operations_Metrics_Bundle` (mesmos valores e mesmos
  marcadores de disponibilidade), com KPIs sem fonte marcados `available = false` e nunca como `0`.
  (Requirements 3.2–3.8, 5.4)
- **CP2 — Não-sobreposição do Realtime_Refresh**: para qualquer sequência de ticks do
  `Refresh_Interval`, pausas por visibilidade e atualizações manuais, nunca há mais de uma requisição
  de métricas em voo ao mesmo tempo, e a atualização manual reinicia o temporizador.
  (Requirements 4.1, 4.2, 4.3, 4.4)
- **CP3 — Determinismo do Alert_Evaluator**: para o mesmo estado das fontes, o Alert_Evaluator produz
  sempre o mesmo conjunto de `(Alert_Type, Alert_Source)` ativos, com a severidade fixada pelo
  Alert_Severity_Map. (Requirements 7.1, 6.4, 8.1–8.6)
- **CP4 — Deduplicação e idempotência da geração de alertas**: reexecutar a Alerts_Evaluate_RPC sobre
  o mesmo estado não cria um segundo `System_Alert` ativo para a mesma `Alert_Dedup_Key` (no máximo um
  ativo por situação) e apenas atualiza `last_seen_at`. (Requirements 6.5, 7.2, 7.3, 7.5)
- **CP5 — Auto-resolução consistente**: quando a condição de uma situação deixa de valer, a próxima
  reconciliação transiciona o alerta ativo correspondente para `RESOLVED`, e situações ainda ativas
  permanecem inalteradas. (Requirements 7.4, 7.5)
- **CP6 — Idempotência e versionamento de ack/resolve**: reconhecer um alerta já `ACKNOWLEDGED` ou
  resolver um já `RESOLVED` retorna `_SKIPPED` sem mutar; `expected_updated_at` divergente retorna
  `STALE_VERSION`; N reconhecimentos produzem exatamente 1 `ALERT_ACK` e (N-1) `ALERT_ACK_SKIPPED`, e
  analogamente para resolução. (Requirements 9.3–9.8)
- **CP7 — Precedência de `permission_denied`**: para toda RPC desta spec, na presença simultânea de
  falta de permissão e erro de validação, o resultado é `permission_denied`, independentemente do
  papel do caller. (Requirements 2.7, 9.10, 12.5, 13.1)
- **CP8 — Isolamento e não-vazamento**: nenhuma RPC desta spec retorna dados a caller sem a permissão
  exigida (`DASHBOARD_VIEW`, `ALERT_VIEW` ou `LOG_VIEW`); `system_alerts` retorna zero linhas via RLS
  para role `anon`, `authenticated` não-admin ou Cliente; e nenhum bundle, `detail` de alerta ou
  `summary` de log expõe PII bruta, conteúdo de mensagens ou segredos. (Requirements 5.1, 5.4, 6.6,
  6.7, 6.8, 12.1, 12.4, 13.3, 13.4)
- **CP9 — Ordenação determinística de alertas e logs**: a Alerts_List_RPC ordena por severidade e
  `last_seen_at` decrescente com desempate estável, e a Logs_List_RPC ordena por `occurred_at`
  decrescente com desempate estável, produzindo, para o mesmo conjunto de dados, sempre a mesma
  sequência. (Requirements 8.8, 10.2)
- **CP10 — Totalidade do mapeamento de tipos**: todo `Log_Event_Type` do domínio fechado resolve
  deterministicamente pelo `Log_Event_Map`, e tipos sem fonte emissora presente retornam conjunto
  vazio sem erro nem fabricação de registros. (Requirements 11.1, 11.2, 11.3)
- **CP11\*** — *Atualização instantânea de alertas via realtime*: quando uma assinatura de tempo real
  em `system_alerts` está disponível, a inserção de um novo `System_Alert` atualiza o indicador de
  alertas do Alerts_Center sem aguardar o próximo `Refresh_Interval`. (Requirement 4.1, complementar)

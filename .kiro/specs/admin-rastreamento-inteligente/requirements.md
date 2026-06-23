# Requirements Document

## Introduction

O módulo **Rastreamento Inteligente (PatGo)** (`Tracking_Module`) entrega ao painel admin do FreteGO
uma aba dedicada (`/admin/rastreamento`) que **monitora a jornada do usuário** ao longo das três
superfícies do produto (site público, dashboard web e aplicativo), **detecta problemas**, **identifica
pontos de abandono**, **calcula o risco de abandono** de cada usuário e **permite recuperação ativa
via WhatsApp** com apoio de uma IA controlada por um **motor de regras** (Rastreamento → Motor de
Regras → IA → Ação). A IA nunca age livre: ela apenas **personaliza** a mensagem quando o motor de
regras determinístico autoriza o disparo.

Esta spec é o **NÚCLEO NOVO** de detecção/decisão/orquestração. A decisão de escopo aprovada pelo
dono é **"Módulo focado + reuso"**: a entrega concentra requisitos no que ainda não existe e **REUSA**
módulos já em produção, sem **duplicar** nem **quebrar** nada.

### Reuso obrigatório (não duplicar, não quebrar)

- **whatsapp-automation (migrations 092–114)**: toda **conexão de WhatsApp** (QR, `WhatsApp_Session`
  persistente, multi-instância, anti-spam de baixo nível) e todo **envio** de mensagem de recuperação
  **REUSAM** este módulo. O `Tracking_Module` **detecta** o evento/risco e **aciona** o disparo
  delegando ao motor de disparo server-side existente (`Job_Worker`/pg_cron, `Dispatch_Job`). O botão
  "WhatsApp" de cada linha abre a conversa na `Conversation_Inbox` existente e o histórico de mensagens
  enviadas reusa as `Conversations` daquele módulo. **NÃO** recriar QR, sessão, anti-spam de baixo
  nível nem a camada de envio.
- **admin-assistant (migration 047)**: a `Provider_Abstraction` multi-provider (claude/gemini/grok/
  llama), com a chave armazenada no **Supabase Vault** e toda chamada de IA passando por **Edge
  Function**, é **REUSADA** para a personalização de mensagens e para a área de configuração da chave
  de IA dentro da aba. **NÃO** criar nova abstração de provedor nem novo armazenamento de chave.
- **suporte-inteligente (migration 115/115b)**: o atendimento por IA, a `Knowledge_Base` e o
  `Intelligent_Transfer`/handoff IA↔humano **compõem** o fluxo de recuperação quando um usuário
  responde e precisa de atendimento, **sem** recriar o console de suporte.
- **admin-cliente-360 (migration 116)**: a identificação do usuário (busca global por nome/e-mail/
  telefone/ID/empresa) e a navegação ao histórico **REUSAM** a `Cliente_360_View` e a `Global_Search`.
  A `User_Journey_Timeline` referencia o cliente e leva à visão 360 existente; **não** recria a busca
  nem a tela de detalhe.
- **admin-central-operacao (117) + admin-ia-supervisora (118)**: alertas automáticos, logs técnicos,
  insights de negócio e o painel de sugestões da IA **REUSAM/compõem** `system_alerts`,
  `admin_logs_list`/`admin_audit_logs`, o `Anomaly_Detector` e o `Supervisor_Insight`
  (ANOMALY/SUGGESTION/SUMMARY) já existentes. O `Tracking_Module` **publica sinais** e **lê**
  agregados, **sem** recriar um sistema de alertas, de logs técnicos ou de insights próprio.

### Governança embutida (não é spec separada)

Esta spec **não** cria uma spec de governança à parte. Cada funcionalidade entrega a própria camada de
validação e proteção, impede vazamento de dados entre usuários e contas, impede ações sem permissão, é
testável (unit + property + cenários de falha + validações no **frontend** e no **backend**), trata
erros de forma segura (erro tratado, registrado, sistema segue) e segue arquitetura modular. A spec
adere integralmente aos steerings `testing-governance`, `project-conventions` e `admin-patterns`. A
**regra-mãe** vale: nenhuma feature conclui sem testes completos.

### Privacidade e LGPD

O `Tracking_Module` **nunca** expõe PII ou segredos em respostas, logs estruturados ou traces. O
contexto enviado ao provedor de IA é **controlado e mínimo** (somente os campos necessários à
personalização autorizada), e a chave de IA permanece **somente no Vault**, nunca no frontend.

### Migration

A entrega adiciona a **migration 124** (`124_admin_rastreamento_inteligente.sql` + par documentado
`124_admin_rastreamento_inteligente_rollback.sql`), próxima numeração livre (a maior reservada no
disco é 119; 092–118 pertencem aos módulos reusados). A migration é idempotente, com bloco
`DO $check$` defensivo validando as dependências (`is_admin_with_permission` da 030, fontes de
`whatsapp-automation`/`admin-assistant`/`admin-cliente-360`/`admin-central-operacao`) e um bloco
`-- VERIFY` comentado ao fim. Caso seja necessária uma segunda migration, esta SHALL usar o sufixo de
letra `124b_...`, preservando os números seguintes.

### Idioma e convenções

Requisitos, UI e mensagens user-facing em **pt-BR**; action codes, error codes e identifiers em
**inglês** (UPPER_SNAKE). Mensagens canônicas anti-enumeração quando aplicável. As Correctness
Properties (Propriedades de Corretude) desta spec do painel são **obrigatórias** (sem asterisco),
concentradas no núcleo determinístico (classificador de causa, score de risco, métricas do funil,
motor de regras/anti-spam); propriedades opcionais, quando houver, são marcadas com `*`.

## Glossary

### Fundação e padrões reusados

- **Admin_Panel**: Painel administrativo de `admin-foundation` (migration 030), acessível em
  `/admin/*`.
- **AdminGuard / AdminShell / AdminSidebar / useAdminPermission**: Componentes e hook de fundação
  reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Master_Admin**: Dono do sistema, `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique),
  imutável.
- **Cliente**: Usuário comum sob administração, com `users.user_type ∈ {motorista, embarcador}`.
  Usuários com `user_type = 'admin'` **não** são Cliente e nunca aparecem no `Tracking_Module`.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) → boolean` em
  `src/services/admin/permissions.ts`, espelhada server-side por `is_admin_with_permission`.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a Permission_Matrix
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`; toda
  mutação admin desta spec passa por aqui.
- **STALE_VERSION**: Erro padrão do projeto quando `expected_updated_at` não corresponde ao
  `updated_at` atual da linha (versionamento otimista).
- **Partial_Degradation**: Padrão herdado (`getUserDetail`/`getMetrics`): cada bloco de um fetch
  agregado é carregado de forma isolada via `Promise.allSettled`; a falha de um bloco registra
  `bundle.errors[bloco]` e renderiza erro apenas naquele bloco, sem derrubar os demais.
- **Canonical_Anti_Enumeration_Message**: Mensagem user-facing genérica que não revela existência de
  dado/rota a quem não tem permissão.

### Identifiers reusados de outros módulos (não recriados)

- **WhatsApp_Module / WhatsApp_Session / WhatsApp_Instance**: módulo, sessão e instância de
  `whatsapp-automation` (092–114). Fonte da conexão e do envio reais.
- **Job_Worker / Dispatch_Job / Dispatch_Recipient**: motor de disparo server-side durável de
  `whatsapp-automation`, ao qual o `Tracking_Module` **delega** o envio.
- **Conversation_Inbox / Conversation / Human_Takeover / Return_To_AI**: central de conversas e
  handoff de `whatsapp-automation`/`suporte-inteligente`, reusados pelas ações de recuperação.
- **Provider_Abstraction / Active_Provider / AI_Api_Key / AI_Edge_Function**: abstração de IA
  multi-provider de `admin-assistant` (047), com chave no Vault; reusada para personalização e config.
- **Knowledge_Base / Intelligent_Transfer**: base de conhecimento e transferência inteligente de
  `suporte-inteligente` (115), compostas quando o usuário responde.
- **Cliente_360_View / Global_Search**: visão 360 e busca global de `admin-cliente-360` (116),
  reusadas para identificação e navegação ao histórico.
- **system_alerts / Alerts_Center / admin_logs_list / Supervisor_Insight / Anomaly_Detector**:
  alertas, logs e insights de `admin-central-operacao` (117) e `admin-ia-supervisora` (118),
  compostos pelo `Tracking_Module` sem recriação.
- **Vault**: Supabase Vault, cofre de segredos cifrados; única morada da `AI_Api_Key`.

### Identifiers novos desta spec

- **Tracking_Module**: o módulo "Rastreamento Inteligente (PatGo)" entregue em `/admin/rastreamento`.
- **RASTREAMENTO_VIEW / RASTREAMENTO_MANAGE**: permissões **novas**. `RASTREAMENTO_VIEW` lê o módulo;
  `RASTREAMENTO_MANAGE` aciona recuperação, marca contato, configura regras e configura a chave de IA.
- **Journey_Event**: registro de um evento de jornada do usuário em uma das três superfícies (site,
  dashboard, app), com `event_type`, `surface`, `occurred_at`, `user_id` (quando autenticado) ou
  `visitor_id` (anônimo) e um `payload` mínimo sem PII sensível.
- **Journey_Event_Type**: domínio **fechado** e finito de tipos de evento. Inclui ao menos
  `SITE_VISIT`, `SIGNUP_STARTED`, `SIGNUP_COMPLETED`, `SIGNUP_ABANDONED`, `DOCUMENT_UPLOAD_STARTED`,
  `DOCUMENT_UPLOAD_FAILED`, `DOCUMENT_APPROVED`, `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `CHECKOUT_STARTED`,
  `CHECKOUT_ABANDONED`, `PAYMENT_STARTED`, `PAYMENT_FAILED`, `PAYMENT_SUCCEEDED`,
  `SUBSCRIPTION_ACTIVATED`, `APP_OPENED`, `APP_CRASH`, `FREIGHT_VIEWED`, `FREIGHT_IGNORED`,
  `FREIGHT_ACCEPTED`, `FIRST_FREIGHT_COMPLETED`, `INACTIVITY_DETECTED`, `INTERNAL_ERROR` e
  `NETWORK_TIMEOUT`. O conjunto exato é fixado na migration 124; valores fora do conjunto são
  rejeitados na ingestão.
- **Journey_Surface**: domínio fechado da origem do evento: `SITE`, `DASHBOARD`, `APP`.
- **Visitor_Id**: identificador opaco de visitante anônimo (token aleatório gerado no cliente), usado
  quando não há `user_id`; correlacionável a um `user_id` quando o visitante autentica.
- **Journey_Ingest_Endpoint**: endpoint server-side write-only de ingestão de `Journey_Event`,
  acessível também sem autenticação (caso de uso explicitamente anônimo, como `is_blacklisted`), que
  valida o `Journey_Event_Type` contra o domínio fechado, não retorna dados e não permite leitura.
- **User_Journey_Timeline**: linha do tempo cronológica dos `Journey_Event` de um usuário, indicando
  onde exatamente ele parou; navega para a `Cliente_360_View`.
- **Funnel_Stage**: domínio fechado e **ordenado** das etapas do funil: `VISITOR`, `SIGNUP_STARTED`,
  `SIGNUP_COMPLETED`, `DOCUMENTS_APPROVED`, `SUBSCRIPTION_PAID`, `APP_ACTIVE`, `FIRST_FREIGHT`,
  `RECURRING_USER`.
- **Stage_Derivation**: função pura determinística que mapeia o conjunto de `Journey_Event` de um
  usuário para o `Funnel_Stage` mais avançado alcançado, respeitando a ordem do funil.
- **Conversion_Funnel**: dashboard do funil que exibe, por `Time_Window`, a contagem em cada
  `Funnel_Stage` e as `Funnel_Metrics`, com gráficos em SVG inline (sem Recharts/Chart.js).
- **Funnel_Metrics**: conjunto determinístico de métricas por `Time_Window` — `Stage_Conversion_Rate`,
  `Stage_Abandonment_Rate`, `Overall_Conversion_Rate`, `Retention_Rate`, `Churn_Rate` e
  `Activation_Rate`.
- **Time_Window**: janela de tempo fechada de agregação (`24h`, `7d`, `30d`, `90d`), com início e fim
  determinísticos.
- **Abandonment_Cause**: domínio **fechado** da causa provável de perda: `SIGNUP_ABANDONED`,
  `UPLOAD_ERROR`, `LOGIN_FAILURE`, `PAYMENT_DECLINED`, `CHECKOUT_ABANDONED`, `APP_CRASH`,
  `PROLONGED_INACTIVITY`, `FREIGHTS_IGNORED`, `INTERNAL_ERROR`, `NETWORK_TIMEOUT` e `UNKNOWN`
  (fallback de totalidade).
- **Abandonment_Cause_Classifier**: função **pura e determinística** que, dado o resumo de jornada de
  um usuário (`Journey_Summary`), retorna exatamente uma `Abandonment_Cause`. É totalizada: sempre
  retorna um valor do domínio (`UNKNOWN` quando nada se aplica). Exibe a coluna "CAUSA PROVÁVEL DA
  PERDA".
- **Journey_Summary**: estrutura determinística derivada dos `Journey_Event` de um usuário (contagens
  de falhas recentes, tempo desde o último acesso, etapa atual, tentativas frustradas, recusas de
  frete, estado de conversão), entrada do `Abandonment_Cause_Classifier` e do `Risk_Score_Calculator`.
- **Risk_Score**: inteiro determinístico no intervalo fechado `[0, 100]` que mede o risco de abandono.
- **Risk_Score_Calculator**: função **pura e determinística** que calcula o `Risk_Score` como a soma
  ponderada e **clampada** a `[0, 100]` dos `Risk_Factor`, monotônica não-decrescente em cada
  `Risk_Factor`.
- **Risk_Factor**: critério objetivo de entrada do `Risk_Score_Calculator`: `days_since_last_access`,
  `recent_failures`, `frustrated_attempts`, `freight_refusals` e `no_conversion`. Cada `Risk_Factor`
  tem peso fixo não-negativo.
- **Risk_Band**: faixa fechada derivada determinísticamente do `Risk_Score`: `LOW` (Baixo, 0–24),
  `MEDIUM` (Médio, 25–49), `HIGH` (Alto, 50–74), `CRITICAL` (Crítico, 75–100).
- **At_Risk_List**: lista filtrável e paginada de usuários em risco, por `Risk_Category`, exibindo
  `Risk_Score`, `Risk_Band`, `Abandonment_Cause` e ações de recuperação por linha.
- **Risk_Category**: domínio fechado de categorias da `At_Risk_List`: `SIGNUP_ABANDONED`,
  `PAYMENT_PENDING`, `INACTIVE`, `COLD_DRIVER`, `RECURRING_ERROR`.
- **Recovery_Scenario**: domínio fechado de cenários de recuperação: `NEW_SIGNUP_WELCOME` (boas-vindas
  ~10min após cadastro), `SIGNUP_ABANDONED`, `PAYMENT_FAILED`, `USER_INACTIVE`, `COLD_DRIVER`.
- **Recovery_Rule_Engine**: função **pura e determinística** que, dado um gatilho (evento/risco), o
  histórico de recuperação e o estado de anti-spam, decide se um disparo é autorizado e qual
  `Recovery_Scenario` aplicar, produzindo um `Recovery_Decision`. A IA só personaliza quando o
  `Recovery_Decision` é `DISPATCH`.
- **Recovery_Decision**: resultado do `Recovery_Rule_Engine`: `DISPATCH` (com `Recovery_Scenario` e
  template) ou `SUPPRESS` (com `Suppression_Reason`).
- **Suppression_Reason**: domínio fechado dos motivos de supressão: `WITHIN_COOLDOWN`,
  `MAX_PER_WINDOW_REACHED`, `DUPLICATE_MESSAGE`, `CONCURRENT_RECOVERY_ACTIVE`, `MIN_DELAY_NOT_ELAPSED`,
  `NO_ELIGIBLE_SCENARIO`.
- **Anti_Spam_Guard**: parte determinística do `Recovery_Rule_Engine` que aplica os filtros de
  anti-spam — `Min_Delay` (tempo mínimo após o evento), `Max_Per_Window` (máximo de mensagens por
  período), `Dedup` (deduplicação de mensagem idêntica), `Cooldown` (24–72h entre disparos ao mesmo
  usuário), `No_Concurrent` (sem recuperações simultâneas para o mesmo usuário) e o limite de **1
  mensagem automática por evento crítico**.
- **Recovery_Attempt**: registro durável de uma tentativa de recuperação, com `user_id`,
  `Recovery_Scenario`, canal, referência ao `Dispatch_Job` de `whatsapp-automation`, `Contact_Status`
  e timestamps.
- **Contact_Status**: domínio fechado do estado de contato de um usuário em recuperação: `AT_RISK`,
  `CONTACTED`, `REPLIED`, `CONVERTED`.
- **Recovery_Performance**: dashboard de recuperação que exibe, por `Time_Window`, os contadores de
  usuários `AT_RISK`, `CONTACTED`, `REPLIED` e `CONVERTED` e a `Recovery_Rate`.
- **Recovery_Rate**: métrica determinística `CONVERTED / CONTACTED` (0 quando `CONTACTED` é zero).
- **Tracking_Filter**: conjunto de filtros da `At_Risk_List`/timeline (nome, telefone, status, data,
  tipo de problema, motorista/empresa, faixa de `Risk_Score`), exposto em popover via ícone
  `SlidersHorizontal`.
- **Tracking_AI_Config**: registro de configuração da personalização por IA da aba (provedor ativo e
  parâmetros). **Não** armazena segredo; reusa a chave do Vault da `Provider_Abstraction`.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `RECOVERY_TRIGGER`,
  `RECOVERY_TRIGGER_SKIPPED`, `RECOVERY_AUTO_DISPATCH`, `RECOVERY_RULE_UPDATE`, `TRACKING_CONTACT_MARK`,
  `TRACKING_CONTACT_MARK_SKIPPED`, `TRACKING_AI_CONFIG_UPDATE`, `RASTREAMENTO_VIEW_DENIED`.
- **Migration_124**: arquivo `supabase/migrations/124_admin_rastreamento_inteligente.sql`, dependente
  das migrations `001..119`, idempotente, com par `124_admin_rastreamento_inteligente_rollback.sql`.

## Requirements

### Requirement 1: Rota, gating em duas camadas, padrão compacto e navegação

**User Story:** Como administrador com `RASTREAMENTO_VIEW`, quero acessar `/admin/rastreamento`
seguindo o padrão visual compacto do painel, para que apenas pessoas autorizadas monitorem a jornada
dos usuários.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/rastreamento` renderizando o Tracking_Module.
2. WHEN um administrador com `RASTREAMENTO_VIEW` acessa `/admin/rastreamento`, THE AdminGuard SHALL renderizar o Tracking_Module.
3. IF um usuário sem `RASTREAMENTO_VIEW` acessa `/admin/rastreamento`, THEN THE AdminGuard SHALL renderizar Stealth_404 sem revelar a existência da rota.
4. THE AdminSidebar SHALL exibir o item `Rastreamento` apontando para `/admin/rastreamento`, gated por `RASTREAMENTO_VIEW`.
5. THE Tracking_Module SHALL omitir o `<h1>` grande no topo da página, seguindo o padrão compacto do painel.
6. THE Tracking_Module SHALL expor os filtros em popover acionado por botão com ícone `SlidersHorizontal`, sem painel inline largo.
7. THE Tracking_Module SHALL oferecer paginação com seletor de tamanho `10`, `50` e `100`, com valor inicial `10`.
8. THE Tracking_Module SHALL exibir os cards de KPI com label `text-[10px] uppercase tracking-wider text-gray-500` e valor `text-base sm:text-lg font-semibold`, e SHALL converter as tabelas em lista de cards single-column em largura inferior a 768px.
9. WHEN um administrador seleciona um usuário na At_Risk_List ou na User_Journey_Timeline, THE Tracking_Module SHALL navegar para `/admin/users/<id>`, abrindo a Cliente_360_View existente sem recriar a tela de detalhe.
10. WHERE a largura da viewport é maior ou igual a 768px, THE Tracking_Module SHALL permitir layout multi-coluna nas listagens para melhor aproveitamento do espaço em desktop.

### Requirement 2: Permissões RBAC novas e precedência de permission_denied

**User Story:** Como mantenedor da plataforma, quero permissões dedicadas e gating em duas camadas para
o rastreamento e a recuperação, para que cada papel acesse apenas o que lhe compete.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL definir as ações novas `RASTREAMENTO_VIEW` e `RASTREAMENTO_MANAGE`.
2. THE Permission_Matrix SHALL conceder `RASTREAMENTO_VIEW` e `RASTREAMENTO_MANAGE` apenas a `SUPER_ADMIN` e `ADMIN`, negando a `SUPORTE`, `FINANCEIRO` e `MODERADOR` por construção (deny-by-default).
3. THE função `is_admin_with_permission` SHALL reconhecer `RASTREAMENTO_VIEW` e `RASTREAMENTO_MANAGE` com a mesma concessão por papel definida na Permission_Matrix.
4. WHEN o caller é anônimo, com `auth.uid()` nulo, THE função `is_admin_with_permission` SHALL retornar falso para `RASTREAMENTO_VIEW` e `RASTREAMENTO_MANAGE`, independentemente de qualquer papel reivindicado, priorizando a autenticação sobre o papel.
5. WHERE uma ação da UI aciona recuperação, marca contato, edita regras ou configura a chave de IA, THE Tracking_Module SHALL exibir o controle somente quando o administrador possuir `RASTREAMENTO_MANAGE`.
6. WHEN uma RPC `SECURITY DEFINER` do Tracking_Module é invocada, THE Tracking_Module SHALL revalidar a permissão correspondente no servidor via `is_admin_with_permission` antes de executar qualquer efeito.
7. IF uma ação protegida do Tracking_Module recebe simultaneamente uma falha de permissão e uma falha de validação de input, THEN THE Tracking_Module SHALL responder com `permission_denied`, dando precedência à falha de permissão sobre a falha de validação.
8. IF a checagem de permissão de uma ação protegida falha para o caller, THEN THE Tracking_Module SHALL negar a ação independentemente do papel do caller, incluindo o papel `ADMIN`, mantendo deny-by-default sem exceção por papel.

### Requirement 3: Captura e ingestão segura de Journey_Event (site, dashboard e app)

**User Story:** Como dono, quero capturar os eventos de jornada do usuário nas três superfícies,
vinculados ao usuário sempre que possível, para saber por onde cada pessoa passou e onde parou.

#### Acceptance Criteria

1. THE Tracking_Module SHALL registrar cada Journey_Event com `event_type` pertencente ao domínio fechado Journey_Event_Type, `surface` pertencente ao domínio fechado Journey_Surface, `occurred_at` e um `payload` mínimo.
2. WHEN um Journey_Event é gerado por um usuário autenticado, THE Tracking_Module SHALL vincular o Journey_Event ao `user_id` correspondente.
3. WHEN um Journey_Event é gerado por um visitante não autenticado, THE Tracking_Module SHALL vincular o Journey_Event a um Visitor_Id, sem exigir autenticação.
4. WHEN um visitante associado a um Visitor_Id autentica, THE Tracking_Module SHALL correlacionar os Journey_Event anteriores daquele Visitor_Id ao `user_id` resultante.
5. WHEN o Journey_Ingest_Endpoint recebe um evento com `event_type` fora do domínio Journey_Event_Type, THE Journey_Ingest_Endpoint SHALL rejeitar o evento com o erro `INVALID_EVENT_TYPE` e não persistir o Journey_Event.
6. THE Journey_Ingest_Endpoint SHALL ser write-only, não retornando nenhum dado de jornada, contagem ou existência de usuário em sua resposta (anti-enumeração).
7. THE Tracking_Module SHALL persistir no `payload` do Journey_Event apenas dados não sensíveis e SHALL não gravar PII bruta (CPF, e-mail, telefone), senhas, tokens ou segredos no Journey_Event, em logs ou em traces.
8. WHILE o Journey_Ingest_Endpoint recebe eventos, THE Journey_Ingest_Endpoint SHALL validar e limitar a taxa de ingestão por Visitor_Id e por origem, descartando o excedente sem derrubar a ingestão dos demais eventos.
9. THE leitura dos Journey_Event para a UI administrativa SHALL ocorrer apenas por RPC gated por `RASTREAMENTO_VIEW`, mantida separada do Journey_Ingest_Endpoint anônimo write-only.
10. IF a permissão `RASTREAMENTO_VIEW` está ausente em uma leitura administrativa de Journey_Event, THEN THE Tracking_Module SHALL negar o acesso imediatamente com `permission_denied`, sem conceder acesso degradado.

### Requirement 4: User_Journey_Timeline

**User Story:** Como administrador, quero ver a linha do tempo cronológica de um usuário, para saber
exatamente onde ele parou na jornada.

#### Acceptance Criteria

1. WHEN um administrador com `RASTREAMENTO_VIEW` abre a User_Journey_Timeline de um usuário, THE Tracking_Module SHALL exibir os Journey_Event daquele usuário ordenados por `occurred_at` crescente.
2. THE User_Journey_Timeline SHALL exibir, para cada Journey_Event, o `event_type` com rótulo pt-BR, a `surface` e a data e hora de ocorrência.
3. THE User_Journey_Timeline SHALL indicar o Funnel_Stage atual do usuário, derivado pela Stage_Derivation, como o ponto onde o usuário parou.
4. WHEN o usuário não possui nenhum Journey_Event, THE User_Journey_Timeline SHALL exibir o estado vazio `Nenhum evento de jornada registrado.` mantendo visível a estrutura da linha do tempo (rótulos e colunas), sem erro.
5. THE User_Journey_Timeline SHALL oferecer link para `/admin/users/<id>` que abre a Cliente_360_View existente daquele usuário.
6. THE User_Journey_Timeline SHALL não exibir PII bruta nem conteúdo sensível de mensagens nos itens da linha do tempo.

### Requirement 5: Abandonment_Cause_Classifier (núcleo puro determinístico)

**User Story:** Como dono, quero ver a causa provável da perda de cada usuário, para entender por que
ele parou e agir corretamente.

#### Acceptance Criteria

1. THE Abandonment_Cause_Classifier SHALL ser uma função pura e determinística que, dado um Journey_Summary, retorna exatamente uma Abandonment_Cause do domínio fechado.
2. FOR ALL Journey_Summary possíveis, THE Abandonment_Cause_Classifier SHALL retornar um valor pertencente ao domínio Abandonment_Cause, retornando `UNKNOWN` quando nenhuma causa específica se aplica (totalidade).
3. WHEN o mesmo Journey_Summary é classificado mais de uma vez, THE Abandonment_Cause_Classifier SHALL retornar sempre a mesma Abandonment_Cause (determinismo).
4. WHERE o Journey_Summary indica cadastro iniciado e não concluído sem outra falha posterior, THE Abandonment_Cause_Classifier SHALL classificar a causa como `SIGNUP_ABANDONED`.
5. WHERE o Journey_Summary indica falha de upload de documento como evento mais recente relevante, THE Abandonment_Cause_Classifier SHALL classificar a causa como `UPLOAD_ERROR`.
6. WHERE o Journey_Summary indica pagamento recusado como evento mais recente relevante, THE Abandonment_Cause_Classifier SHALL classificar a causa como `PAYMENT_DECLINED`.
7. WHERE o Journey_Summary indica ausência de qualquer acesso por período superior ao limite de inatividade configurado, THE Abandonment_Cause_Classifier SHALL classificar a causa como `PROLONGED_INACTIVITY`.
8. THE Tracking_Module SHALL exibir a Abandonment_Cause de cada usuário na coluna "CAUSA PROVÁVEL DA PERDA" com rótulo em pt-BR.
9. THE Abandonment_Cause_Classifier SHALL aplicar uma ordem de precedência total e determinística entre causas concorrentes, de modo que um mesmo Journey_Summary nunca produza causas diferentes entre execuções.

### Requirement 6: Risk_Score e Risk_Band (núcleo puro determinístico)

**User Story:** Como dono, quero um score de risco de abandono de 0 a 100 com faixa, calculado por
critérios objetivos, para priorizar quem recuperar primeiro.

#### Acceptance Criteria

1. THE Risk_Score_Calculator SHALL ser uma função pura e determinística que recebe os Risk_Factor de um usuário e produz um Risk_Score inteiro.
2. FOR ALL combinações de Risk_Factor, THE Risk_Score_Calculator SHALL produzir um Risk_Score no intervalo fechado `[0, 100]` (clamping).
3. WHEN o valor de qualquer Risk_Factor aumenta e os demais permanecem iguais, THE Risk_Score_Calculator SHALL produzir um Risk_Score maior ou igual ao anterior (monotonicidade não-decrescente).
4. WHEN os mesmos Risk_Factor são fornecidos mais de uma vez, THE Risk_Score_Calculator SHALL produzir sempre o mesmo Risk_Score (determinismo).
5. THE Risk_Score_Calculator SHALL derivar o Risk_Score de `days_since_last_access`, `recent_failures`, `frustrated_attempts`, `freight_refusals` e `no_conversion`, cada um com peso fixo não-negativo.
6. THE Risk_Band SHALL ser derivada determinísticamente do Risk_Score: `LOW` para `[0, 24]`, `MEDIUM` para `[25, 49]`, `HIGH` para `[50, 74]` e `CRITICAL` para `[75, 100]`.
7. FOR ALL Risk_Score em `[0, 100]`, THE Tracking_Module SHALL atribuir exatamente uma Risk_Band (função total), e WHEN um Risk_Score é maior que outro, THE Tracking_Module SHALL atribuir uma Risk_Band de severidade maior ou igual (monotonicidade).
8. THE Tracking_Module SHALL exibir o Risk_Score numérico e a Risk_Band rotulada em pt-BR (Baixo, Médio, Alto, Crítico) em cada linha da At_Risk_List.

### Requirement 7: At_Risk_List com filtros, paginação e ações de recuperação por linha

**User Story:** Como administrador, quero uma lista de usuários em risco por categoria, com score,
causa provável e ações de recuperação por linha, para agir rapidamente sobre cada caso.

#### Acceptance Criteria

1. THE At_Risk_List SHALL listar usuários por Risk_Category pertencente ao domínio fechado `{SIGNUP_ABANDONED, PAYMENT_PENDING, INACTIVE, COLD_DRIVER, RECURRING_ERROR}`.
2. THE At_Risk_List SHALL exibir, por linha, identificação do usuário, Risk_Score, Risk_Band, Abandonment_Cause e Contact_Status.
3. WHEN o administrador aplica o Tracking_Filter por categoria, faixa de Risk_Score, tipo de problema, data ou texto, THE At_Risk_List SHALL retornar somente os usuários que satisfazem todos os critérios aplicados.
4. WHEN uma página é solicitada com tamanho dentro do conjunto `{10, 50, 100}`, THE At_Risk_List SHALL retornar no máximo aquele número de usuários por página.
5. THE At_Risk_List SHALL ordenar os usuários por Risk_Score decrescente como ordenação inicial, com desempate determinístico por `user_id`.
6. WHERE o administrador possui `RASTREAMENTO_MANAGE`, THE At_Risk_List SHALL exibir, por linha, as ações: abrir conversa no WhatsApp (Conversation_Inbox de `whatsapp-automation`), copiar telefone, copiar mensagem pronta, marcar como contatado e ver histórico de mensagens enviadas.
7. WHEN o administrador aciona "abrir conversa no WhatsApp", THE Tracking_Module SHALL abrir a Conversation existente daquele usuário na Conversation_Inbox de `whatsapp-automation`, sem recriar a central de conversas.
8. WHEN o administrador marca um usuário como contatado, THE Tracking_Module SHALL persistir o Contact_Status como `CONTACTED` via `executeAdminMutation` com action `TRACKING_CONTACT_MARK`.
9. WHEN o administrador marca como contatado um usuário cujo Contact_Status já é `CONTACTED`, `REPLIED` ou `CONVERTED`, THE Tracking_Module SHALL tratar a operação como idempotente, retornando resultado `_SKIPPED` com motivo `ALREADY_CONTACTED` e registrando `TRACKING_CONTACT_MARK_SKIPPED`, sem nova mutação.
10. WHERE o administrador possui apenas `RASTREAMENTO_VIEW`, THE At_Risk_List SHALL ocultar por completo (não apenas desabilitar) as ações de recuperação, exibindo a lista em modo somente leitura.
11. WHEN o administrador exporta a At_Risk_List em CSV, THE Tracking_Module SHALL gerar o arquivo com BOM UTF-8, separador `;`, escape RFC 4180, quebra `\r\n`, truncamento em 10000 linhas e filename `rastreamento_<YYYYMMDD>_<HHmm>.csv`, sem expor PII além das colunas autorizadas.

### Requirement 8: Conversion_Funnel com métricas determinísticas e SVG inline

**User Story:** Como dono, quero um dashboard de funil de conversão com métricas por janela de tempo,
para enxergar onde os usuários abandonam e como evolui a retenção.

#### Acceptance Criteria

1. THE Conversion_Funnel SHALL exibir as contagens de usuários em cada Funnel_Stage do domínio ordenado `VISITOR → SIGNUP_STARTED → SIGNUP_COMPLETED → DOCUMENTS_APPROVED → SUBSCRIPTION_PAID → APP_ACTIVE → FIRST_FREIGHT → RECURRING_USER`.
2. THE Stage_Derivation SHALL ser uma função pura e determinística que mapeia os Journey_Event de um usuário ao Funnel_Stage mais avançado alcançado, respeitando a ordem do funil.
3. FOR ALL pares de Funnel_Stage consecutivos, THE Conversion_Funnel SHALL garantir que a contagem de uma etapa posterior seja menor ou igual à contagem da etapa anterior na mesma Time_Window (monotonicidade do funil).
4. THE Funnel_Metrics SHALL calcular `Stage_Conversion_Rate(etapa) = contagem(etapa seguinte) / contagem(etapa)`, retornando 0 quando o denominador é 0.
5. THE Funnel_Metrics SHALL calcular `Stage_Abandonment_Rate(etapa) = 1 - Stage_Conversion_Rate(etapa)` para cada etapa com denominador maior que 0.
6. FOR ALL Funnel_Metrics calculadas, THE Conversion_Funnel SHALL produzir valores de taxa no intervalo fechado `[0, 1]`.
7. WHEN a mesma Time_Window é calculada sobre o mesmo conjunto de Journey_Event, THE Funnel_Metrics SHALL produzir exatamente os mesmos valores (determinismo).
8. THE Conversion_Funnel SHALL renderizar os gráficos em SVG inline, sem usar Recharts nem Chart.js.
9. THE Conversion_Funnel SHALL carregar cada bloco de métrica de forma isolada via Partial_Degradation, registrando `bundle.errors[bloco]` na falha e renderizando erro apenas no bloco afetado.
10. THE Conversion_Funnel SHALL oferecer a seleção de Time_Window dentre `{24h, 7d, 30d, 90d}`, aplicando uma janela padrão quando ausente ou inválida.

### Requirement 9: Recovery_Rule_Engine, Anti_Spam_Guard e delegação ao whatsapp-automation

**User Story:** Como dono, quero um motor de regras que decida quando e como recuperar um usuário,
respeitando anti-spam, e delegue o envio ao módulo de WhatsApp, para recuperar sem incomodar.

#### Acceptance Criteria

1. THE Recovery_Rule_Engine SHALL ser uma função pura e determinística que, dado um gatilho, o histórico de Recovery_Attempt e o estado de anti-spam, produz um Recovery_Decision (`DISPATCH` com Recovery_Scenario ou `SUPPRESS` com Suppression_Reason).
2. WHEN o mesmo gatilho e o mesmo estado são avaliados mais de uma vez, THE Recovery_Rule_Engine SHALL produzir sempre o mesmo Recovery_Decision (determinismo).
3. THE Recovery_Scenario SHALL pertencer ao domínio fechado `{NEW_SIGNUP_WELCOME, SIGNUP_ABANDONED, PAYMENT_FAILED, USER_INACTIVE, COLD_DRIVER}`.
4. WHEN um novo cadastro é concluído, THE Recovery_Rule_Engine SHALL autorizar o cenário `NEW_SIGNUP_WELCOME` somente após decorrido o Min_Delay de aproximadamente 10 minutos do evento de cadastro.
5. IF um disparo é avaliado para um usuário dentro do período de Cooldown (entre 24h e 72h do último disparo), THEN THE Anti_Spam_Guard SHALL suprimir o disparo com Suppression_Reason `WITHIN_COOLDOWN`.
6. THE Anti_Spam_Guard SHALL autorizar no máximo 1 mensagem automática por evento crítico para o mesmo usuário, suprimindo as demais com Suppression_Reason `MAX_PER_WINDOW_REACHED` ou `DUPLICATE_MESSAGE`.
7. IF já existe uma Recovery_Attempt ativa para o mesmo usuário, THEN THE Anti_Spam_Guard SHALL suprimir um novo disparo com Suppression_Reason `CONCURRENT_RECOVERY_ACTIVE` (sem recuperações simultâneas).
8. WHEN o Recovery_Decision é `DISPATCH`, THE Tracking_Module SHALL delegar o envio ao motor de disparo server-side de `whatsapp-automation` (Job_Worker/Dispatch_Job), sem recriar QR, sessão, anti-spam de baixo nível nem a camada de envio.
9. WHEN o Recovery_Decision é `DISPATCH`, THE Tracking_Module SHALL registrar uma Recovery_Attempt com Contact_Status `CONTACTED` e a referência ao Dispatch_Job, gravando audit log `RECOVERY_AUTO_DISPATCH`.
10. WHEN um administrador com `RASTREAMENTO_MANAGE` aciona manualmente a recuperação de um usuário, THE Tracking_Module SHALL submeter o gatilho ao Recovery_Rule_Engine e, quando o Recovery_Decision é `DISPATCH`, registrar audit log `RECOVERY_TRIGGER` via `executeAdminMutation`; WHEN o Recovery_Decision é `SUPPRESS`, THE Tracking_Module SHALL retornar `_SKIPPED` com o Suppression_Reason e registrar `RECOVERY_TRIGGER_SKIPPED`.
11. THE Tracking_Module SHALL registrar cada supressão automática como log estruturado com o Suppression_Reason, sem gravar PII nem o conteúdo da mensagem.
12. IF a delegação ao Job_Worker de `whatsapp-automation` falha ou o Dispatch_Job não pode ser criado, THEN THE Tracking_Module SHALL concluir a avaliação do Recovery_Decision, registrar a falha como log estruturado em separado e SHALL não marcar o Contact_Status como `CONTACTED`, mantendo o módulo operável.

### Requirement 10: Personalização por IA via Provider_Abstraction sob autorização do motor

**User Story:** Como dono, quero que a IA personalize a mensagem de recuperação, mas só dispare quando
o motor de regras autorizar, para que a IA não aja por conta própria.

#### Acceptance Criteria

1. WHERE o Recovery_Decision é `DISPATCH`, THE Tracking_Module SHALL invocar a Provider_Abstraction de `admin-assistant` para personalizar a mensagem do Recovery_Scenario antes da delegação do envio.
2. IF o Recovery_Decision é `SUPPRESS`, THEN THE Tracking_Module SHALL não invocar a Provider_Abstraction nem disparar mensagem, mantendo a IA inativa.
3. THE Tracking_Module SHALL invocar o provedor de IA exclusivamente por meio da AI_Edge_Function de `admin-assistant`, sem expor a AI_Api_Key ao frontend e sem criar nova abstração de provedor.
4. THE Tracking_Module SHALL enviar ao provedor de IA apenas o contexto mínimo necessário à personalização, sem incluir PII bruta, segredos ou dados além do Recovery_Scenario e dos campos autorizados.
5. IF a invocação da Provider_Abstraction falha ou retorna provedor não implementado, THEN THE Tracking_Module SHALL usar o template padrão do Recovery_Scenario e SHALL registrar o erro de forma estruturada, mantendo a recuperação operável (degradação controlada).
6. WHEN o usuário responde a uma mensagem de recuperação e precisa de atendimento, THE Tracking_Module SHALL compor com o Intelligent_Transfer/handoff de `suporte-inteligente`, sem recriar o atendimento por IA nem o console de suporte.

### Requirement 11: Recovery_Performance (dashboard de recuperação)

**User Story:** Como dono, quero um dashboard de recuperação com quantos estavam em risco, foram
contatados, responderam e converteram, para medir a eficácia da recuperação.

#### Acceptance Criteria

1. THE Recovery_Performance SHALL exibir, por Time_Window, os contadores de usuários em Contact_Status `AT_RISK`, `CONTACTED`, `REPLIED` e `CONVERTED`.
2. THE Recovery_Performance SHALL calcular a Recovery_Rate como `CONVERTED / CONTACTED`, retornando 0 quando `CONTACTED` é 0.
3. FOR ALL Time_Window, THE Recovery_Performance SHALL produzir uma Recovery_Rate no intervalo fechado `[0, 1]`.
4. WHEN um usuário em recuperação responde por meio da Conversation de `whatsapp-automation`, THE Tracking_Module SHALL atualizar o Contact_Status daquele usuário para `REPLIED`.
5. WHEN um usuário em recuperação completa a conversão associada ao seu Recovery_Scenario, THE Tracking_Module SHALL atualizar o Contact_Status daquele usuário para `CONVERTED`.
6. THE Contact_Status SHALL progredir apenas na ordem `AT_RISK → CONTACTED → REPLIED → CONVERTED`, sem retroceder a um estado anterior.
7. THE Recovery_Performance SHALL renderizar os gráficos em SVG inline e SHALL carregar cada bloco via Partial_Degradation.

### Requirement 12: Configuração da chave de IA na aba (reuso de Provider_Abstraction)

**User Story:** Como dono, quero configurar a chave de IA (Gemini/Grok/Claude) dentro da aba de
rastreamento, reusando a abstração existente, sem novo cofre de chave.

#### Acceptance Criteria

1. WHERE o administrador possui `RASTREAMENTO_MANAGE`, THE Tracking_Module SHALL exibir uma área de configuração que seleciona o Active_Provider da Provider_Abstraction (claude, gemini, grok, llama) e registra a respectiva AI_Api_Key.
2. THE Tracking_Module SHALL armazenar a AI_Api_Key exclusivamente no Vault por meio da Provider_Abstraction de `admin-assistant`, sem criar novo armazenamento de chave.
3. THE Tracking_Module SHALL nunca retornar a AI_Api_Key em texto puro em respostas, logs ou traces.
4. WHEN um administrador com `RASTREAMENTO_MANAGE` altera a Tracking_AI_Config, THE Tracking_Module SHALL persistir a mudança via `executeAdminMutation` com action `TRACKING_AI_CONFIG_UPDATE` e usando `expected_updated_at`.
5. IF o `expected_updated_at` informado diverge do `updated_at` atual da Tracking_AI_Config, THEN THE Tracking_Module SHALL recusar a mudança com `STALE_VERSION`.
6. WHERE nenhum provedor de IA está configurado, THE Tracking_Module SHALL degradar para o template padrão do Recovery_Scenario, mantendo o rastreamento, a classificação, o score e o motor de regras determinísticos plenamente operáveis.
7. WHERE o administrador possui apenas `RASTREAMENTO_VIEW`, THE Tracking_Module SHALL ocultar a área de configuração da chave de IA.

### Requirement 13: Busca e filtros em popover

**User Story:** Como administrador, quero buscar e filtrar usuários por múltiplos critérios em um
popover compacto, para localizar rapidamente quem preciso recuperar.

#### Acceptance Criteria

1. THE Tracking_Module SHALL expor o Tracking_Filter em popover acionado por botão com ícone `SlidersHorizontal`, sem painel inline largo.
2. THE Tracking_Filter SHALL oferecer filtros por nome, telefone, status, data, tipo de problema, motorista/empresa e faixa de Risk_Score.
3. WHEN o administrador aplica o Tracking_Filter, THE Tracking_Module SHALL retornar somente os usuários que satisfazem simultaneamente todos os critérios aplicados.
4. WHEN o administrador altera valores do Tracking_Filter sem acionar a aplicação explícita, THE Tracking_Module SHALL manter os resultados da última busca aplicada sem disparar nova busca.
5. THE Tracking_Module SHALL sanitizar o texto de busca, escapando curingas de `ILIKE` (`%`, `_`, `\`) antes de qualquer comparação no servidor.
6. THE Tracking_Module SHALL reusar a Global_Search de `admin-cliente-360` para a identificação do usuário por nome/e-mail/telefone/ID/empresa, sem recriar a busca global.
7. WHEN nenhum usuário satisfaz o Tracking_Filter, THE Tracking_Module SHALL exibir o estado vazio `Nenhum usuário encontrado.` sem erro.
8. WHEN nenhum Tracking_Filter está aplicado, THE Tracking_Module SHALL listar todos os usuários elegíveis de forma paginada, reservando o estado vazio apenas para quando filtros aplicados não retornam resultados.
9. WHERE a faixa de Risk_Score informada tem valor mínimo maior que o valor máximo, THE Tracking_Module SHALL retornar um conjunto vazio sem erro, permitindo a faixa impossível em vez de recusá-la como inválida.

### Requirement 14: Composição com alertas, logs técnicos e insights existentes

**User Story:** Como dono, quero que os alertas, logs técnicos e insights do rastreamento usem os
sistemas que já existem, para não ter ferramentas duplicadas.

#### Acceptance Criteria

1. WHEN o Tracking_Module detecta uma condição relevante de operação (por exemplo, pico anormal de abandono em uma etapa), THE Tracking_Module SHALL publicar o sinal em `system_alerts` de `admin-central-operacao`, sem recriar um sistema de alertas próprio.
2. THE Tracking_Module SHALL registrar eventos técnicos e ações administrativas em `admin_audit_logs`, consultáveis pelo `admin_logs_list` de `admin-central-operacao`, sem recriar um visualizador de logs próprio.
3. THE Tracking_Module SHALL expor seus agregados determinísticos (funil, score, recuperação) de forma que o `Supervisor_Insight` e o `Anomaly_Detector` de `admin-ia-supervisora` possam compô-los, sem recriar o motor de insights.
4. WHERE as fontes de `admin-central-operacao` ou `admin-ia-supervisora` não estão disponíveis, THE Tracking_Module SHALL degradar de forma controlada, mantendo as superfícies determinísticas próprias operáveis.
5. THE Tracking_Module SHALL não duplicar tabelas, RPCs ou políticas RLS já entregues pelos módulos compostos.
6. IF o mecanismo de degradação controlada não puder ser ativado para uma dependência composta indisponível, THEN THE Tracking_Module SHALL interromper apenas o processamento do bloco afetado e sinalizar o erro, sem prosseguir em estado indefinido e sem derrubar as superfícies determinísticas próprias.

### Requirement 15: Segurança server-side, isolamento, auditoria e master imutável

**User Story:** Como engenharia de segurança, quero que toda leitura e mutação do rastreamento
respeitem RLS server-side, gerem auditoria e nunca vazem PII, para que ninguém acesse dados sem
permissão.

#### Acceptance Criteria

1. THE Migration_124 SHALL definir toda RPC do Tracking_Module como `SECURITY DEFINER` com `SET search_path = public`, com `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`, exceto o Journey_Ingest_Endpoint anônimo write-only, que SHALL ser explicitamente concedido conforme o caso de uso sem login.
2. WHEN uma RPC gated do Tracking_Module é invocada sem `auth.uid()`, THE Tracking_Module SHALL abortar com `permission_denied`.
3. WHEN uma RPC gated do Tracking_Module é invocada por administrador sem a permissão exigida, THE Tracking_Module SHALL gravar `RASTREAMENTO_VIEW_DENIED` em `admin_audit_logs` com `before=NULL` e `after={ user_id, reason }` e abortar com `permission_denied`.
4. THE Migration_124 SHALL habilitar RLS em todas as tabelas novas do Tracking_Module, admitindo leitura administrativa apenas quando `is_admin_with_permission('RASTREAMENTO_VIEW')` e impedindo qualquer acesso cruzado entre usuários.
5. THE Tracking_Module SHALL impedir, via RLS, qualquer SELECT, INSERT, UPDATE ou DELETE das tabelas novas por role `anon` ou por usuário não-admin, exceto a escrita anônima restrita do Journey_Ingest_Endpoint.
6. THE Tracking_Module SHALL nunca expor PII bruta, conteúdo de mensagem ou segredos em respostas, logs estruturados ou traces.
7. WHEN qualquer mutação administrativa do Tracking_Module ocorre, THE Tracking_Module SHALL registrar audit log via `executeAdminMutation`, e a falha de audit logging SHALL não bloquear a mutação.
8. WHERE uma mutação administrativa toca a tabela `users`, THE Tracking_Module SHALL abortar antes do touch quando o alvo é o Master_Admin (`admin_username = 'Nexus_Vortex99'`), preservando a imutabilidade do master.
9. THE Tracking_Module SHALL validar todo input no frontend e revalidar no backend (tipo, formato, regra de negócio, sanitização e consistência), e IF um formulário é inválido, THEN THE Tracking_Module SHALL bloquear o envio e exibir uma mensagem de erro em pt-BR.
10. WHEN o frontend é contornado por chamada direta à API, THE Tracking_Module SHALL aplicar a validação de backend como autoridade e processar somente as requisições que passam na validação de backend.

### Requirement 16: Migration 124 idempotente, defensiva e com rollback documentado

**User Story:** Como mantenedor, quero a migration do rastreamento idempotente e com rollback
documentado, para aplicar e reverter com segurança sem buracos de numeração.

#### Acceptance Criteria

1. THE Migration_124 SHALL ser o arquivo `supabase/migrations/124_admin_rastreamento_inteligente.sql`, com numeração incremental sem buracos após a 119.
2. THE Migration_124 SHALL iniciar com um bloco `DO $check$` defensivo que aborta com mensagem clara se `is_admin_with_permission` (migration 030) ou outras dependências reusadas não estiverem presentes.
3. THE Migration_124 SHALL usar DDL idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, `INSERT ... ON CONFLICT DO NOTHING`).
4. THE Migration_124 SHALL conter um bloco `-- VERIFY` comentado ao fim para smoke test manual.
5. THE entrega SHALL incluir o par `124_admin_rastreamento_inteligente_rollback.sql`, documentado e não aplicado automaticamente.
6. WHERE uma segunda migration é necessária, THE entrega SHALL usar o sufixo de letra `124b_...`, preservando os números seguintes.
7. THE Migration_124 SHALL não recriar nem alterar de forma destrutiva tabelas, RPCs ou políticas já entregues pelos módulos reusados (092–118).

### Requirement 17: Governança de testes, Correctness Properties e Critical_Modules

**User Story:** Como dono, quero que nada seja considerado concluído sem testes completos no nível
máximo profissional, para garantir segurança e qualidade.

#### Acceptance Criteria

1. THE entrega SHALL incluir testes unitários e property-based (fast-check) para todo o núcleo puro: Abandonment_Cause_Classifier, Risk_Score_Calculator, Stage_Derivation, Funnel_Metrics e Recovery_Rule_Engine/Anti_Spam_Guard.
2. THE entrega SHALL incluir cenários de falha e caminhos negativos (permissão negada, input inválido, provedor de IA indisponível, fonte composta indisponível, ingestão de evento inválido).
3. THE entrega SHALL validar inputs no frontend e no backend, com mensagem de erro em pt-BR e bloqueio de envio em formulário inválido.
4. THE testes property-based SHALL usar `fc.constantFrom` para telefone/CPF/CNPJ/e-mail e SHALL não usar `fc.stringOf`, expondo spies de `vi.mock` via `globalThis` por causa do hoisting.
5. THE entrega SHALL incorporar os novos testes à Regression_Suite e SHALL manter a documentação técnica atualizada.
6. THE entrega SHALL declarar os módulos puros do núcleo como Critical_Modules em `tests/coverage.config.ts`, com threshold mínimo verificado por `scripts/check-coverage.ts` no CI, e WHEN a cobertura fica abaixo do threshold, THE pipeline SHALL falhar o build.
7. THE entrega SHALL garantir que qualquer falha de teste, inclusive flaky que só passou após retry, bloqueie merge e deploy, enquanto problemas de infraestrutura da pipeline SHALL não bloquear merge automaticamente.

## Resumo das Correctness Properties (Propriedades de Corretude)

As propriedades abaixo são **obrigatórias** (sem asterisco) e concentram-se no núcleo determinístico.
Serão formalizadas no `design.md` e cobertas por property tests (fast-check) na convenção
`cp<N>_<nome>.property.test.ts`.

- **CP1 — Abandonment_Cause_Classifier (totalidade + determinismo)**: para todo Journey_Summary, o
  classificador retorna exatamente uma Abandonment_Cause do domínio fechado (incluindo `UNKNOWN`), e o
  mesmo input sempre produz o mesmo output. (Requirement 5)
- **CP2 — Risk_Score (limites + determinismo)**: o Risk_Score está sempre em `[0, 100]` e é
  determinístico para os mesmos Risk_Factor. (Requirement 6)
- **CP3 — Risk_Score (monotonicidade)**: aumentar qualquer Risk_Factor, mantendo os demais, nunca
  diminui o Risk_Score. (Requirement 6)
- **CP4 — Risk_Band (função total + monotonicidade)**: todo Risk_Score em `[0, 100]` mapeia para
  exatamente uma Risk_Band, e score maior implica Risk_Band de severidade maior ou igual.
  (Requirement 6)
- **CP5 — Stage_Derivation (domínio fechado + determinismo)**: a etapa derivada pertence ao domínio
  ordenado de Funnel_Stage e é determinística para o mesmo conjunto de Journey_Event. (Requirement 8)
- **CP6 — Conversion_Funnel (monotonicidade do funil)**: na mesma Time_Window, a contagem de uma etapa
  posterior é sempre menor ou igual à da etapa anterior. (Requirement 8)
- **CP7 — Funnel_Metrics (limites + determinismo)**: toda taxa do funil está em `[0, 1]`, e
  `Stage_Conversion_Rate + Stage_Abandonment_Rate = 1` quando o denominador é maior que 0; o cálculo é
  determinístico. (Requirement 8)
- **CP8 — Recovery_Rule_Engine (determinismo + domínio fechado)**: o Recovery_Decision é determinístico
  e usa apenas Recovery_Scenario e Suppression_Reason dos domínios fechados. (Requirement 9)
- **CP9 — Anti_Spam_Guard (invariantes de supressão)**: nunca autoriza disparo dentro do Cooldown,
  autoriza no máximo 1 mensagem automática por evento crítico e suprime quando há recuperação
  simultânea ativa; reavaliar o mesmo estado produz a mesma decisão (idempotência). (Requirement 9)
- **CP10 — At_Risk_List (filtragem + ordenação total)**: o resultado é subconjunto da entrada, toda
  linha retornada satisfaz todos os filtros ativos e a ordenação é total e determinística.
  (Requirement 7)
- **CP11 — Recovery_Rate (limites)**: a Recovery_Rate está sempre em `[0, 1]` e o Contact_Status só
  progride na ordem `AT_RISK → CONTACTED → REPLIED → CONVERTED`. (Requirement 11)
- **CP12 — CSV Export (round-trip)**: para toda At_Risk_List exportada, reanalisar o CSV gerado
  (BOM/`;`/escape RFC 4180/`\r\n`) reproduz exatamente as mesmas linhas lógicas exportadas (propriedade
  de ida e volta do serializador). (Requirement 7)

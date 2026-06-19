# Requirements Document

## Introduction

A **Central de Suporte Inteligente** (`Support_Console`) entrega ao painel admin do FreteGO uma
área dedicada (`/admin/suporte`) onde o dono — único administrador inicial — atende clientes com o
máximo de automação. Esta spec cobre as partes **1, 4, 5, 6 e 10** do documento de ideias do dono
(`Credencial/Ideias`):

1. **Central de Suporte** — lista de atendimentos com status em domínio fechado de cinco estados
   (🟢 Novo, 🟡 Em andamento, 🔵 Aguardando cliente, ⚪ Resolvido, 🔴 Fechado), exibindo data, hora,
   nome do cliente, e-mail, WhatsApp, plano contratado e prioridade, com filtros em popover e
   paginação `10/50/100`.
4. **Base de Conhecimento (FAQ)** — CRUD de perguntas e respostas que serve tanto para consulta
   humana quanto para alimentar a IA de atendimento.
5. **IA de Atendimento** — a IA é a **primeira** a responder, fundamentada na Base de Conhecimento;
   resolve com segurança e encerra, ou encaminha para humano quando não tem resposta segura.
6. **Transferência Inteligente** — ao encaminhar, a IA avisa o cliente que um atendente assumirá; a
   partir daí a IA fica **bloqueada** naquela conversa e apenas o humano responde, sem conflito
   IA×humano; o botão **"Retornar para IA"** devolve o controle das mensagens futuras à IA.
10. **Atendimento por Prioridade (3 níveis)** — Nível 1 (IA resolve via Base de Conhecimento),
    Nível 2 (IA não resolve, encaminha para humano), Nível 3 (problema crítico de natureza
    financeira, técnica ou administrativa com marcador de alta prioridade visível imediatamente).

### Governança embutida (parte 2 do documento)

Esta spec **não** cria uma spec de governança separada. Cada funcionalidade entrega a própria camada
de validação e proteção, impede vazamento de dados entre usuários e contas, impede ações sem
permissão, é testável (unit + property + cenários de falha + validações no frontend **e** no
backend), trata erros de forma segura (erro tratado, registrado, sistema segue) e segue arquitetura
modular. A spec adere integralmente ao steering `testing-governance`, `project-conventions` e
`admin-patterns`.

### Reuso obrigatório (não duplicar, não quebrar)

- **notifications-hub (migration 041)**: esta spec **constrói o console admin de atendimento por
  cima** das tabelas já existentes `support_tickets`, `support_ticket_messages`,
  `chat_conversations`/`chat_messages` e das permissões `SUPORTE_VIEW`/`SUPORTE_REPLY`. Hoje
  `support_tickets.status` é `open`/`in_progress`/`resolved`; esta spec **amplia** o domínio para o
  modelo de cinco estados do dono de forma **compatível e migratória**, mapeando os estados
  existentes sem reescrever nem destruir dados.
- **admin-assistant (migration 047)**: a IA de atendimento ao **cliente** **reusa** a abstração de
  provedor de IA já entregue (`Provider_Abstraction`, seleção de `Active_Provider`, leitura da chave
  no Vault server-side via Edge Function, Claude funcional). A IA da admin-assistant é a IA **do
  dono** (observabilidade); a IA desta spec é voltada ao **cliente** no suporte — papéis distintos,
  camada de provedor compartilhada.
- **admin-foundation (migration 030) + steering `admin-patterns`**: AdminGuard + Stealth_404, gating
  em duas camadas (UI `useAdminPermission` + RPC `is_admin_with_permission`), `executeAdminMutation`
  (audit-by-construction), versionamento otimista (`expected_updated_at` + `STALE_VERSION`),
  idempotência `_SKIPPED`, migrations idempotentes com par `_rollback`, RPC security posture, master
  admin `Nexus_Vortex99` imutável, UI compacta.

### Migration

A entrega adiciona a **migration 115** (`115_suporte_inteligente.sql` + par documentado
`115_suporte_inteligente_rollback.sql`), próxima numeração livre (a maior no disco é 114). Caso seja
necessária uma segunda migration, esta SHALL usar sufixo de letra `115b_...`, preservando os números
116, 117 e 118 reservados às próximas specs.

### Idioma e convenções

Requisitos, UI e mensagens user-facing em **pt-BR**; action codes, error codes e identifiers em
**inglês** (UPPER_SNAKE). Mensagens canônicas anti-enumeração quando aplicável. As Correctness
Properties (Propriedades de Corretude) desta spec do painel são **obrigatórias** (sem asterisco);
propriedades opcionais, quando houver, são marcadas com `*`.

## Glossary

- **Support_Console**: Área administrativa entregue em `/admin/suporte`, que lista e opera os
  atendimentos de suporte. Construída sobre as tabelas de `notifications-hub`.
- **Admin_Panel**: Painel administrativo de `admin-foundation` (migration 030), acessível em
  `/admin/*`.
- **AdminGuard / AdminSidebar / useAdminPermission**: Componentes e hook de fundação reusados sem
  alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Master_Admin**: Dono do sistema, `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique),
  imutável.
- **Atendimento (Support_Ticket)**: Unidade de atendimento listada no Support_Console, persistida na
  tabela existente `support_tickets`. Pode ter `user_id` (cliente autenticado) ou ser de visitante
  anônimo (`user_id IS NULL` com `guest_name`/`guest_email`), conforme `notifications-hub`.
- **Atendimento_Message (support_ticket_messages)**: Mensagem pertencente a um Atendimento,
  persistida na tabela existente `support_ticket_messages`.
- **Ticket_Status**: Domínio fechado de status do Atendimento após a amplificação desta spec:
  `open`, `in_progress`, `waiting_customer`, `resolved`, `closed` (códigos internos em inglês).
- **Status_Display_Map**: Mapeamento determinístico de cada `Ticket_Status` para rótulo pt-BR e
  marcador visual: `open` → 🟢 Novo, `in_progress` → 🟡 Em andamento, `waiting_customer` →
  🔵 Aguardando cliente, `resolved` → ⚪ Resolvido, `closed` → 🔴 Fechado.
- **Status_Transition**: Função determinística que decide se uma transição de um `Ticket_Status` de
  origem para um de destino é válida. Define a máquina de estados dos cinco status.
- **Responder_Mode**: Domínio fechado `ai` ou `human` que indica quem responde o Atendimento no
  momento. Coluna nova em `support_tickets` com valor inicial `ai`.
- **Support_AI (AI_Agent)**: Agente de IA voltado ao **cliente**, primeiro a responder cada
  Atendimento, fundamentado na Knowledge_Base.
- **Provider_Abstraction**: Camada plugável de provedor de IA entregue por `admin-assistant`
  (migration 047), que seleciona o `Active_Provider` e lê a chave no Vault. **Reusada** por esta
  spec, sem nova abstração.
- **Active_Provider**: Provedor de IA atualmente selecionado na configuração compartilhada da
  Provider_Abstraction (`claude` funcional; `gemini`/`grok`/`llama` estruturais).
- **Support_AI_Edge_Function**: Edge Function (`support-ai-reply`) que monta o contexto de suporte
  (Knowledge_Base + histórico do Atendimento) e invoca a Provider_Abstraction; única camada que toca
  a chave do provedor para o fluxo de suporte.
- **Support_AI_Config**: Registro único de configuração da Support_AI (habilitada/desabilitada,
  `Confidence_Threshold`, modelo de suporte). Não armazena segredos; reusa a chave do Vault da
  Provider_Abstraction.
- **Confidence_Threshold**: Limite configurável (número entre 0 e 1) a partir do qual uma resposta
  fundamentada da Support_AI é considerada segura o suficiente para responder ao cliente.
- **Answerable_Signal**: Sinal booleano derivado da Support_AI indicando se a resposta proposta está
  fundamentada na Knowledge_Base com confiança maior ou igual ao `Confidence_Threshold`.
- **Knowledge_Base (FAQ)**: Conjunto de FAQ_Entry, base de perguntas e respostas, persistido em
  `support_kb_entries`. Serve para consulta humana e para fundamentar a Support_AI.
- **FAQ_Entry**: Item da Knowledge_Base com pergunta, resposta, categoria, estado de publicação e
  timestamps.
- **Intelligent_Transfer (Handoff)**: Operação que transfere o Atendimento da Support_AI para um
  atendente humano, definindo `Responder_Mode = human` e avisando o cliente.
- **Return_To_AI**: Operação acionada pelo botão "Retornar para IA" que devolve o controle das
  mensagens futuras do Atendimento à Support_AI, definindo `Responder_Mode = ai`.
- **Priority_Level**: Nível de atendimento em domínio fechado `{1, 2, 3}`, derivado pelo
  Priority_Classifier. Nível 1 = IA resolve; Nível 2 = encaminhado a humano; Nível 3 = crítico.
- **Priority_Classifier**: Função pura e determinística que, dados `Answerable_Signal` e
  `Critical_Category`, produz sempre o mesmo `Priority_Level`.
- **Critical_Category**: Domínio fechado `{financeiro, tecnico, administrativo}` que caracteriza um
  problema crítico (Nível 3).
- **Support_Filter**: Conjunto de filtros aplicáveis à lista de atendimentos (status, prioridade,
  Responder_Mode, intervalo de datas, busca textual), exposto em popover via ícone
  `SlidersHorizontal`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`; toda
  mutação admin desta spec passa por aqui.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a Permission_Matrix
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **has_admin_permission(p_user_id, p_action)**: Variante parametrizada (migration 041) usável em
  triggers/fan-out para checar permissão de um usuário-alvo sem depender de `auth.uid()`.
- **STALE_VERSION**: Erro padrão do projeto quando `expected_updated_at` não corresponde ao
  `updated_at` atual da linha (versionamento otimista).
- **SUPORTE_VIEW / SUPORTE_REPLY**: Permissões já existentes (`notifications-hub`), reusadas para
  leitura do console e para responder/transicionar atendimentos.
- **FAQ_VIEW / FAQ_EDIT**: Permissões novas para leitura e edição da Knowledge_Base.
- **SUPORTE_AI_CONFIG**: Permissão nova para configurar a Support_AI.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `SUPORTE_STATUS_CHANGE`,
  `SUPORTE_PRIORITY_CHANGE`, `SUPORTE_HANDOFF`, `SUPORTE_RETURN_TO_AI`, `SUPORTE_AI_REPLY`,
  `SUPORTE_AI_CONFIG_UPDATE`, `FAQ_CREATE`, `FAQ_UPDATE`, `FAQ_DELETE`, `SUPORTE_VIEW_DENIED`,
  `FAQ_VIEW_DENIED`.

## Requirements

### Requirement 1: Rota /admin/suporte, gating em duas camadas e padrão compacto

**User Story:** Como administrador com permissão `SUPORTE_VIEW`, quero acessar `/admin/suporte`
seguindo o padrão visual compacto do painel, para que apenas pessoas autorizadas operem o suporte.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/suporte` renderizando o Support_Console.
2. WHEN um administrador com `SUPORTE_VIEW` acessa `/admin/suporte`, THE AdminGuard SHALL renderizar
   o Support_Console.
3. IF um usuário sem `SUPORTE_VIEW` acessa `/admin/suporte`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
4. WHEN `auth.uid()` é nulo em qualquer leitura de dados do Support_Console, THE Support_Console
   SHALL negar a leitura com `permission_denied`.
5. THE AdminSidebar SHALL exibir o item `Suporte` apontando para `/admin/suporte`, gated por
   `SUPORTE_VIEW`.
6. THE Support_Console SHALL omitir o `<h1>` grande no topo da página, seguindo o padrão compacto do
   painel.
7. THE Support_Console SHALL expor os filtros em popover acionado por botão com ícone
   `SlidersHorizontal`, sem painel inline largo.
8. THE Support_Console SHALL oferecer paginação com seletor de tamanho `10`, `50` e `100`, com valor
   inicial `10`.

### Requirement 2: Lista de atendimentos com campos, filtros e paginação

**User Story:** Como administrador, quero ver todos os atendimentos em uma lista organizada com os
dados do cliente e do plano, para que eu localize e priorize cada solicitação rapidamente.

#### Acceptance Criteria

1. THE Support_Console SHALL listar cada Atendimento exibindo data de criação, hora de criação, nome
   do cliente, e-mail, WhatsApp, plano contratado, Priority_Level e Ticket_Status.
2. WHERE o Atendimento tem `user_id` não nulo, THE Support_Console SHALL derivar nome, e-mail,
   WhatsApp e plano contratado a partir dos dados do cliente autenticado.
3. WHERE o Atendimento é de visitante anônimo (`user_id IS NULL`), THE Support_Console SHALL exibir
   `guest_name` e `guest_email` e SHALL indicar plano contratado como `Sem plano`.
4. THE Support_Console SHALL exibir cada Ticket_Status conforme o Status_Display_Map, com o rótulo
   pt-BR e o marcador visual correspondente.
5. WHEN o administrador aciona a ação explícita de aplicar o Support_Filter (por exemplo, o botão
   `Aplicar`) por status, prioridade, Responder_Mode, intervalo de datas ou busca textual, THE
   Support_Console SHALL retornar somente os atendimentos que satisfazem todos os critérios
   aplicados.
6. THE Support_Console SHALL ordenar a lista por data de criação decrescente como ordenação inicial.
7. WHEN uma página de resultados é solicitada com um tamanho de página dentro do conjunto
   `{10, 50, 100}`, THE Support_Console SHALL retornar no máximo aquele número de atendimentos por
   página.
8. WHEN um novo Atendimento é criado por um cliente, THE Support_Console SHALL passar a exibir o
   novo Atendimento na lista somente após um refresh manual ou recarregamento de página acionado
   pelo administrador, sem inserção automática em tempo real do novo Atendimento.
9. IF o carregamento de um bloco agregado de dados do cliente falha de forma isolada, THEN THE
   Support_Console SHALL renderizar o restante da lista e sinalizar o bloco indisponível com opção
   de tentar novamente, sem interromper a página inteira.
10. WHEN o administrador altera valores do Support_Filter (status, prioridade, Responder_Mode,
    intervalo de datas ou busca textual) sem acionar a ação explícita de aplicar, THE Support_Console
    SHALL manter os resultados da última busca aplicada sem disparar uma nova busca.

### Requirement 3: Modelo de cinco status, máquina de estados e versionamento otimista

**User Story:** Como administrador, quero que cada atendimento tenha um status claro entre cinco
estados e que as mudanças de status sigam regras consistentes, para que o fluxo de atendimento seja
previsível e sem perda de dados históricos.

#### Acceptance Criteria

1. THE Ticket_Status SHALL pertencer ao domínio fechado `{open, in_progress, waiting_customer,
   resolved, closed}`.
2. THE migration 115 SHALL ampliar o domínio de `support_tickets.status` de forma compatível,
   preservando as linhas existentes em `open`, `in_progress` e `resolved` sem reescrita destrutiva,
   e SHALL adicionar os estados `waiting_customer` e `closed`.
3. THE Status_Display_Map SHALL mapear `open` para `🟢 Novo`, `in_progress` para `🟡 Em andamento`,
   `waiting_customer` para `🔵 Aguardando cliente`, `resolved` para `⚪ Resolvido` e `closed` para
   `🔴 Fechado`.
4. THE Status_Transition SHALL permitir as transições: de `open` para `{in_progress,
   waiting_customer, resolved, closed}`; de `in_progress` para `{waiting_customer, resolved,
   closed}`; de `waiting_customer` para `{in_progress, resolved, closed}`; de `resolved` para
   `{in_progress, closed}`.
5. WHERE o Ticket_Status de origem é `closed`, THE Status_Transition SHALL tratar `closed` como
   estado terminal, recusando qualquer transição para outro status.
6. IF uma mudança de status solicita uma transição fora do conjunto permitido pelo Status_Transition,
   THEN THE Support_Console SHALL recusar a mudança com erro `INVALID_STATUS_TRANSITION` e SHALL
   manter o Ticket_Status atual.
7. WHEN uma mudança de status solicita o mesmo status já vigente, THE Support_Console SHALL tratar a
   operação como idempotente, retornando resultado `_SKIPPED` com motivo `ALREADY_<STATUS>` sem
   gravar nova mutação.
8. WHEN um administrador com `SUPORTE_REPLY` altera o Ticket_Status por uma transição válida, THE
   Support_Console SHALL persistir a mudança usando `expected_updated_at` e SHALL registrar audit
   log com action `SUPORTE_STATUS_CHANGE` via `executeAdminMutation`.
9. IF o `expected_updated_at` informado diverge do `updated_at` atual do Atendimento, THEN THE
   Support_Console SHALL recusar a mudança com `STALE_VERSION`.
10. WHEN um cliente envia uma nova mensagem em um Atendimento cujo Ticket_Status é
    `waiting_customer` ou `resolved`, THE Support_Console SHALL transicionar o Ticket_Status para
    `in_progress`.

### Requirement 4: Permissões RBAC reusadas e novas

**User Story:** Como mantenedor da plataforma, quero permissões dedicadas e gating em duas camadas
para o suporte e a Base de Conhecimento, para que cada papel acesse apenas o que lhe compete.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL reusar `SUPORTE_VIEW` para leitura do Support_Console e
   `SUPORTE_REPLY` para responder, transicionar status, executar Handoff e Return_To_AI.
2. THE Permission_Matrix SHALL definir as ações novas `FAQ_VIEW`, `FAQ_EDIT` e `SUPORTE_AI_CONFIG`.
3. THE Permission_Matrix SHALL conceder `FAQ_VIEW` ao papel `SUPORTE` além de `ADMIN` e
   `SUPER_ADMIN`, e SHALL conceder `FAQ_EDIT` e `SUPORTE_AI_CONFIG` somente a `ADMIN` e
   `SUPER_ADMIN`.
4. THE função `is_admin_with_permission` SHALL reconhecer `FAQ_VIEW`, `FAQ_EDIT` e
   `SUPORTE_AI_CONFIG` com a mesma concessão por papel definida na Permission_Matrix.
5. WHEN o caller é anônimo, com `auth.uid()` nulo, THE `is_admin_with_permission` SHALL retornar
   falso para `FAQ_VIEW`, `FAQ_EDIT` e `SUPORTE_AI_CONFIG`.
6. THE Permission_Matrix SHALL manter o princípio deny-by-default, negando qualquer ação fora do
   domínio conhecido de ações.
7. WHERE uma RPC desta spec é gated e o caller falha o gating, THE RPC SHALL gravar audit log
   negativo `SUPORTE_VIEW_DENIED` ou `FAQ_VIEW_DENIED` com `before` nulo e `after` contendo
   `user_id` e `reason`, antes de abortar com `permission_denied`.
8. IF a checagem de permissão de uma ação protegida desta spec falha para o caller, THEN THE
   Support_Console SHALL negar a ação independentemente do papel do caller, incluindo o papel
   `ADMIN`, sem conceder exceção por papel, mantendo o princípio deny-by-default para todos os
   papéis.

### Requirement 5: Base de Conhecimento (FAQ) com CRUD

**User Story:** Como administrador, quero cadastrar, editar e remover perguntas e respostas em uma
Base de Conhecimento, para que ela sirva de consulta humana e alimente a IA de atendimento.

#### Acceptance Criteria

1. THE Knowledge_Base SHALL persistir cada FAQ_Entry em `support_kb_entries` com pergunta, resposta,
   categoria, estado de publicação e timestamps de criação e atualização.
2. WHEN um administrador com `FAQ_EDIT` cria uma FAQ_Entry, THE Knowledge_Base SHALL validar
   pergunta com tamanho entre 3 e 300 caracteres, resposta com tamanho entre 1 e 5000 caracteres e
   categoria pertencente ao domínio definido, e SHALL registrar audit log com action `FAQ_CREATE`
   via `executeAdminMutation`.
3. IF qualquer campo de uma FAQ_Entry viola a validação, THEN THE Knowledge_Base SHALL recusar a
   operação com erro de validação descritivo em pt-BR e NÃO SHALL persistir a FAQ_Entry.
4. WHEN um administrador com `FAQ_EDIT` edita uma FAQ_Entry, THE Knowledge_Base SHALL persistir a
   mudança usando `expected_updated_at` e SHALL registrar audit log com action `FAQ_UPDATE`, e IF o
   `expected_updated_at` diverge do `updated_at` atual, THEN THE Knowledge_Base SHALL recusar com
   `STALE_VERSION`.
5. WHEN um administrador com `FAQ_EDIT` remove uma FAQ_Entry, THE Knowledge_Base SHALL registrar
   audit log com action `FAQ_DELETE`, e WHEN a FAQ_Entry já não existe, THE Knowledge_Base SHALL
   retornar resultado `_SKIPPED` com motivo `ALREADY_REMOVED`.
6. WHERE um administrador tem apenas `FAQ_VIEW`, THE Knowledge_Base SHALL exibir as FAQ_Entry em modo
   somente leitura, ocultando controles de criação, edição e remoção.
7. THE Knowledge_Base SHALL determinar a exposição de uma FAQ_Entry à Support_AI exclusivamente pelo
   estado de publicação `publicada`, de modo que nenhum outro marcador exclua da Support_AI uma
   FAQ_Entry que esteja `publicada`.
8. THE Support_Console SHALL listar as FAQ_Entry com filtros em popover e paginação `10/50/100`,
   seguindo o padrão compacto do painel.

### Requirement 6: IA de atendimento como primeira a responder via Base de Conhecimento

**User Story:** Como cliente, quero que a IA tente resolver minha solicitação imediatamente usando a
Base de Conhecimento, para que dúvidas comuns sejam respondidas sem espera.

#### Acceptance Criteria

1. WHEN um Atendimento recebe uma mensagem de cliente e o Responder_Mode é `ai`, THE Support_AI
   SHALL ser invocada como primeira responsável, antes de qualquer atendente humano.
2. THE Support_AI SHALL fundamentar suas respostas exclusivamente nas FAQ_Entry com estado
   `publicada` da Knowledge_Base e no histórico do próprio Atendimento.
3. THE Support_AI_Edge_Function SHALL invocar a Provider_Abstraction de `admin-assistant`,
   reutilizando o `Active_Provider` e a chave armazenada no Vault, sem criar nova abstração de
   provedor e sem expor a chave ao frontend.
4. WHEN a resposta proposta pela Support_AI tem confiança maior ou igual ao `Confidence_Threshold`,
   THE Support_AI SHALL definir o `Answerable_Signal` como verdadeiro, responder ao cliente com uma
   Atendimento_Message marcada como gerada por IA, e SHALL transicionar o Ticket_Status para
   `resolved`.
5. WHEN a confiança da resposta proposta pela Support_AI é menor que o `Confidence_Threshold`, THE
   Support_AI SHALL definir o `Answerable_Signal` como falso e SHALL acionar o Intelligent_Transfer
   conforme o Requirement 7, sem responder ao cliente como se tivesse resolvido.
6. THE Support_AI SHALL registrar audit log com action `SUPORTE_AI_REPLY` a cada resposta enviada ao
   cliente, sem gravar segredos do provedor no registro.
7. WHERE a Support_AI está desabilitada na Support_AI_Config, THE Support_Console SHALL encaminhar
   todo novo Atendimento diretamente para atendimento humano via Intelligent_Transfer, sem invocar o
   provedor de IA.
8. WHEN um administrador com `SUPORTE_AI_CONFIG` altera a Support_AI_Config (habilitação, modelo ou
   `Confidence_Threshold`), THE Support_Console SHALL validar `Confidence_Threshold` como número
   entre 0 e 1 inclusive e SHALL persistir a mudança via `executeAdminMutation` com action
   `SUPORTE_AI_CONFIG_UPDATE`.
9. IF a invocação da Provider_Abstraction falha ou retorna provedor não implementado, THEN THE
   Support_AI SHALL acionar o Intelligent_Transfer para atendimento humano e SHALL registrar o erro,
   mantendo o Atendimento operável.

### Requirement 7: Transferência Inteligente (Handoff) da IA para humano

**User Story:** Como cliente, quero ser avisado de que um atendente humano assumirá quando a IA não
puder resolver, para que eu saiba que minha solicitação continua em andamento.

#### Acceptance Criteria

1. WHEN o Intelligent_Transfer é acionado para um Atendimento, THE Support_Console SHALL definir o
   `Responder_Mode` daquele Atendimento como `human`.
2. WHEN o Intelligent_Transfer é acionado, THE Support_Console SHALL inserir uma Atendimento_Message
   informando ao cliente, em pt-BR, que um atendente humano dará continuidade ao atendimento.
3. WHEN o Intelligent_Transfer é acionado, THE Support_Console SHALL transicionar o Ticket_Status
   para `in_progress`, salvo quando o Ticket_Status já for terminal `closed`.
4. WHEN o Intelligent_Transfer conclui, THE Support_Console SHALL registrar audit log com action
   `SUPORTE_HANDOFF` via `executeAdminMutation`.
5. WHEN o Intelligent_Transfer é acionado para um Atendimento cujo `Responder_Mode` já é `human`, THE
   Support_Console SHALL tratar a operação como idempotente, retornando resultado `_SKIPPED` com
   motivo `ALREADY_HUMAN` sem inserir nova mensagem de aviso nem novo audit log de mutação.
6. WHERE um administrador com `SUPORTE_REPLY` insere uma resposta humana em um Atendimento cujo
   `Responder_Mode` é `ai`, THE Support_Console SHALL executar o Intelligent_Transfer de forma
   atômica antes de aceitar a resposta humana, de modo que a IA deixe de ser a responsável.
7. IF a inserção da Atendimento_Message de aviso ao cliente falha durante o Intelligent_Transfer,
   THEN THE Support_Console SHALL concluir a transferência definindo `Responder_Mode = human` e
   SHALL registrar o erro de forma estruturada, sem bloquear o handoff.

### Requirement 8: Exclusão mútua entre IA e humano na mesma conversa

**User Story:** Como dono, quero garantir que nunca a IA e um humano respondam ao mesmo tempo o mesmo
atendimento, para que não exista conflito nem resposta duplicada ao cliente.

#### Acceptance Criteria

1. THE Support_Console SHALL manter, para cada Atendimento, um único `Responder_Mode` vigente por
   vez, em domínio fechado `{ai, human}`.
2. WHILE o `Responder_Mode` de um Atendimento é `human`, THE Support_AI SHALL ser impedida de gerar
   ou inserir qualquer Atendimento_Message naquele Atendimento.
3. IF a Support_AI tenta inserir uma Atendimento_Message em um Atendimento cujo `Responder_Mode` é
   `human`, THEN THE Support_Console SHALL recusar a inserção com erro `AI_LOCKED` e SHALL não
   persistir a mensagem.
4. WHILE o `Responder_Mode` de um Atendimento é `ai`, THE Support_Console SHALL aceitar resposta
   humana somente após transicionar atomicamente o `Responder_Mode` para `human`, conforme o
   Requirement 7.6.
5. THE Support_Console SHALL garantir que, para qualquer sequência de mensagens de cliente, respostas
   de IA, respostas humanas, Handoff e Return_To_AI em um Atendimento, nenhuma Atendimento_Message
   gerada por IA seja persistida durante um intervalo em que o `Responder_Mode` esteja `human`.

### Requirement 9: Retornar para IA

**User Story:** Como administrador, quero devolver o atendimento à IA depois de concluir minha parte,
para que mensagens futuras daquele cliente voltem a ser tratadas automaticamente.

#### Acceptance Criteria

1. WHERE um administrador com `SUPORTE_REPLY` opera um Atendimento cujo `Responder_Mode` é `human`,
   THE Support_Console SHALL exibir o botão `Retornar para IA`.
2. WHEN o administrador aciona o Return_To_AI, THE Support_Console SHALL definir o `Responder_Mode`
   do Atendimento como `ai`, de modo que as mensagens futuras voltem a ser tratadas pela Support_AI.
3. WHEN o Return_To_AI conclui, THE Support_Console SHALL registrar audit log com action
   `SUPORTE_RETURN_TO_AI` via `executeAdminMutation`.
4. WHEN o Return_To_AI é acionado para um Atendimento cujo `Responder_Mode` já é `ai`, THE
   Support_Console SHALL tratar a operação como idempotente, retornando resultado `_SKIPPED` com
   motivo `ALREADY_AI` sem nova mutação.
5. THE Return_To_AI SHALL afetar apenas as mensagens futuras do Atendimento, preservando todas as
   Atendimento_Message já registradas, inclusive as inseridas durante o intervalo humano.
6. WHERE um administrador tem apenas `SUPORTE_VIEW`, THE Support_Console SHALL ocultar o botão
   `Retornar para IA`, e IF a RPC de Return_To_AI é chamada sem `SUPORTE_REPLY`, THEN THE
   Support_Console SHALL recusar com `permission_denied`.

### Requirement 10: Atendimento por prioridade em três níveis

**User Story:** Como dono, quero que cada atendimento seja classificado em três níveis de prioridade
de forma determinística, para que eu identifique imediatamente os casos críticos.

#### Acceptance Criteria

1. THE Priority_Level SHALL pertencer ao domínio fechado `{1, 2, 3}`.
2. THE Priority_Classifier SHALL ser uma função pura e determinística que, dados o `Answerable_Signal`
   e a presença de `Critical_Category`, produz sempre o mesmo `Priority_Level`.
3. WHERE a solicitação corresponde a uma `Critical_Category` (`financeiro`, `tecnico` ou
   `administrativo`), THE Priority_Classifier SHALL classificar o Atendimento como `Priority_Level`
   3, independentemente do `Answerable_Signal`.
4. WHERE não há `Critical_Category` e o `Answerable_Signal` é verdadeiro, THE Priority_Classifier
   SHALL classificar o Atendimento como `Priority_Level` 1.
5. WHERE não há `Critical_Category` e o `Answerable_Signal` é falso, THE Priority_Classifier SHALL
   classificar o Atendimento como `Priority_Level` 2.
6. WHEN um Atendimento é classificado como `Priority_Level` 1, THE Support_AI SHALL responder via
   Knowledge_Base e, ao resolver, SHALL transicionar o Ticket_Status para `resolved`.
7. WHEN um Atendimento é classificado como `Priority_Level` 2, THE Support_Console SHALL encaminhar o
   Atendimento para atendimento humano via Intelligent_Transfer.
8. WHEN um Atendimento é classificado como `Priority_Level` 3, THE Support_Console SHALL exibir um
   marcador de alta prioridade imediatamente visível na lista de atendimentos e SHALL acionar o
   Intelligent_Transfer para atendimento humano.
9. WHEN o `Priority_Level` de um Atendimento muda, THE Support_Console SHALL registrar audit log com
   action `SUPORTE_PRIORITY_CHANGE` via `executeAdminMutation`.
10. THE Support_Console SHALL manter tratamento estritamente separado por nível, de modo que a
    Support_AI atue somente em atendimentos de `Priority_Level` 1 e o atendimento via console humano
    atue somente em atendimentos de `Priority_Level` 2 e 3, sem que a Support_AI trate os níveis 2 e
    3 e sem acionamento automático de atendimento humano para o nível 1, salvo o Intelligent_Transfer
    por baixa confiança previsto no Requirement 6.5.

### Requirement 11: RLS, isolamento de dados, audit e master imutável

**User Story:** Como engenharia de segurança, quero que toda leitura e mutação do suporte e da Base
de Conhecimento respeitem RLS server-side, gerem audit para mutações admin e preservem a precedência
de permissão, para que ninguém vaze dados de outra conta ou execute ações sem permissão.

#### Acceptance Criteria

1. THE Support_Console SHALL admitir SELECT em `support_tickets` e `support_ticket_messages` para um
   usuário não-admin apenas quando o `user_id` do Atendimento é igual a `auth.uid()`, e para admin
   apenas quando `is_admin_with_permission('SUPORTE_VIEW')`.
2. THE Knowledge_Base SHALL admitir SELECT de FAQ_Entry para qualquer admin com `FAQ_VIEW` e SHALL
   restringir INSERT, UPDATE e DELETE a `FAQ_EDIT`.
3. THE Support_Console SHALL impedir INSERT, UPDATE e DELETE diretos por role `authenticated` ou
   `anon` nas tabelas desta spec fora das RPCs `SECURITY DEFINER`, exceto pelas inserções de
   mensagem já permitidas ao dono do Atendimento conforme `notifications-hub`.
4. IF uma ação protegida é chamada por um caller sem a permissão exigida e com erros de validação
   simultâneos, THEN THE Support_Console SHALL responder com `permission_denied`, com precedência
   sobre qualquer erro de validação.
5. THE Support_Console SHALL nunca expor dados sensíveis de um cliente a outro cliente, garantindo
   isolamento por `auth.uid()` via RLS em todas as leituras de Atendimento e Atendimento_Message.
6. WHERE uma RPC desta spec é `SECURITY DEFINER`, THE RPC SHALL aplicar a postura padrão do projeto:
   `SET search_path = public`, recusa quando `auth.uid()` é nulo, checagem
   `is_admin_with_permission(...)` quando admin, `REVOKE ALL FROM PUBLIC` e
   `GRANT EXECUTE TO authenticated`.
7. THE Support_Console SHALL gravar audit log via `executeAdminMutation` para toda mutação admin
   desta spec, com action codes em inglês UPPER_SNAKE.
8. THE Support_Console SHALL preservar a imutabilidade do Master_Admin `Nexus_Vortex99`, abortando
   antes de qualquer UPDATE ou DELETE que tenha o Master_Admin como alvo em `users`.
9. THE Support_Console SHALL nunca registrar em audit log, em logs estruturados ou em traces a chave
   do provedor de IA nem o conteúdo bruto sensível do cliente.

### Requirement 12: Estabilidade, tratamento de erro e validação em duas pontas

**User Story:** Como dono, quero que cada operação de suporte trate erros de forma segura e valide
dados no frontend e no backend, para que falhas não derrubem o sistema nem permitam dados inválidos.

#### Acceptance Criteria

1. IF qualquer operação do Support_Console apresenta erro, THEN THE Support_Console SHALL tratar a
   situação, registrar o erro de forma estruturada e manter o sistema operável, sem interromper a
   página inteira.
2. THE Support_Console SHALL validar tipo, formato, regra de negócio e consistência de toda entrada
   de dados no frontend e novamente no backend.
3. WHEN a validação de input de um formulário do Support_Console falha, THE Support_Console SHALL
   bloquear o envio e SHALL exibir uma mensagem de erro em pt-BR, sendo a falha de validação de
   input a única condição que bloqueia o envio do formulário.
4. IF a Provider_Abstraction está indisponível ou retorna erro, THEN THE Support_Console SHALL
   degradar de forma controlada encaminhando o Atendimento para atendimento humano, sem perda do
   Atendimento nem das mensagens já registradas.
5. WHEN ocorre falha por dado duplicado em uma operação sujeita a enumeração, THE Support_Console
   SHALL responder com a mensagem canônica anti-enumeração definida no projeto.
6. THE Support_Console SHALL incorporar à Regression_Suite os testes unitários, de propriedade e de
   cenários de falha desta spec, conforme o steering `testing-governance`.
7. WHEN a validação de input de um formulário do Support_Console passa, THE Support_Console SHALL
   permitir o envio do formulário independentemente de outras condições do sistema, incluindo erro
   ou indisponibilidade do provedor de IA.

### Requirement 13: Migration 115 idempotente e compatível com rollback

**User Story:** Como engenheiro, quero que a migration desta spec seja idempotente, compatível e
reversível, para que a amplificação do modelo de suporte não quebre dados nem dependências
existentes.

#### Acceptance Criteria

1. THE migration 115 SHALL ser idempotente, usando `CREATE TABLE IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS` e `DROP POLICY IF EXISTS` antes de
   `CREATE POLICY`.
2. THE migration 115 SHALL validar defensivamente, via bloco `DO`, a presença das dependências
   `is_admin_with_permission` (migration 030), `support_tickets`/`support_ticket_messages`
   (migration 041) e da Provider_Abstraction (migration 047) antes de aplicar mudanças.
3. THE migration 115 SHALL adicionar as colunas `Responder_Mode`, `Priority_Level` e os timestamps
   de Handoff e Return_To_AI a `support_tickets` com valores padrão compatíveis, sem exigir reescrita
   das linhas existentes.
4. THE migration 115 SHALL ampliar a checagem de domínio de `support_tickets.status` para os cinco
   estados sem invalidar linhas existentes em `open`, `in_progress` ou `resolved`.
5. THE migration 115 SHALL acompanhar um par `115_suporte_inteligente_rollback.sql` documentado e não
   auto-aplicado, que reverte as adições desta spec.
6. WHERE uma segunda migration é necessária nesta entrega, THE entrega SHALL nomeá-la com sufixo de
   letra `115b_...`, preservando os números 116, 117 e 118.
7. THE migration 115 SHALL conceder e revogar privilégios das RPCs novas conforme a RPC security
   posture do projeto, sem expor RPC ao role `anon` salvo quando o caso de uso exigir explicitamente.

## Correctness Properties (a formalizar no design)

As propriedades abaixo são **obrigatórias** para esta spec do painel e serão formalizadas como testes
de propriedade (fast-check) no documento de design. Cada uma deriva dos requisitos indicados.

- **CP1 — Exclusão mútua IA×humano**: para qualquer sequência de operações em um Atendimento, nunca
  uma Atendimento_Message gerada por IA é persistida enquanto `Responder_Mode = human`, e toda
  resposta humana com `Responder_Mode = ai` transiciona atomicamente para `human` antes de ser
  aceita. (Requirements 7.6, 8.2, 8.3, 8.4, 8.5)
- **CP2 — Transições de status válidas**: para qualquer par (status de origem, status de destino), o
  Status_Transition aceita a transição se e somente se o par pertence ao conjunto definido, com
  `closed` terminal. (Requirements 3.4, 3.5, 3.6)
- **CP3 — Precedência de `permission_denied`**: para qualquer chamada a ação protegida sem a
  permissão exigida, o resultado é `permission_denied` mesmo na presença simultânea de erros de
  validação. (Requirements 4.7, 11.3)
- **CP4 — Idempotência de Handoff e Return_To_AI**: aplicar Handoff a um Atendimento já `human`, ou
  Return_To_AI a um já `ai`, não altera estado além da primeira aplicação e retorna `_SKIPPED`.
  (Requirements 7.5, 9.4)
- **CP5 — Classificação determinística de prioridade/nível**: para as mesmas entradas
  (`Answerable_Signal`, `Critical_Category`), o Priority_Classifier produz sempre o mesmo
  `Priority_Level`, com `Critical_Category` ⇒ 3, caso contrário verdadeiro ⇒ 1 e falso ⇒ 2.
  (Requirements 10.2, 10.3, 10.4, 10.5)

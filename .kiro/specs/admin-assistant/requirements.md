# Requirements Document

## Introduction

Esta spec entrega o módulo **Assistente** (`Assistente`) do painel administrativo do FreteGO,
acessível em `/admin/assistant` pela sidebar esquerda. É o **assistente de IA pessoal do dono do
sistema** (Master Admin), uma ferramenta de observabilidade e conversação que enxerga "tudo que
entra e tudo que sai" da plataforma — com ênfase especial em **erros do site e erros de console do
navegador**.

O módulo tem **três partes** numa única página:

1. **Mural de Destaques** (topo) — um feed somente-leitura, glanceável, onde o assistente publica o
   que percebeu: erros detectados, melhorias sugeridas e eventos críticos. Não é para interação; é
   um quadro de resumo. Cada destaque referencia a conversa de detalhe no chat.
2. **Chat** — conversa entre o dono e a IA. A cada mensagem do dono, o sistema **monta
   automaticamente o contexto com dados reais do Supabase** antes de chamar a API de IA, de modo a
   responder com precisão perguntas como: quantos motoristas se cadastraram nesta semana, quais
   fretes estão parados sem aceite, qual embarcador está mais ativo, houve erros críticos hoje.
3. **Configurações** — escolha do provedor de IA ativo (Claude, Gemini, Grok, Llama) e entrada da
   respectiva chave de API; um painel de status em tempo real (assistente ativo ou não, modelo em
   uso, últimos eventos críticos detectados); e o **toggle de WhatsApp** (entregue desligado).

Há ainda um pilar transversal: **captura global de erros** em todo o frontend (React error
boundary + handlers globais de `window` + wrapper de requisições), persistindo cada erro no Supabase
com timestamp, tipo, rota, usuário afetado e stack trace, incluindo erros de console do navegador.
Esses logs são a base das perguntas do chat e dos **alertas críticos**.

O **monitoramento autônomo de eventos críticos** roda no **servidor** via job agendado (pg_cron) +
Supabase Edge Function (a cada 1–5 min). Ele avalia **apenas eventos críticos** para não gastar
créditos de IA com eventos comuns (novos cadastros e fretes postados **não** são críticos e **não**
disparam mensagens). Ao detectar um evento crítico, o assistente salva o evento no banco e publica
uma mensagem automática no chat (e um destaque no mural) descrevendo o que aconteceu, onde ocorreu e
uma sugestão de correção.

A stack permanece TypeScript (strict) + React 18 + Vite + TailwindCSS + Supabase (Postgres + Auth +
Vault + Edge Functions) + Vitest + fast-check. A entrega adiciona a **migration 047**
(`047_admin_assistant.sql` + par de rollback documentado), o service
`src/services/admin/assistant.ts`, componentes em `src/components/admin/assistant/`, a página
`/admin/assistant`, a captura global de erros no frontend, e **duas Edge Functions**: uma para as
chamadas ao provedor de IA (abstração de provedor, Claude primeiro) e outra para o monitor agendado
de eventos críticos.

### Decisões explícitas e conscientes do dono (registradas)

Estas decisões foram tomadas conscientemente pelo dono/Master Admin e são premissas desta spec:

- **Acesso total e sem máscara**: o assistente tem acesso completo e irrestrito a todos os dados do
  Supabase (usuários, fretes, pagamentos, logs, erros, requisições), **sem mascaramento de PII**.
  Este painel e seus dados são visíveis **somente ao dono/Master Admin**.
- **Segredos sempre criptografados**: ainda que os dados de contexto sejam enviados sem máscara,
  **chaves de API / segredos de provedores e futuras credenciais de WhatsApp** são armazenados
  **criptografados server-side** (Supabase Vault, migration 042b) e **toda chamada ao provedor de
  IA passa por uma Edge Function** — a chave **nunca** é exposta no frontend.
- **Nota de privacidade (LGPD)**: o dono reconhece que dados reais, incluindo PII e dados de
  pagamento, são enviados a um **provedor de IA externo** por escolha consciente do dono. Esta
  ressalva é documentada e exibida nas Configurações.

### Fora de escopo (não construído nesta spec)

- **Envio real de WhatsApp**: a estrutura completa de despacho é construída, porém entregue
  **inativa** (toggle desligado por padrão; nenhum envio real ocorre). O canal real de WhatsApp
  será provido por uma **spec futura (Evolution API)**.
- **Implementações completas de Gemini, Grok e Llama**: apenas a **arquitetura plugável** é
  entregue; somente **Claude** funciona nesta entrega. Os demais provedores são estrutura/seleção,
  sem implementação funcional do cliente.
- **Remediação automatizada**: o assistente **apenas sugere** correções; **não** aplica correções
  nem executa mutações de remediação automaticamente.
- **Módulo de Marketing/Meta**: tratado em spec separada; nada dele é abordado aqui.
- **Refino retroativo de captura de erros em libs de terceiros** além dos pontos de captura
  definidos (boundary, handlers globais, wrapper de requisições).

## Glossary

- **Admin_Panel**: Painel administrativo entregue em `admin-foundation` (migration 030), acessível
  em `/admin/*`.
- **AdminGuard / AdminProvider / AdminLayoutRoute / AdminShell / AdminSidebar**: Componentes de
  fundação do painel, reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Master_Admin**: Dono do sistema, `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique),
  imutável. Único destinatário pretendido deste módulo.
- **Owner_Only_Gate**: Regra de acesso que restringe o módulo Assistente exclusivamente ao
  Master_Admin e/ou ao papel `SUPER_ADMIN`, avaliada tanto na UI quanto no servidor.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) -> boolean` em
  `src/services/admin/permissions.ts`, espelhada na função SQL `is_admin_with_permission`
  (migration 030).
- **ASSISTANT_VIEW**: Permissão de leitura/uso do módulo Assistente (mural, chat, status).
  Concedida exclusivamente a `SUPER_ADMIN`.
- **ASSISTANT_EDIT**: Permissão de alteração de configuração do módulo (provedor ativo, segredos,
  toggle de WhatsApp, thresholds). Concedida exclusivamente a `SUPER_ADMIN`.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a `Permission_Matrix`
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`. Toda
  mutação admin (config, despacho, etc.) passa por aqui.
- **Vault**: Extensão `supabase_vault` (já em uso na migration 042b) usada para guardar segredos de
  forma criptografada server-side.
- **Assistant_Service**: Service em `src/services/admin/assistant.ts` com a lógica de leitura,
  configuração e orquestração de mensagens do módulo.
- **Assistant_Page**: Página `/admin/assistant` que renderiza as três partes (Mural, Chat,
  Configurações) em layout compacto (padrão pós-cleanup).
- **Highlights_Feed (Mural_De_Destaques)**: Feed somente-leitura no topo da página, alimentado por
  Critical_Event e por marcos de conversa, com cada item linkando para a conversa de detalhe.
- **Highlight**: Item do Highlights_Feed, derivado de um Critical_Event ou de um evento de sistema
  relevante, contendo categoria, resumo, severidade, timestamp e referência à conversa.
- **Chat_Conversation (Assistant_Conversation)**: Conversa persistida entre o Master_Admin e a IA,
  armazenada em `assistant_conversations`.
- **Chat_Message (Assistant_Message)**: Mensagem persistida pertencente a uma Chat_Conversation,
  armazenada em `assistant_messages`, com papel (`role`) em domínio fechado
  (`user`, `assistant`, `system`).
- **Context_Builder**: Componente server-side que, a cada mensagem do usuário, consulta dados reais
  do Supabase e monta o **contexto** enviado ao provedor de IA.
- **AI_Provider**: Provedor externo de IA. Domínio fechado: `claude`, `gemini`, `grok`, `llama`.
- **Provider_Abstraction**: Camada plugável que seleciona e invoca o AI_Provider configurado por
  trás de uma interface comum, permitindo adicionar provedores sem refatorar o restante do módulo.
- **Active_Provider**: O AI_Provider atualmente selecionado em Assistant_Config.
- **AI_Edge_Function**: Edge Function (`assistant-ai`) que recebe contexto + mensagens, lê o segredo
  do Active_Provider no Vault e chama a API do provedor; única responsável por usar a chave.
- **Monitor_Edge_Function**: Edge Function (`assistant-monitor`) invocada pelo job agendado para
  avaliar eventos críticos.
- **Cron_Job**: Job `pg_cron` que invoca a Monitor_Edge_Function em intervalo configurável
  (1–5 min).
- **Critical_Event (Assistant_Critical_Event)**: Evento classificado como crítico, persistido em
  `assistant_critical_events`, base dos alertas e dos destaques.
- **Critical_Event_Type**: Domínio fechado dos tipos de evento crítico: `page_error_rate`,
  `request_failure_rate`, `unauthorized_access_attempt`, `failed_login_burst`, `payment_failure`,
  `db_performance_drop`.
- **Common_Event**: Evento não crítico (ex.: novo cadastro de usuário, frete postado) que **não**
  dispara mensagem nem consome créditos de IA.
- **Event_Classifier**: Lógica pura e determinística que, dado um conjunto de métricas/sinais,
  decide se há um Critical_Event e de qual Critical_Event_Type, sem efeitos colaterais.
- **Critical_Threshold**: Limite configurável (por Critical_Event_Type, onde aplicável) acima do
  qual um sinal vira Critical_Event. Armazenado em Assistant_Config.
- **Error_Log (error_logs)**: Registro de erro de frontend capturado globalmente, persistido em
  `error_logs` com timestamp, tipo, rota, usuário afetado (se houver) e stack trace.
- **Error_Type**: Domínio fechado do tipo de erro capturado: `react_render`, `window_error`,
  `unhandled_rejection`, `console_error`, `request_failure`.
- **Global_Error_Capture**: Conjunto de mecanismos de frontend (React error boundary, handlers de
  `window.onerror`/`unhandledrejection`, intercept de console e wrapper de requisições) que captura
  e persiste Error_Log, com batch/throttle anti-flood.
- **Error_Ingest_RPC**: RPC `SECURITY DEFINER` que recebe lotes de Error_Log do frontend e os
  persiste de forma segura, aplicando limites anti-flood.
- **Assistant_Config (assistant_config)**: Registro único de configuração do módulo: Active_Provider,
  modelo em uso, Critical_Threshold por tipo, intervalo do Cron_Job e estado do WhatsApp_Toggle.
  Segredos (chaves de API) **não** ficam em coluna legível; vão para o Vault.
- **Assistant_Status**: Visão de status em tempo real: assistente ativo/inativo, Active_Provider e
  modelo em uso, e últimos Critical_Event detectados.
- **WhatsApp_Toggle**: Flag booleana em Assistant_Config que ativa/desativa o despacho de alertas
  por WhatsApp. Entregue com valor inicial `false` (desligado).
- **WhatsApp_Dispatcher**: Seam (ponto de despacho) que, quando o WhatsApp_Toggle está ligado,
  enviaria o alerta crítico ao número do admin. Nesta entrega é **no-op** enquanto o toggle estiver
  desligado; nenhum envio real ocorre.
- **Compact_Layout_Pattern**: Padrão de UI compacta do painel admin: sem `<h1>` grande, filtros em
  popover via ícone `SlidersHorizontal`, paginação `10/50/100` (default 10) onde houver listas,
  botões `text-xs px-2.5 py-1`, cards em coluna única abaixo de 768px.
- **Migration_047**: `supabase/migrations/047_admin_assistant.sql`, idempotente, com par de rollback
  documentado (`047_admin_assistant_rollback.sql`), próxima numeração livre após 044 (045 reservada
  por `admin-settings`, 046 por `financeiro`).
- **LGPD_Notice**: Aviso exibido nas Configurações reconhecendo que dados reais (incluindo PII e
  pagamento) são enviados a um provedor de IA externo por decisão consciente do dono.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `ASSISTANT_CONFIG_UPDATED`,
  `ASSISTANT_PROVIDER_KEY_UPDATED`, `ASSISTANT_PROVIDER_KEY_CLEARED`, `ASSISTANT_WHATSAPP_TOGGLED`,
  `ASSISTANT_MESSAGE_SENT`, `ASSISTANT_CRITICAL_EVENT_DETECTED`, `ASSISTANT_VIEW_DENIED`.

## Requirements

### Requirement 1: Rota /admin/assistant, gating exclusivo do dono e padrão compacto

**User Story:** Como Master_Admin, quero acessar `/admin/assistant` exclusivamente como dono do
sistema, seguindo o padrão visual compacto dos demais módulos, para que apenas eu veja o assistente
e seus dados.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/assistant` renderizando a Assistant_Page.
2. WHEN o Master_Admin com `ASSISTANT_VIEW` acessa `/admin/assistant`, THE AdminGuard SHALL
   renderizar a Assistant_Page.
3. IF um usuário sem `ASSISTANT_VIEW` acessa `/admin/assistant`, THEN THE AdminGuard SHALL
   renderizar Stealth_404.
4. WHERE o usuário atual tem perfil `ADMIN`, `SUPORTE`, `FINANCEIRO` ou `MODERADOR`, THE AdminGuard
   SHALL renderizar Stealth_404 ao acessar `/admin/assistant`.
5. THE Owner_Only_Gate SHALL conceder acesso ao módulo somente a usuários com o papel `SUPER_ADMIN`
   ativo.
6. THE AdminSidebar SHALL exibir o item `Assistente` apontando para `/admin/assistant`, gated por
   `ASSISTANT_VIEW`.
7. THE Assistant_Page SHALL omitir o `<h1>` grande no topo da página, seguindo o
   Compact_Layout_Pattern.
8. THE Assistant_Page SHALL organizar a página em três seções identificáveis na ordem: Mural de
   Destaques (topo), Chat e Configurações.

### Requirement 2: Permissões ASSISTANT_VIEW e ASSISTANT_EDIT no RBAC

**User Story:** Como mantenedor da plataforma, quero permissões dedicadas e restritas ao dono para o
módulo Assistente, para que o gating em duas camadas funcione sem ampliar acesso a outros papéis.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL definir as ações `ASSISTANT_VIEW` e `ASSISTANT_EDIT`, concedendo
   ambas exclusivamente ao papel `SUPER_ADMIN`.
2. THE Permission_Matrix SHALL negar `ASSISTANT_VIEW` e `ASSISTANT_EDIT` aos papéis `ADMIN`,
   `SUPORTE`, `FINANCEIRO` e `MODERADOR`.
3. THE função `is_admin_with_permission` SHALL reconhecer `ASSISTANT_VIEW` e `ASSISTANT_EDIT`
   concedendo-as somente quando o caller tem papel `SUPER_ADMIN` ativo.
4. WHEN o caller é anônimo, com `auth.uid()` nulo, THE `is_admin_with_permission` SHALL retornar
   falso para `ASSISTANT_VIEW` e `ASSISTANT_EDIT`.
5. THE módulo SHALL manter o princípio deny-by-default, de modo que qualquer ação fora do domínio
   conhecido seja negada.

### Requirement 3: Captura global de erros do frontend

**User Story:** Como dono, quero que todo erro do frontend (em qualquer página ou requisição) seja
interceptado e salvo no Supabase, incluindo erros de console do navegador, para que o assistente
possa consultá-los e gerar alertas.

#### Acceptance Criteria

1. THE Global_Error_Capture SHALL capturar erros de renderização do React por meio de um error
   boundary que envolve a árvore da aplicação.
2. THE Global_Error_Capture SHALL capturar erros globais via handlers de `window.onerror` e de
   `unhandledrejection`.
3. THE Global_Error_Capture SHALL capturar erros de console do navegador originados de
   `console.error`.
4. THE Global_Error_Capture SHALL capturar falhas de requisição interceptando as chamadas de rede
   da aplicação (wrapper de `fetch`/Supabase).
5. WHEN um erro é capturado, THE Global_Error_Capture SHALL registrar um Error_Log contendo
   timestamp, Error_Type, a rota/página onde ocorreu, o identificador do usuário afetado quando
   houver sessão, e o stack trace quando disponível.
6. WHERE não há usuário autenticado no momento do erro, THE Global_Error_Capture SHALL registrar o
   Error_Log com o identificador de usuário nulo, sem falhar.
7. THE Global_Error_Capture SHALL enviar os Error_Log em lotes com throttling, limitando a taxa de
   envio para evitar inundar o backend.
8. IF a própria operação de captura ou envio de um Error_Log falha, THEN THE Global_Error_Capture
   SHALL descartar o erro de captura silenciosamente sem lançar novo erro à aplicação nem entrar em
   laço de recursão.
9. THE Error_Ingest_RPC SHALL persistir os lotes de Error_Log recebidos do frontend, classificando
   o `Error_Type` dentro do domínio fechado definido e rejeitando entradas com tipo fora do domínio.
10. THE Error_Type SHALL pertencer ao domínio fechado `react_render`, `window_error`,
    `unhandled_rejection`, `console_error`, `request_failure`.

### Requirement 4: Mural de Destaques (feed somente-leitura)

**User Story:** Como dono, quero um mural no topo com o que o assistente percebeu (erros, melhorias,
eventos críticos), para que eu tenha um resumo glanceável e entre na conversa de detalhe quando
quiser.

#### Acceptance Criteria

1. THE Highlights_Feed SHALL exibir, em ordem cronológica decrescente, os Highlight derivados de
   Critical_Event e de marcos de conversa relevantes.
2. THE Highlights_Feed SHALL ser somente-leitura, sem controles de interação além da navegação para
   a conversa de detalhe.
3. WHEN o Master_Admin seleciona um Highlight, THE Assistant_Page SHALL navegar para a
   Chat_Conversation referenciada por aquele Highlight.
4. THE Highlight SHALL exibir categoria, resumo, severidade e timestamp do evento de origem.
5. WHERE não há nenhum Highlight, THE Highlights_Feed SHALL exibir um estado vazio informativo sem
   gerar erro.
6. WHEN um novo Critical_Event é persistido, THE Highlights_Feed SHALL passar a incluir o Highlight
   correspondente na próxima atualização da página.
7. WHERE a carga do Highlights_Feed falha de forma isolada, THE Assistant_Page SHALL renderizar as
   demais seções normalmente e exibir um estado de erro com botão Tentar novamente apenas no Mural.

### Requirement 5: Chat com montagem automática de contexto a partir de dados reais

**User Story:** Como dono, quero conversar com a IA e receber respostas precisas baseadas em dados
reais da plataforma, para que eu pergunte coisas como quantos motoristas se cadastraram na semana ou
quais fretes estão parados sem aceite.

#### Acceptance Criteria

1. WHEN o Master_Admin envia uma Chat_Message de papel `user`, THE Context_Builder SHALL montar o
   contexto consultando dados reais do Supabase antes de invocar a AI_Edge_Function.
2. THE Context_Builder SHALL incluir no contexto, conforme a pergunta, métricas de usuários, fretes,
   pagamentos, requisições e Error_Log/Critical_Event recentes.
3. WHEN a AI_Edge_Function retorna uma resposta, THE Assistant_Service SHALL persistir a
   Chat_Message de papel `assistant` vinculada à mesma Chat_Conversation.
4. IF a persistência da Chat_Message de papel `assistant` falha por indisponibilidade temporária do
   banco, THEN THE Assistant_Page SHALL entregar a resposta ao usuário sem armazená-la no histórico,
   sem nova tentativa automática de persistência e sem perder a conversa em curso.
5. THE Assistant_Service SHALL persistir toda Chat_Message com papel pertencente ao domínio fechado
   `user`, `assistant`, `system`, e SHALL rejeitar papéis fora desse domínio.
6. IF a AI_Edge_Function retorna erro ou indisponibilidade do provedor, THEN THE Assistant_Page
   SHALL exibir uma mensagem de falha amigável e preservar a Chat_Message do usuário já persistida.
7. WHEN o Master_Admin abre o Chat, THE Assistant_Service SHALL carregar o histórico persistido da
   Chat_Conversation selecionada em ordem cronológica crescente.
8. THE Assistant_Service SHALL registrar `ASSISTANT_MESSAGE_SENT` em `admin_audit_logs` a cada envio
   de mensagem do usuário ao provedor, sem registrar o conteúdo bruto de PII no campo de auditoria.
9. WHEN o caller da rota de envio de mensagem não tem `ASSISTANT_VIEW`, THE servidor SHALL negar a
   operação e registrar `ASSISTANT_VIEW_DENIED` com `before` nulo e `after` contendo `user_id` e
   `reason`.

### Requirement 6: Histórico de conversas e mensagens persistido

**User Story:** Como dono, quero que conversas e mensagens fiquem salvas no banco, para que o mural
possa referenciar conversas passadas e eu retome o histórico.

#### Acceptance Criteria

1. THE Assistant_Service SHALL persistir cada Chat_Conversation em `assistant_conversations` com
   identificador, título derivável e timestamps de criação e atualização.
2. THE Assistant_Service SHALL persistir cada Chat_Message em `assistant_messages` vinculada a uma
   Chat_Conversation, com papel, conteúdo e timestamp.
3. WHEN uma Chat_Message é adicionada a uma Chat_Conversation, THE Assistant_Service SHALL atualizar
   o `updated_at` da Chat_Conversation correspondente.
4. THE Highlight derivado de Critical_Event SHALL referenciar a Chat_Conversation onde a mensagem
   automática do evento foi publicada.
5. WHERE uma Chat_Conversation referenciada por um Highlight não existe mais, THE Highlights_Feed
   SHALL exibir o Highlight sem link de navegação, sem gerar erro.
6. THE tabelas `assistant_conversations` e `assistant_messages` SHALL ter RLS habilitada, restrita
   ao acesso do Owner_Only_Gate (`SUPER_ADMIN`).

### Requirement 7: Configurações — provedor ativo, chave e status em tempo real

**User Story:** Como dono, quero escolher o provedor de IA ativo, inserir a respectiva chave de API
e ver um status em tempo real do assistente, para que eu controle qual IA responde e acompanhe o
estado do módulo.

#### Acceptance Criteria

1. THE Assistant_Config SHALL armazenar o Active_Provider dentro do domínio fechado `claude`,
   `gemini`, `grok`, `llama`, com valor inicial `claude`.
2. WHEN o Master_Admin com `ASSISTANT_EDIT` altera o Active_Provider, THE Assistant_Service SHALL
   persistir a mudança via `executeAdminMutation` com `action` igual a `ASSISTANT_CONFIG_UPDATED`.
3. WHEN o Master_Admin com `ASSISTANT_EDIT` salva a chave de API de um provedor, THE
   Assistant_Service SHALL armazenar o valor bruto server-side via Vault, sem persistir o valor
   bruto em colunas legíveis, e SHALL registrar `ASSISTANT_PROVIDER_KEY_UPDATED` no audit log com
   apenas metadados não sensíveis.
4. WHEN a leitura de configuração inclui uma chave de API, THE Assistant_Service SHALL retornar
   apenas um indicador `is_set` e uma máscara, sem retornar o valor bruto.
5. THE Assistant_Service SHALL nunca expor a chave de API bruta ao frontend; a chave SHALL ser lida
   apenas server-side pela AI_Edge_Function a partir do Vault.
6. THE Assistant_Status SHALL exibir se o assistente está ativo, o Active_Provider e o modelo em
   uso, e os últimos Critical_Event detectados.
7. WHERE o Active_Provider não tem chave de API definida (`is_set` falso), THE Assistant_Status
   SHALL indicar o assistente como inativo e a Assistant_Page SHALL exibir orientação para
   configurar a chave.
8. WHERE o usuário atual não tem `ASSISTANT_EDIT`, THE Assistant_Page SHALL exibir as configurações
   em modo somente leitura, ocultando controles de edição e o botão Salvar.
9. THE Assistant_Page SHALL exibir o LGPD_Notice na seção de Configurações, reconhecendo o envio de
   dados reais a provedor de IA externo por decisão consciente do dono.

### Requirement 8: Abstração de provedor plugável (Claude funcional, demais estruturais)

**User Story:** Como engenheiro, quero uma abstração de provedor plugável, para que Gemini, Grok e
Llama possam ser adicionados depois sem retrabalho, com Claude funcionando agora.

#### Acceptance Criteria

1. THE Provider_Abstraction SHALL expor uma interface comum de invocação que recebe contexto +
   mensagens e retorna a resposta do modelo, independente do AI_Provider.
2. WHEN o Active_Provider é `claude`, THE AI_Edge_Function SHALL invocar o cliente de Claude e
   retornar a resposta do modelo.
3. IF a invocação do cliente de Claude falha, THEN THE AI_Edge_Function SHALL retornar um erro
   tipado imediatamente, sem acionar fallback para outro AI_Provider.
4. THE Provider_Abstraction SHALL selecionar e invocar o cliente correspondente ao Active_Provider
   configurado em Assistant_Config.
5. WHERE o Active_Provider é `gemini`, `grok` ou `llama`, THE AI_Edge_Function SHALL responder com
   um erro tipado de provedor não implementado, sem expor segredos e sem quebrar o módulo.
6. THE adição de um novo AI_Provider SHALL exigir apenas a implementação do cliente correspondente
   atrás da interface comum, sem alterar o Context_Builder nem o fluxo de chat.
7. THE AI_Edge_Function SHALL ler a chave do Active_Provider exclusivamente do Vault e SHALL ser a
   única responsável por usar a chave na chamada ao provedor.

### Requirement 9: Classificação determinística de eventos críticos vs comuns

**User Story:** Como dono, quero que apenas eventos críticos disparem mensagens do assistente, para
que créditos de IA não sejam gastos com eventos comuns como novos cadastros e fretes postados.

#### Acceptance Criteria

1. THE Event_Classifier SHALL ser uma função pura e determinística que, dados os mesmos sinais de
   entrada, produz sempre a mesma classificação.
2. THE Event_Classifier SHALL classificar como Critical_Event somente sinais dentro do domínio
   Critical_Event_Type: `page_error_rate`, `request_failure_rate`, `unauthorized_access_attempt`,
   `failed_login_burst`, `payment_failure`, `db_performance_drop`.
3. THE Event_Classifier SHALL classificar novos cadastros de usuário e fretes postados como
   Common_Event.
4. WHEN um sinal é classificado como Common_Event, THE Monitor_Edge_Function SHALL não persistir
   Critical_Event, não publicar mensagem no chat e não invocar o provedor de IA.
5. WHEN um sinal é classificado como Critical_Event, THE Monitor_Edge_Function SHALL persistir o
   Critical_Event correspondente em `assistant_critical_events`.
6. THE Event_Classifier SHALL produzir, para cada Critical_Event, o Critical_Event_Type, a
   severidade e um resumo do que foi detectado.

### Requirement 10: Avaliação por threshold configurável

**User Story:** Como dono, quero limites configuráveis para os eventos baseados em contagem, para
que eu ajuste a sensibilidade dos alertas sem alterar código.

#### Acceptance Criteria

1. THE Assistant_Config SHALL armazenar um Critical_Threshold por Critical_Event_Type aplicável
   (`page_error_rate`, `request_failure_rate`, `failed_login_burst`).
2. WHEN a contagem observada de um sinal baseado em threshold é maior ou igual ao Critical_Threshold
   configurado, THE Event_Classifier SHALL classificar o sinal como Critical_Event.
3. WHEN a contagem observada de um sinal baseado em threshold é menor que o Critical_Threshold
   configurado, THE Event_Classifier SHALL não classificar o sinal como Critical_Event.
4. WHEN o Master_Admin com `ASSISTANT_EDIT` altera um Critical_Threshold, THE Assistant_Service
   SHALL persistir a mudança via `executeAdminMutation` com `action` igual a
   `ASSISTANT_CONFIG_UPDATED`.
5. THE Assistant_Service SHALL validar que cada Critical_Threshold é um inteiro maior ou igual a 1
   antes de persistir, rejeitando valores fora desse intervalo.
6. THE Assistant_Config SHALL armazenar o intervalo do Cron_Job em minutos, restrito ao intervalo de
   1 a 5 inclusive, com valor inicial dentro desse intervalo.

### Requirement 11: Detecção de tentativas de acesso não autorizado e ataques de login

**User Story:** Como dono, quero ser alertado sobre tentativas de acesso não autorizado a rotas
protegidas e sobre múltiplas falhas de login do mesmo IP, para que eu identifique possíveis
ataques.

#### Acceptance Criteria

1. WHEN são detectadas tentativas de acesso não autorizado a rotas protegidas, THE Event_Classifier
   SHALL classificar o sinal como Critical_Event do tipo `unauthorized_access_attempt`.
2. THE Event_Classifier SHALL agregar falhas de login por IP de origem dentro de uma janela de
   tempo definida.
3. WHEN a contagem de falhas de login do mesmo IP dentro da janela é maior ou igual ao
   Critical_Threshold de `failed_login_burst`, THE Event_Classifier SHALL classificar o sinal como
   Critical_Event do tipo `failed_login_burst`.
4. WHEN falhas de login provêm de IPs distintos, THE Event_Classifier SHALL agregar a contagem de
   forma independente por IP, sem somar IPs diferentes na mesma contagem.
5. WHEN uma falha de processamento de pagamento é detectada, THE Event_Classifier SHALL classificar
   o sinal como Critical_Event do tipo `payment_failure`.
6. WHEN uma queda súbita de desempenho do banco de dados é detectada, THE Event_Classifier SHALL
   classificar o sinal como Critical_Event do tipo `db_performance_drop`.

### Requirement 12: Monitoramento autônomo no servidor (pg_cron + Edge Function)

**User Story:** Como dono, quero que o monitoramento de eventos críticos rode sozinho no servidor em
intervalos curtos, para que alertas surjam sem eu precisar abrir o painel.

#### Acceptance Criteria

1. THE Cron_Job SHALL invocar a Monitor_Edge_Function em intervalo configurável entre 1 e 5 minutos.
2. WHEN a Monitor_Edge_Function executa, THE Monitor_Edge_Function SHALL coletar os sinais
   recentes (Error_Log, falhas de requisição, tentativas de acesso, falhas de login, falhas de
   pagamento, métricas de desempenho) e submetê-los ao Event_Classifier.
3. WHEN o Event_Classifier identifica um Critical_Event, THE Monitor_Edge_Function SHALL persistir o
   Critical_Event, publicar uma mensagem automática `assistant` na Chat_Conversation e gerar o
   Highlight correspondente.
4. THE mensagem automática de Critical_Event SHALL descrever o que aconteceu, onde ocorreu e uma
   sugestão de correção, sem aplicar nenhuma correção automaticamente.
5. WHEN nenhum Critical_Event é identificado em uma execução, THE Monitor_Edge_Function SHALL
   concluir sem publicar mensagens nem invocar o provedor de IA.
6. IF a Monitor_Edge_Function encontra um erro durante a execução, THEN THE Monitor_Edge_Function
   SHALL registrar o erro e concluir sem interromper as execuções agendadas seguintes.
7. THE Monitor_Edge_Function SHALL evitar republicar mensagem para qualquer evento já notificado,
   independentemente da criticidade, deduplicando por identidade do evento dentro da janela de
   avaliação.
8. THE Assistant_Service SHALL registrar `ASSISTANT_CRITICAL_EVENT_DETECTED` no audit log quando um
   Critical_Event é persistido pela Monitor_Edge_Function.

### Requirement 13: Estrutura de notificação por WhatsApp entregue inativa

**User Story:** Como dono, quero a estrutura completa de alerta crítico por WhatsApp pronta, porém
desligada por padrão com um toggle visível, para que eu a ative no futuro sem reconstruir nada.

#### Acceptance Criteria

1. THE Assistant_Config SHALL conter o WhatsApp_Toggle, do tipo booleano, com valor inicial `false`.
2. THE Assistant_Page SHALL exibir o WhatsApp_Toggle na seção de Configurações, indicando que a
   integração de WhatsApp ainda não está ativa.
3. WHILE o WhatsApp_Toggle está `false`, THE WhatsApp_Dispatcher SHALL ser um no-op, não realizando
   nenhum envio real de mensagem.
4. WHEN um Critical_Event é detectado WHILE o WhatsApp_Toggle está `false`, THE WhatsApp_Dispatcher
   SHALL não enviar nenhuma mensagem de WhatsApp.
5. WHEN o Master_Admin com `ASSISTANT_EDIT` alterna o WhatsApp_Toggle, THE Assistant_Service SHALL
   persistir a mudança via `executeAdminMutation` com `action` igual a `ASSISTANT_WHATSAPP_TOGGLED`.
6. THE WhatsApp_Dispatcher SHALL expor um seam de despacho preparado para o canal real, de modo que
   a futura spec de Evolution API conecte o envio sem alterar o fluxo de detecção de Critical_Event.
7. WHERE futuras credenciais de WhatsApp forem necessárias, THE Assistant_Config SHALL prever seu
   armazenamento via Vault, sem persistir credenciais em colunas legíveis.

### Requirement 14: Segurança server-side, segredos e auditoria

**User Story:** Como plataforma, quero que segredos sejam guardados com segurança e que toda
operação sensível seja auditada e gated no servidor, para que credenciais não vazem e ações fiquem
rastreáveis.

#### Acceptance Criteria

1. THE chaves de API de provedores e quaisquer credenciais de WhatsApp SHALL ser armazenadas
   criptografadas server-side via Vault, sem persistência em colunas legíveis.
2. THE chamadas ao provedor de IA SHALL ocorrer exclusivamente pela AI_Edge_Function, sem que a
   chave seja exposta ao frontend.
3. THE RPCs do módulo SHALL ser `SECURITY DEFINER` com `SET search_path = public`, validar
   `auth.uid()` não nulo e `is_admin_with_permission` antes de qualquer efeito, e aplicar
   `REVOKE ALL FROM PUBLIC` seguido de `GRANT EXECUTE TO authenticated`.
4. IF uma RPC do módulo é chamada por caller sem a permissão exigida, THEN a RPC SHALL registrar
   `ASSISTANT_VIEW_DENIED` em `admin_audit_logs` com `before` nulo e `after` contendo `user_id` e
   `reason`, e SHALL abortar com `permission_denied`.
5. WHEN uma alteração de Assistant_Config é persistida, THE Assistant_Service SHALL registrar o
   snapshot `before` e `after` no audit log, omitindo valores brutos de segredo.
6. WHEN o Master_Admin remove a chave de API de um provedor, THE Assistant_Service SHALL apagar o
   valor server-side, definir `is_set` como falso e registrar `ASSISTANT_PROVIDER_KEY_CLEARED` no
   audit log.
7. THE tabelas `error_logs`, `assistant_conversations`, `assistant_messages`,
   `assistant_critical_events` e `assistant_config` SHALL ter RLS habilitada, restrita ao
   Owner_Only_Gate, exceto a ingestão de Error_Log que ocorre pela Error_Ingest_RPC controlada.

### Requirement 15: Migration 047 idempotente com posture de segurança

**User Story:** Como engenheiro, quero aplicar a migration 047 sem efeitos colaterais em
reexecuções, para que o deploy seja seguro e reversível.

#### Acceptance Criteria

1. THE Migration_047 SHALL ser nomeada `supabase/migrations/047_admin_assistant.sql`, sendo a
   próxima numeração livre após 044 (045 reservada por `admin-settings`, 046 por `financeiro`), sem
   buracos.
2. THE Migration_047 SHALL envelopar todo o seu conteúdo em um único par `BEGIN; ... COMMIT;`.
3. WHEN a Migration_047 é reexecutada duas ou mais vezes consecutivas sobre um banco onde já foi
   aplicada com sucesso, THE Migration_047 SHALL concluir com `COMMIT` sem erro e produzir o mesmo
   estado de schema, usando exclusivamente DDL idempotente (`CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de
   `CREATE POLICY` e `INSERT ... ON CONFLICT DO NOTHING` nos seeds).
4. THE Migration_047 SHALL conter, antes de qualquer DDL, um bloco `DO $check$` que verifica a
   presença da migration 030 (`is_admin_with_permission`, `admin_audit_logs`) e da extensão
   `supabase_vault` (migration 042b), abortando com erro claro caso ausentes.
5. THE Migration_047 SHALL criar as tabelas `error_logs`, `assistant_conversations`,
   `assistant_messages`, `assistant_critical_events` e `assistant_config` com RLS habilitada.
6. THE Migration_047 SHALL semear um registro único de Assistant_Config com Active_Provider igual a
   `claude`, WhatsApp_Toggle igual a `false`, e Critical_Threshold e intervalo do Cron_Job com
   valores iniciais válidos, sem sobrescrever valores já existentes.
7. THE Migration_047 SHALL definir as RPCs do módulo como `SECURITY DEFINER` com
   `SET search_path = public`, `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`.
8. THE Migration_047 SHALL agendar o Cron_Job (`pg_cron`) que invoca a Monitor_Edge_Function de
   forma idempotente, evitando agendamentos duplicados em reexecução.
9. THE Migration_047 SHALL ser acompanhada de `047_admin_assistant_rollback.sql` que documenta os
   `DROP` reversos e o desagendamento do Cron_Job, mantido como documentação e não auto-aplicado.
10. THE Migration_047 SHALL conter, ao final, um bloco `-- VERIFY` permanentemente comentado com
    SELECTs de smoke test manual.

### Requirement 16: Acessibilidade e responsividade

**User Story:** Como dono usando teclado, leitor de tela ou dispositivo móvel, quero usar o
assistente com a mesma cobertura, para que o módulo seja acessível.

#### Acceptance Criteria

1. THE Assistant_Page SHALL associar cada campo de configuração e o campo de envio de mensagem a um
   rótulo via `htmlFor` ou `aria-label`.
2. THE Assistant_Page SHALL ser responsiva e legível em telas menores que 768px, empilhando as três
   seções em coluna única.
3. THE Assistant_Page SHALL anunciar mensagens novas do chat e toasts de status com `role` igual a
   `status` ou `alert`, conforme apropriado.
4. WHERE um controle de ação é apenas ícone, THE Assistant_Page SHALL prover `aria-label`
   descritivo.
5. THE Assistant_Page SHALL manter contraste mínimo WCAG AA nos textos e controles interativos.

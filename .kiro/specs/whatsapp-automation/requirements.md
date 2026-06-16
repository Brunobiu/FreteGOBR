# Requirements Document

## Introduction

O módulo **WhatsApp Automation** substitui o placeholder atual em `/admin/whatsapp`
(rota e item de menu já existentes, gated por `SETTINGS_VIEW`) por uma central
profissional e escalável de automação de WhatsApp integrada ao painel admin do
FreteGO. O módulo usa a **Evolution API** para conectar contas de WhatsApp e
executar disparos. O processamento de disparos (massa, grupo e programado) é
**server-side / em background durável**, continuando até a conclusão mesmo que o
usuário feche a aba ou o navegador.

O módulo é **multi-instância desde a concepção** e projetado para um número
**ilimitado** de WhatsApp_Instances. A quantidade de instâncias exibidas é
**data-driven** e lida de uma configuração (Max_Instances): o valor **inicial é 5**
(WhatsApp 1 a WhatsApp 5), mas elevar para 10, 20 ou mais é apenas uma mudança de
configuração, **sem reescrita de arquitetura**. Nenhum schema, RPC, política RLS,
Job_Worker ou componente de UI codifica o número 5 de forma fixa — toda entidade é
chaveada exclusivamente por `instance_id`. As instâncias são gerenciadas por um
painel na parte superior da tela. Cada instância é um **ambiente isolado** — seus
contatos, grupos, disparos, agendamentos, rascunhos, histórico, atendimento por IA
(chave, prompt e base de conhecimento) e extrator de contatos são exclusivos daquela
instância e **nunca** se misturam com os de outra instância. A seleção de uma
instância carrega exclusivamente os dados daquela instância. O isolamento é garantido
**server-side** (RLS e filtragem por `instance_id` nas RPCs), de modo que acesso
cruzado entre instâncias é impossível.

Além das cinco abas funcionais, o módulo oferece, sempre escopados à Active_Instance:
um **Dashboard da Instância** com contadores operacionais em tempo real; **Histórico
Completo** de todos os disparos executados, com duplicação e reenvio de campanhas
passadas; **Rascunhos** salvos para continuar depois; uma **Fila de Execução** que
mostra os disparos por estado; **Logs de Erro** detalhando destinatários que
falharam e o motivo, com reenvio apenas dos que falharam; **Importação e Exportação
CSV** de contatos e resultados; **Personalização de Mensagens** por variáveis de
template ({{nome}}, {{telefone}}, {{empresa}}); um **Painel de Estatísticas** por
disparo com tempo estimado de conclusão; e **Persistência após reinício** do
servidor, restaurando agendamentos e filas pendentes de onde pararam.

A conexão é **única por instância**: o admin lê o QR Code **uma única vez** por
instância e, a partir da sessão autenticada, **todos** os módulos daquela instância
reutilizam automaticamente a mesma sessão — Disparo em Massa, Disparo em Grupo,
Disparos Programados, Atendimento por IA e Extrator de Contatos — sem necessidade de
reconectar a cada módulo. O gerenciamento de conexão é centralizado e persistente,
mantendo a sessão ativa para que o admin não reconecte constantemente.

O módulo possui cinco áreas funcionais (abas), todas operando dentro da instância
selecionada:

1. **Disparo em Massa** — lista de contatos, múltiplos conteúdos multimídia,
   distribuição automática de conteúdos em blocos ou intercalada, intervalo
   configurável, quantidade por execução, controles
   iniciar/pausar/continuar/cancelar e progresso em tempo real.
2. **Disparo em Grupo** — seleção de um ou múltiplos grupos do WhatsApp conectado da
   instância, envio multimídia, agendamento e intervalo.
3. **Disparos Programados** — agendamento de disparos (data/hora, destinatários,
   grupos, conteúdo) executados automaticamente pelo servidor no momento marcado.
4. **Atendimento por IA** — área isolada das abas de disparo: chave de API, base de
   conhecimento da empresa e resposta automática a clientes com base na base
   registrada. Inclui uma **Central de Conversas** (Conversation_Inbox) que reúne
   todas as conversas do WhatsApp daquela instância em um só lugar, e a
   **transferência híbrida IA ↔ atendente humano** por conversa, na qual cada
   conversa tem **um único responsável por vez** (a IA ou um humano, nunca os dois
   simultaneamente), com bloqueio inteligente da IA enquanto a conversa estiver sob
   responsabilidade humana e preservação integral do histórico.
5. **Extrator de Contatos** — listagem e busca dos grupos da instância conectada,
   seleção de um ou múltiplos grupos, extração dos participantes, estatísticas
   (total, únicos, grupos analisados), remoção opcional de duplicados e geração de
   uma lista de números pronta para reutilização no Disparo em Massa.

O módulo segue os padrões herdados do painel admin (audit-by-construction via
`executeAdminMutation`, RBAC em duas camadas com `is_admin_with_permission`,
versionamento otimista `updated_at`/`STALE_VERSION`, idempotência `_SKIPPED`,
`Stealth404` para acesso negado, RPCs `SECURITY DEFINER` com search_path fixo).
Segredos sensíveis (chave da Evolution API e chave da API de IA) usam **Supabase
Vault**, nunca armazenados nem retornados em texto puro, e são escopados por
instância. Mensagens user-facing em pt-BR; action/error codes em inglês. A próxima
migration livre é a **044**.

## Glossary

- **WhatsApp_Module**: o módulo de automação de WhatsApp em `/admin/whatsapp`.
- **WhatsApp_Instance**: um dos ambientes isolados do módulo (rotulados WhatsApp 1,
  WhatsApp 2, ...), identificado por `instance_id`. O número de instâncias é
  ilimitado e definido por Max_Instances (valor inicial 5). Cada WhatsApp_Instance
  possui sua própria WhatsApp_Session, Contact_Lists, Contents, Dispatch_Jobs,
  Scheduled_Dispatches, Drafts, Campaign_History, configuração de AI_Service
  (AI_Api_Key, AI_Prompt e Knowledge_Base), cache de WhatsApp_Groups,
  Extracted_Contacts e Conversations (com seus Conversation_Modes).
  Dados de uma WhatsApp_Instance nunca são compartilhados,
  mesclados ou visíveis a outra WhatsApp_Instance.
- **Active_Instance**: a WhatsApp_Instance atualmente selecionada no Instance_Panel,
  cujo escopo determina exclusivamente quais dados são exibidos e manipulados na UI.
- **Instance_Panel**: painel na parte superior da tela que lista as WhatsApp_Instances
  configuradas (conforme Max_Instances) e o status de conexão de cada uma.
- **Max_Instances**: parâmetro de configuração que define quantas WhatsApp_Instances
  estão habilitadas/exibidas no módulo. É data-driven (lido de configuração/linhas de
  instância), tem valor inicial 5 e pode ser elevado sem alteração de código ou
  arquitetura. Nenhuma lógica de schema, RPC, RLS, Job_Worker ou UI codifica o número
  de instâncias de forma fixa.
- **instance_id**: identificador da WhatsApp_Instance, usado como chave de
  escopo/isolamento em toda entidade de dados e em toda RPC do WhatsApp_Module.
- **Evolution_API**: serviço externo de integração com WhatsApp usado para conectar
  sessões e enviar mensagens.
- **WhatsApp_Session**: instância de conexão de uma conta de WhatsApp via Evolution
  API, pertencente a **exatamente uma** WhatsApp_Instance. Existe **uma única**
  WhatsApp_Session por WhatsApp_Instance, compartilhada por todos os módulos daquela
  instância. Identificada por status (`DISCONNECTED`, `CONNECTING`, `QR_PENDING`,
  `CONNECTED`, `EXPIRED`).
- **Contact_List**: conjunto de números de telefone informados pelo admin para um
  disparo em massa, escopado a uma WhatsApp_Instance.
- **Contact_Number**: número de telefone individual no formato E.164 sem sinais de
  pontuação (ex.: `5511999999999`).
- **Content**: unidade de conteúdo de disparo composta por qualquer combinação de
  texto, imagem, vídeo, áudio e documento (um ou mais tipos juntos), escopada a uma
  WhatsApp_Instance.
- **Content_Media**: arquivo de mídia (imagem, vídeo, áudio ou documento) anexado a
  um Content, armazenado no Supabase Storage.
- **Distribution_Mode**: modo de distribuição de Contents entre contatos: `BLOCK`
  (blocos sequenciais) ou `INTERLEAVED` (rodízio/intercalado).
- **Send_Interval**: intervalo de tempo, em segundos, aguardado entre o envio de uma
  mensagem e a próxima, definido pelo admin.
- **Execution_Quota**: quantidade máxima de mensagens a enviar em uma execução de um
  disparo, definida pelo admin.
- **Dispatch_Job**: registro durável de um disparo (massa ou grupo) processado em
  background, escopado a uma WhatsApp_Instance, com status `DRAFT`, `QUEUED`,
  `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `FAILED`.
- **Dispatch_Recipient**: item individual de destino dentro de um Dispatch_Job (um
  contato ou um grupo), com status de envio (`PENDING`, `SENT`, `FAILED`,
  `SKIPPED`).
- **Group_Dispatch**: disparo direcionado a um ou mais grupos do WhatsApp conectado
  da WhatsApp_Instance.
- **WhatsApp_Group**: grupo do WhatsApp obtido da Evolution_API para a
  WhatsApp_Session conectada de uma WhatsApp_Instance.
- **Scheduled_Dispatch**: Dispatch_Job com execução agendada para uma data/hora
  futura, escopado a uma WhatsApp_Instance.
- **Job_Worker**: processo server-side (Supabase Edge Function acionada por
  agendador/pg_cron) que processa Dispatch_Jobs em background até a conclusão,
  respeitando o `instance_id` de cada Dispatch_Job.
- **AI_Service**: subsistema de Atendimento por IA, isolado das abas de disparo e
  escopado a uma WhatsApp_Instance.
- **Knowledge_Base**: conteúdo textual registrado pelo admin (informações da
  empresa, serviços, regras) usado como referência pelo AI_Service de uma
  WhatsApp_Instance.
- **AI_Api_Key**: chave de API do provedor de IA de uma WhatsApp_Instance,
  armazenada no Supabase Vault.
- **Evolution_Api_Key**: chave/credencial de acesso à Evolution API, armazenada no
  Supabase Vault.
- **Contact_Extractor**: subsistema da aba "Extrator de Contatos", escopado a uma
  WhatsApp_Instance.
- **Contact_Extraction**: operação que extrai os participantes de um ou mais
  WhatsApp_Groups selecionados da WhatsApp_Instance.
- **Extracted_Contact**: Contact_Number de um participante obtido de um
  WhatsApp_Group durante uma Contact_Extraction.
- **Dispatch_Ready_List**: string composta pelos Contact_Numbers únicos e válidos de
  uma Contact_Extraction, separados por vírgula, sem espaços, pronta para colar no
  módulo de Disparo em Massa (ex.: `5511999999999,5511888888888,5511777777777`).
- **Vault**: Supabase Vault, cofre de segredos cifrados.
- **Admin_User**: usuário autenticado do painel com permissão avaliada via
  `is_admin_with_permission`.
- **SETTINGS_VIEW / SETTINGS_EDIT**: permissões RBAC que controlam,
  respectivamente, visualização e mutação do WhatsApp_Module.
- **AI_Prompt**: prompt de sistema / persona configurável de uma WhatsApp_Instance,
  registrado pelo Admin_User, que define o comportamento e o tom do AI_Service
  daquela instância. É escopado por `instance_id` e nunca compartilhado com outra
  WhatsApp_Instance.
- **Instance_Dashboard**: painel da Active_Instance que exibe contadores operacionais
  (status da conexão, mensagens enviadas hoje, disparos em andamento, mensagens
  agendadas, disparos concluídos, mensagens com erro, fila atual, Replies_Received e
  Active_Conversations), atualizáveis em tempo real e escopados ao `instance_id`.
- **Campaign_History**: registro durável e persistente de todos os Dispatch_Jobs já
  executados em uma WhatsApp_Instance, consultável pelo Admin_User, com ações de
  duplicar e reenviar campanhas passadas.
- **Draft**: Dispatch_Job no status `DRAFT` — uma campanha salva sem iniciar o envio,
  editável e iniciável posteriormente, escopada a uma WhatsApp_Instance.
- **Execution_Queue**: visão da Active_Instance que lista os Dispatch_Jobs por estado
  — Aguardando (`QUEUED` ainda não em execução), Em execução (`RUNNING`), Pausada
  (`PAUSED`), Agendada (Scheduled_Dispatch), Concluída (`COMPLETED`), Cancelada
  (`CANCELLED`) e Erro (`FAILED`).
- **Error_Log**: relação dos Dispatch_Recipients com status `FAILED` de um
  Dispatch_Job, com o motivo (`failure_reason`) de cada falha, exibida ao Admin_User.
- **Failed_Resend**: reexecução que re-enfileira em um novo Dispatch_Job apenas os
  Dispatch_Recipients com status `FAILED` de um disparo anterior, sem reenviar os já
  `SENT`, preservando a idempotência.
- **Message_Variable**: variável de template no texto de um Content — `{{nome}}`,
  `{{telefone}}` e `{{empresa}}` — resolvida por Dispatch_Recipient no momento do
  envio a partir dos dados do destinatário (Recipient_Data).
- **Recipient_Data**: campos de dados de um Dispatch_Recipient (ex.: `nome`,
  `telefone`, `empresa`) usados para resolver Message_Variables, fornecidos via
  colunas mapeadas na importação CSV.
- **Rendered_Message**: mensagem final personalizada entregue a um Dispatch_Recipient
  após a substituição de todas as Message_Variables pelos valores de Recipient_Data.
- **CSV_Import**: operação de importar Contact_Numbers (e Recipient_Data opcional) de
  um arquivo CSV para uma Contact_List da Active_Instance, com validação por linha.
- **CSV_Export**: geração de arquivo CSV (contatos ou resultados de disparo) seguindo
  a convenção de CSV do projeto (BOM UTF-8, separador `;`, escape RFC 4180, quebra
  `\r\n`, truncamento em 10000 linhas, filename `whatsapp_<YYYYMMDD>_<HHmm>.csv`).
- **Dispatch_Statistics**: conjunto de métricas de um Dispatch_Job/instância — total
  enviado, total pendente, total concluído, total com erro e tempo estimado para
  conclusão (Estimated_Completion_Time).
- **Estimated_Completion_Time**: estimativa de tempo restante para concluir um
  Dispatch_Job, calculada como `Dispatch_Recipients pendentes × Send_Interval`.
- **Execution_Duration**: tempo de execução de um Dispatch_Job concluído, calculado
  como o intervalo entre o início do processamento e o instante em que o Dispatch_Job
  atingiu um estado terminal (`COMPLETED`, `CANCELLED` ou `FAILED`), exibido no
  Campaign_History.
- **Recovery_Process**: processo server-side que, após reinício do servidor, restaura
  Scheduled_Dispatches pendentes e Dispatch_Jobs em `QUEUED`, `RUNNING` ou `PAUSED`,
  retomando do próximo Dispatch_Recipient `PENDING` com base no estado durável.
- **Canonical_Message**: mensagem de erro user-facing padronizada anti-enumeração em
  pt-BR.
- **Conversation**: fio de atendimento entre o WhatsApp conectado de uma
  WhatsApp_Instance e **um** contato (Contact_Number), escopado por `instance_id`.
  Agrega o histórico completo de mensagens recebidas e enviadas daquele contato e
  possui um Conversation_Mode. Uma Conversation pertence a **exatamente uma**
  WhatsApp_Instance e nunca é compartilhada com outra instância.
- **Conversation_Mode**: estado de responsabilidade de uma Conversation, que define
  quem responde a conversa naquele momento. Domínio fechado: `AI_MODE`
  (🤖 Atendimento por IA — a IA responde automaticamente), `HUMAN_MODE`
  (👤 Atendimento Humano — apenas o atendente responde, IA bloqueada), `AI_PAUSED`
  (⏸ IA Pausada — IA temporariamente suspensa, nenhuma resposta automática) e
  `RETURNED_TO_AI` (🔄 Retornada para IA — devolvida ao modo automático após
  atendimento humano). Os modos em que a IA pode responder automaticamente
  (AI-allowed) são `AI_MODE` e `RETURNED_TO_AI`; nos modos `HUMAN_MODE` e `AI_PAUSED`
  a IA fica bloqueada.
- **Conversation_Inbox**: Central de Conversas dentro da aba Atendimento por IA que
  lista todas as Conversations da Active_Instance em um só lugar, com identificador
  do contato, prévia da última mensagem, horário e o Conversation_Mode atual,
  permitindo abrir o histórico completo e assumir o atendimento.
- **Human_Takeover**: ação do Admin_User de assumir manualmente uma Conversation
  ("Assumir Atendimento"), transicionando o Conversation_Mode para `HUMAN_MODE`,
  desabilitando imediatamente a resposta automática da IA naquela Conversation.
- **AI_Handoff_Message**: mensagem automática enviada pela IA ao cliente ao detectar
  que não há resposta adequada ou que o tema exige atendimento humano (ex.: "Não
  encontrei uma resposta adequada para sua solicitação. Vou encaminhar seu
  atendimento para um atendente."), após a qual a Conversation é automaticamente
  travada para a IA (transição para `HUMAN_MODE`).
- **Return_To_AI**: ação do Admin_User de devolver uma Conversation ao modo
  automático ("Retornar para IA"), transicionando o Conversation_Mode para
  `RETURNED_TO_AI`/`AI_MODE`, permitindo que a IA volte a responder novas mensagens
  daquele contato usando o histórico preservado.
- **Active_Conversations**: contador da Active_Instance com o número de Conversations
  em estado ativo de atendimento (em `AI_MODE`, `HUMAN_MODE`, `AI_PAUSED` ou
  `RETURNED_TO_AI` com atividade recente), escopado por `instance_id`.
- **Replies_Received**: contador da Active_Instance com o número de mensagens
  recebidas (inbound) de clientes pela WhatsApp_Session da instância no dia corrente,
  escopado por `instance_id`.

## Requirements

### Requirement 1: Acesso e gating de permissão do módulo

**User Story:** Como Admin_User, quero que o WhatsApp_Module seja acessível apenas a
quem tem permissão, para que recursos sensíveis de disparo e auto-resposta fiquem
protegidos.

#### Acceptance Criteria

1. WHEN um Admin_User acessa a rota `/admin/whatsapp`, THE WhatsApp_Module SHALL verificar a permissão `SETTINGS_VIEW` antes de renderizar qualquer conteúdo do módulo.
2. IF o Admin_User não possui a permissão `SETTINGS_VIEW`, THEN THE WhatsApp_Module SHALL renderizar o componente Stealth404 sem revelar a existência da rota.
3. WHERE uma ação de mutação (conectar sessão, criar disparo, agendar, salvar configuração de IA, iniciar extração) é exposta na UI, THE WhatsApp_Module SHALL exibir o controle somente quando o Admin_User possuir a permissão `SETTINGS_EDIT`.
4. WHEN uma RPC `SECURITY DEFINER` do WhatsApp_Module é invocada, THE WhatsApp_Module SHALL revalidar a permissão correspondente no servidor via `is_admin_with_permission` antes de executar qualquer efeito.
5. IF uma RPC do WhatsApp_Module é invocada sem `auth.uid()`, THEN THE WhatsApp_Module SHALL abortar com o erro `permission_denied`.
6. IF uma RPC do WhatsApp_Module é invocada por Admin_User sem a permissão exigida, THEN THE WhatsApp_Module SHALL registrar `WHATSAPP_VIEW_DENIED` em `admin_audit_logs` com `before=NULL` e `after={ user_id, reason }` e abortar com `permission_denied`.

### Requirement 2: Gerenciamento e isolamento de múltiplas instâncias

**User Story:** Como Admin_User, quero gerenciar múltiplas instâncias independentes
de WhatsApp em um painel superior, com a quantidade definida por Max_Instances
(data-driven, valor inicial 5), para operar várias contas sem que uma interfira na
outra.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL exibir, na parte superior da tela, um Instance_Panel com as WhatsApp_Instances independentes habilitadas conforme Max_Instances (valor inicial 5, rotuladas WhatsApp 1, WhatsApp 2, ...), conforme definido no Requirement 29, sem codificar a quantidade de forma fixa.
2. THE WhatsApp_Module SHALL exibir, para cada WhatsApp_Instance no Instance_Panel, o status de conexão como `🟢 Conectado` quando a WhatsApp_Session estiver `CONNECTED` e `🔴 Desconectado` nos demais estados.
3. WHEN o Admin_User seleciona uma WhatsApp_Instance no Instance_Panel, THE WhatsApp_Module SHALL definir essa WhatsApp_Instance como Active_Instance e carregar exclusivamente os dados dessa instância (contatos, grupos, disparos, agendamentos, AI_Service, extrator).
4. WHILE uma Active_Instance está selecionada, THE WhatsApp_Module SHALL operar todas as abas (Disparo em Massa, Disparo em Grupo, Disparos Programados, Atendimento por IA, Extrator de Contatos) exclusivamente sobre os dados da Active_Instance.
5. THE WhatsApp_Module SHALL escopar toda entidade de dados (Contact_List, Content, Content_Media, Dispatch_Job, Dispatch_Recipient, Group_Dispatch, WhatsApp_Group, Scheduled_Dispatch, configuração de AI_Service, Knowledge_Base, AI_Api_Key, Extracted_Contact) a uma única WhatsApp_Instance por meio de `instance_id`.
6. WHEN uma RPC do WhatsApp_Module lê ou grava qualquer entidade de dados, THE WhatsApp_Module SHALL filtrar e restringir a operação ao `instance_id` da Active_Instance no servidor (RLS e filtragem por `instance_id`), de modo que dados de outra WhatsApp_Instance não sejam lidos nem gravados.
7. FOR ALL pares de WhatsApp_Instances distintas A e B, THE WhatsApp_Module SHALL garantir que nenhum Dispatch_Recipient, Content, Contact_Number, Dispatch_Job, WhatsApp_Group, Knowledge_Base ou Extracted_Contact pertencente à instância A seja visível, retornado ou utilizado em operação da instância B (invariante de isolamento total).
8. IF uma RPC do WhatsApp_Module é invocada com `instance_id` ao qual o Admin_User não tem acesso ou que não existe, THEN THE WhatsApp_Module SHALL responder com a Canonical_Message anti-enumeração `Não foi possível concluir a operação.` sem revelar a existência ou ausência da instância.
9. WHEN uma WhatsApp_Instance é conectada ou desconectada, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id` afetado.
10. THE WhatsApp_Module SHALL manter o estado e o processamento de cada WhatsApp_Instance independentes, de forma que uma operação (conexão, disparo, extração, atendimento) em uma instância não altere o estado de nenhuma outra instância.

### Requirement 3: Conexão da conta de WhatsApp por instância via Evolution API

**User Story:** Como Admin_User, quero conectar a conta de WhatsApp de uma instância
via QR code e ver o status da sessão, para realizar operações pela conta conectada
daquela instância.

#### Acceptance Criteria

1. WHEN o Admin_User solicita conectar a WhatsApp_Session da Active_Instance, THE WhatsApp_Module SHALL requisitar à Evolution_API a criação/inicialização da instância correspondente ao `instance_id` e exibir o QR code retornado.
2. WHILE a WhatsApp_Session da Active_Instance está no estado `QR_PENDING`, THE WhatsApp_Module SHALL exibir o QR code e o status atual da sessão para o Admin_User.
3. WHEN a Evolution_API confirma o pareamento da Active_Instance, THE WhatsApp_Module SHALL atualizar o status da WhatsApp_Session dessa instância para `CONNECTED` e refletir o status no Instance_Panel.
4. WHILE a WhatsApp_Session da Active_Instance está `CONNECTED`, THE WhatsApp_Module SHALL exibir o status conectado e habilitar as ações de disparo, extração e atendimento dessa instância.
5. IF a Evolution_API retorna erro ou indisponibilidade ao conectar, THEN THE WhatsApp_Module SHALL exibir a Canonical_Message `Não foi possível conectar o WhatsApp.` e manter o status `DISCONNECTED` da Active_Instance.
6. WHEN o Admin_User solicita desconectar a WhatsApp_Session da Active_Instance, THE WhatsApp_Module SHALL encerrar a instância correspondente na Evolution_API e atualizar o status dessa WhatsApp_Instance para `DISCONNECTED`, sem afetar as demais instâncias.
7. THE WhatsApp_Module SHALL armazenar a Evolution_Api_Key no Vault e nunca retorná-la em texto puro em respostas, logs ou traces.
8. IF uma ação de disparo, extração ou atendimento é solicitada enquanto a WhatsApp_Session da Active_Instance não está `CONNECTED`, THEN THE WhatsApp_Module SHALL bloquear a ação e exibir a Canonical_Message `Conecte o WhatsApp antes de iniciar o disparo.`

### Requirement 4: Conexão única por instância compartilhada entre módulos

**User Story:** Como Admin_User, quero ler o QR Code uma única vez por instância e
usar a mesma sessão em todos os módulos daquela instância, para não reconectar o
WhatsApp a cada funcionalidade.

#### Acceptance Criteria

1. WHEN a WhatsApp_Session de uma WhatsApp_Instance atinge o status `CONNECTED`, THE WhatsApp_Module SHALL disponibilizar essa mesma sessão autenticada para todos os módulos da instância (Disparo em Massa, Disparo em Grupo, Disparos Programados, Atendimento por IA, Extrator de Contatos) sem nova leitura de QR Code.
2. THE WhatsApp_Module SHALL manter no máximo uma WhatsApp_Session ativa por WhatsApp_Instance, reutilizada por todos os módulos daquela instância.
3. WHILE a WhatsApp_Session de uma WhatsApp_Instance está `CONNECTED`, THE WhatsApp_Module SHALL permitir que qualquer módulo dessa instância opere sem solicitar reconexão.
4. THE WhatsApp_Module SHALL gerenciar a conexão de forma centralizada e persistente, mantendo a WhatsApp_Session ativa entre acessos do Admin_User enquanto a Evolution_API a reportar válida.
5. IF a WhatsApp_Session de uma WhatsApp_Instance transiciona para `EXPIRED` ou `DISCONNECTED`, THEN THE WhatsApp_Module SHALL sinalizar a necessidade de reconexão apenas para os módulos dessa instância e exibir a Canonical_Message `Conecte o WhatsApp antes de iniciar o disparo.` ao tentar operar.
6. WHEN um módulo de uma WhatsApp_Instance envia mensagem ou consulta grupos, THE WhatsApp_Module SHALL utilizar a WhatsApp_Session da própria instância, nunca a sessão de outra WhatsApp_Instance.

### Requirement 5: Montagem e validação da lista de contatos (Disparo em Massa)

**User Story:** Como Admin_User, quero colar ou importar grandes listas de números
separados por vírgula ou por linha e ver o total de contatos, para preparar um
disparo em massa na instância selecionada com agilidade.

#### Acceptance Criteria

1. WHEN o Admin_User cola ou importa texto na área de contatos da Active_Instance, THE WhatsApp_Module SHALL aceitar Contact_Numbers separados por vírgula, por quebra de linha, ou por ambos na mesma entrada.
2. WHEN a Contact_List é processada, THE WhatsApp_Module SHALL normalizar cada Contact_Number removendo espaços e sinais de pontuação não numéricos antes da validação.
3. WHEN a Contact_List é processada, THE WhatsApp_Module SHALL remover Contact_Numbers duplicados, mantendo uma única ocorrência de cada número.
4. WHEN a Contact_List é exibida, THE WhatsApp_Module SHALL apresentar o contador de total de contatos válidos.
5. IF um Contact_Number não corresponde ao formato de número de telefone válido, THEN THE WhatsApp_Module SHALL marcá-lo como inválido, excluí-lo do total válido e informar a quantidade de números inválidos ao Admin_User.
6. THE WhatsApp_Module SHALL validar a Contact_List no frontend e revalidar no backend antes de criar o Dispatch_Job, persistindo-a com o `instance_id` da Active_Instance.
7. IF a Contact_List válida está vazia ao iniciar um disparo, THEN THE WhatsApp_Module SHALL bloquear o início e exibir a Canonical_Message `Informe ao menos um contato válido.`

### Requirement 6: Criação de múltiplos conteúdos multimídia

**User Story:** Como Admin_User, quero criar vários conteúdos diferentes, cada um
combinando texto, imagem, vídeo, áudio e documento, para variar as mensagens do
disparo da instância selecionada.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL permitir a criação de múltiplos Contents para um mesmo disparo, sem limitar a quantidade a um único Content.
2. WHERE o Admin_User adiciona mídia a um Content, THE WhatsApp_Module SHALL aceitar qualquer combinação de texto, imagem, vídeo, áudio e documento, incluindo todos os tipos simultaneamente.
3. WHEN o Admin_User anexa um Content_Media, THE WhatsApp_Module SHALL validar o tipo MIME do arquivo e rejeitar tipos não suportados com o erro `INVALID_FILE_TYPE`.
4. WHEN um Content_Media é anexado, THE WhatsApp_Module SHALL armazenar o arquivo no Supabase Storage e associá-lo ao Content da Active_Instance.
5. IF um Content não possui texto nem ao menos um Content_Media, THEN THE WhatsApp_Module SHALL marcar o Content como inválido e impedir seu uso em um disparo.
6. THE WhatsApp_Module SHALL validar cada Content no frontend e revalidar no backend antes de criar o Dispatch_Job, persistindo-o com o `instance_id` da Active_Instance.

### Requirement 7: Distribuição automática de conteúdos entre contatos

**User Story:** Como Admin_User, quero distribuir conteúdos diferentes entre os
contatos em blocos ou de forma intercalada, para que nem todos recebam a mesma
mensagem.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL oferecer os Distribution_Modes `BLOCK` e `INTERLEAVED` para a distribuição de Contents na Contact_List.
2. WHERE o Distribution_Mode é `BLOCK`, THE WhatsApp_Module SHALL atribuir cada Content a um bloco sequencial de contatos conforme o tamanho de bloco definido pelo Admin_User.
3. WHERE o Distribution_Mode é `INTERLEAVED`, THE WhatsApp_Module SHALL atribuir os Contents aos contatos em rodízio na ordem registrada dos Contents.
4. WHEN a distribuição é calculada, THE WhatsApp_Module SHALL atribuir exatamente um Content a cada Dispatch_Recipient da Contact_List.
5. IF o número de contatos excede a soma dos blocos definidos no modo `BLOCK`, THEN THE WhatsApp_Module SHALL atribuir os contatos restantes reiniciando a sequência de Contents a partir do primeiro.
6. THE WhatsApp_Module SHALL persistir a atribuição Content↔Dispatch_Recipient no Dispatch_Job da Active_Instance antes do início do processamento.

### Requirement 8: Configuração de intervalo e quantidade por execução

**User Story:** Como Admin_User, quero definir livremente o intervalo entre envios e
quantas mensagens enviar por execução, para controlar o ritmo do disparo.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL permitir que o Admin_User defina o Send_Interval com valores predefinidos (30s, 45s, 1min, 2min, 5min, 10min, 15min) e um valor personalizado.
2. IF o Send_Interval informado é menor ou igual a zero ou não numérico, THEN THE WhatsApp_Module SHALL rejeitar o valor e exibir a Canonical_Message `Informe um intervalo válido.`
3. THE WhatsApp_Module SHALL permitir que o Admin_User defina a Execution_Quota de mensagens a enviar na execução corrente.
4. IF a Execution_Quota informada é menor que 1 ou não numérica, THEN THE WhatsApp_Module SHALL rejeitar o valor e exibir a Canonical_Message `Informe uma quantidade válida.`
5. WHEN o Job_Worker processa um Dispatch_Job, THE Job_Worker SHALL enviar no máximo o número de mensagens igual à Execution_Quota da execução corrente.
6. WHEN o Job_Worker envia uma mensagem, THE Job_Worker SHALL aguardar o Send_Interval antes de enviar a próxima mensagem do Dispatch_Job.
7. WHEN a Execution_Quota corrente é atingida e há Dispatch_Recipients pendentes, THE WhatsApp_Module SHALL manter o Dispatch_Job em estado `PAUSED` aguardando nova execução definida pelo Admin_User.
8. THE WhatsApp_Module SHALL validar Send_Interval e Execution_Quota no frontend e revalidar no backend.

### Requirement 9: Controles do disparo (iniciar, pausar, continuar, cancelar)

**User Story:** Como Admin_User, quero iniciar, pausar, continuar e cancelar um
disparo, para controlar a execução a qualquer momento.

#### Acceptance Criteria

1. WHEN o Admin_User aciona "Iniciar disparo" em um Dispatch_Job válido da Active_Instance, THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `QUEUED` e habilitar seu processamento pelo Job_Worker.
2. WHEN o Admin_User aciona "Pausar" em um Dispatch_Job `RUNNING`, THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `PAUSED` e interromper novos envios após a mensagem em curso.
3. WHEN o Admin_User aciona "Continuar" em um Dispatch_Job `PAUSED`, THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `QUEUED` retomando do próximo Dispatch_Recipient `PENDING`.
4. WHEN o Admin_User aciona "Cancelar" em um Dispatch_Job ativo, THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `CANCELLED` e impedir novos envios.
5. IF o Admin_User aciona uma transição de estado já aplicada (ex.: pausar um Dispatch_Job já `PAUSED`), THEN THE WhatsApp_Module SHALL retornar `{ skipped: true, reason }` sem efeito adicional e registrar o log `_SKIPPED`.
6. WHEN uma transição de estado do Dispatch_Job é solicitada, THE WhatsApp_Module SHALL aplicar versionamento otimista via `expected_updated_at` e abortar com `STALE_VERSION` se o registro tiver sido alterado.
7. IF uma transição inválida é solicitada (ex.: continuar um Dispatch_Job `COMPLETED` ou `CANCELLED`), THEN THE WhatsApp_Module SHALL rejeitar a transição com o erro `INVALID_STATE_TRANSITION`.
8. WHEN uma transição de estado válida é executada, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`.

### Requirement 10: Processamento durável em background

**User Story:** Como Admin_User, quero que o disparo continue rodando no servidor
mesmo se eu fechar a aba ou o navegador, para não depender de manter o sistema
aberto.

#### Acceptance Criteria

1. WHEN um Dispatch_Job é colocado em `QUEUED`, THE WhatsApp_Module SHALL persistir todo o estado necessário (Contact_List, Contents, atribuições, Send_Interval, Execution_Quota, progresso, `instance_id`) de forma durável no banco de dados.
2. WHILE um Dispatch_Job está `QUEUED` ou `RUNNING`, THE Job_Worker SHALL processar os envios no servidor independentemente de o Admin_User manter a página, a aba ou o navegador abertos.
3. WHEN o Job_Worker envia uma mensagem a um Dispatch_Recipient, THE Job_Worker SHALL atualizar o status do Dispatch_Recipient (`SENT` ou `FAILED`) e o progresso do Dispatch_Job de forma durável imediatamente após o envio.
4. IF o Job_Worker é reiniciado ou interrompido durante o processamento, THEN THE Job_Worker SHALL retomar a partir do próximo Dispatch_Recipient `PENDING` sem reenviar mensagens já marcadas como `SENT`.
5. WHEN o Job_Worker tenta enviar a um Dispatch_Recipient já marcado como `SENT`, THE Job_Worker SHALL ignorar o reenvio (idempotência por Dispatch_Recipient).
6. IF o envio a um Dispatch_Recipient falha na Evolution_API, THEN THE Job_Worker SHALL marcar o Dispatch_Recipient como `FAILED`, registrar o motivo e prosseguir para o próximo Dispatch_Recipient `PENDING`.
7. WHEN todos os Dispatch_Recipients de um Dispatch_Job foram processados (`SENT`, `FAILED` ou `SKIPPED`), THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `COMPLETED`.
8. IF o processamento de um Dispatch_Job encontra um erro irrecuperável, THEN THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `FAILED` com o error code `JOB_FAILED`.
9. WHEN o Job_Worker processa um Dispatch_Job, THE Job_Worker SHALL utilizar exclusivamente a WhatsApp_Session e os dados do `instance_id` do próprio Dispatch_Job, sem acessar dados de outra WhatsApp_Instance.

### Requirement 11: Progresso em tempo real

**User Story:** Como Admin_User, quero acompanhar o progresso do disparo em tempo
real, para saber quantas mensagens foram enviadas e quantas faltam.

#### Acceptance Criteria

1. WHILE um Dispatch_Job está `RUNNING` ou `PAUSED`, THE WhatsApp_Module SHALL exibir total de contatos, quantidade enviada, quantidade restante, percentual concluído e uma barra de progresso.
2. WHEN o status de um Dispatch_Recipient é atualizado no servidor, THE WhatsApp_Module SHALL refletir o progresso atualizado na UI sem exigir recarregamento manual da página.
3. WHEN o Admin_User reabre a página de um Dispatch_Job em andamento, THE WhatsApp_Module SHALL exibir o progresso atual persistido no servidor.
4. WHEN o percentual concluído é exibido, THE WhatsApp_Module SHALL calcular o percentual como a razão entre Dispatch_Recipients processados e o total de Dispatch_Recipients do Dispatch_Job.
5. WHEN um Dispatch_Job atinge `COMPLETED`, THE WhatsApp_Module SHALL exibir o resumo final com totais de enviados, falhos e ignorados.

### Requirement 12: Disparo em Grupo

**User Story:** Como Admin_User, quero selecionar um ou mais grupos do WhatsApp
conectado da instância e enviar conteúdo multimídia, com agendamento e intervalo,
para alcançar grupos sem montar lista de contatos.

#### Acceptance Criteria

1. WHILE a WhatsApp_Session da Active_Instance está `CONNECTED`, THE WhatsApp_Module SHALL listar os WhatsApp_Groups disponíveis obtidos da Evolution_API para essa instância.
2. WHEN o Admin_User seleciona grupos para um Group_Dispatch, THE WhatsApp_Module SHALL permitir a seleção de um único grupo ou de múltiplos grupos da Active_Instance.
3. WHERE o Admin_User compõe o conteúdo de um Group_Dispatch, THE WhatsApp_Module SHALL aceitar qualquer combinação de texto, imagem, vídeo, áudio e documento.
4. THE WhatsApp_Module SHALL permitir definir Send_Interval para o Group_Dispatch entre envios a grupos distintos.
5. THE WhatsApp_Module SHALL permitir agendar um Group_Dispatch para uma data/hora futura.
6. WHEN um Group_Dispatch é iniciado ou agendado, THE WhatsApp_Module SHALL processá-lo de forma durável em background, aplicando as mesmas garantias de retomada e idempotência por Dispatch_Recipient do disparo em massa, dentro do `instance_id` da Active_Instance.
7. IF nenhum WhatsApp_Group é selecionado ao iniciar um Group_Dispatch, THEN THE WhatsApp_Module SHALL bloquear o início e exibir a Canonical_Message `Selecione ao menos um grupo.`

### Requirement 13: Disparos Programados

**User Story:** Como Admin_User, quero agendar disparos para data e hora específicas
com destinatários, grupos e conteúdo, para que o servidor os execute
automaticamente no momento certo.

#### Acceptance Criteria

1. WHEN o Admin_User cria um Scheduled_Dispatch, THE WhatsApp_Module SHALL exigir data, hora, destinatários ou grupos e ao menos um Content válido, e persistir o agendamento de forma durável com o `instance_id` da Active_Instance.
2. IF a data/hora informada para um Scheduled_Dispatch está no passado, THEN THE WhatsApp_Module SHALL rejeitar o agendamento e exibir a Canonical_Message `Informe uma data e hora futuras.`
3. WHEN a data/hora agendada de um Scheduled_Dispatch é alcançada, THE Job_Worker SHALL transicionar o Dispatch_Job para `QUEUED` e iniciar o processamento automaticamente sem intervenção manual, usando a WhatsApp_Session da instância do agendamento.
4. THE WhatsApp_Module SHALL listar os Scheduled_Dispatches pendentes da Active_Instance com sua data/hora, destino e Content associados.
5. WHEN o Admin_User cancela um Scheduled_Dispatch ainda não executado, THE WhatsApp_Module SHALL transicionar o Dispatch_Job para `CANCELLED` e impedir sua execução no horário agendado.
6. IF o servidor está indisponível no instante exato agendado, THEN THE Job_Worker SHALL executar o Scheduled_Dispatch na primeira varredura subsequente disponível, sem perder o agendamento.
7. WHEN um Scheduled_Dispatch é criado, alterado ou cancelado, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`.

### Requirement 14: Configuração da chave de API de IA

**User Story:** Como Admin_User, quero informar a chave de API do provedor de IA da
instância em local específico e seguro, para habilitar o atendimento automático
daquela instância.

#### Acceptance Criteria

1. WHEN o Admin_User informa a AI_Api_Key da Active_Instance, THE AI_Service SHALL armazenar a chave no Vault associada ao `instance_id`.
2. THE AI_Service SHALL nunca retornar a AI_Api_Key em texto puro em respostas, logs ou traces, exibindo apenas indicador de chave configurada/não configurada.
3. IF a AI_Api_Key informada está vazia, THEN THE AI_Service SHALL rejeitar o salvamento e exibir a Canonical_Message `Informe uma chave de API válida.`
4. WHEN o Admin_User substitui a AI_Api_Key existente, THE AI_Service SHALL sobrescrever o segredo no Vault da instância e registrar a ação em `admin_audit_logs` via `executeAdminMutation` sem gravar o valor da chave.
5. WHERE a AI_Api_Key não está configurada para a Active_Instance, THE AI_Service SHALL desabilitar a resposta automática dessa instância e indicar a pendência ao Admin_User.

### Requirement 15: Base de conhecimento do atendimento por IA

**User Story:** Como Admin_User, quero registrar uma base de conhecimento extensa
com informações, serviços e regras da empresa para a instância, para que a IA
responda com base nesse conteúdo.

#### Acceptance Criteria

1. WHEN o Admin_User salva a Knowledge_Base, THE AI_Service SHALL persistir o conteúdo de forma durável associado à configuração do AI_Service da Active_Instance (`instance_id`).
2. THE AI_Service SHALL aceitar Knowledge_Base de grande volume de texto sem truncamento silencioso, informando o limite máximo quando excedido.
3. IF o conteúdo da Knowledge_Base excede o limite máximo definido, THEN THE AI_Service SHALL rejeitar o salvamento e exibir a Canonical_Message `O conteúdo excede o limite permitido.`
4. WHEN o Admin_User atualiza a Knowledge_Base, THE AI_Service SHALL aplicar versionamento otimista via `expected_updated_at` e abortar com `STALE_VERSION` se o registro tiver sido alterado por outro Admin_User.
5. WHEN a Knowledge_Base é criada ou atualizada, THE AI_Service SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`.
6. THE AI_Service SHALL validar o conteúdo da Knowledge_Base no frontend e revalidar no backend.

### Requirement 16: Resposta automática por IA a clientes

**User Story:** Como cliente que envia mensagem ao WhatsApp conectado de uma
instância, quero receber respostas automáticas coerentes com a base da empresa,
para ser atendido sem espera.

#### Acceptance Criteria

1. WHEN uma mensagem de cliente é recebida pela WhatsApp_Session de uma WhatsApp_Instance, o AI_Service dessa instância está habilitado e a Conversation correspondente está em um modo AI-allowed (`AI_MODE` ou `RETURNED_TO_AI`), THE AI_Service SHALL interpretar a pergunta e gerar uma resposta usando a Knowledge_Base e o AI_Prompt da mesma instância como referência.
2. WHEN o AI_Service gera uma resposta, THE AI_Service SHALL enviá-la ao cliente pela Evolution_API através da WhatsApp_Session da própria instância.
3. WHERE o AI_Service está habilitado, THE AI_Service SHALL operar de forma isolada das abas de disparo, sem interferir em Dispatch_Jobs em andamento nem em outras WhatsApp_Instances.
4. IF o provedor de IA retorna erro ou indisponibilidade, THEN THE AI_Service SHALL registrar o erro com o code `AI_PROVIDER_ERROR` e não enviar resposta automática para aquela mensagem.
5. IF a mensagem recebida chega quando o AI_Service da instância está desabilitado, THEN THE AI_Service SHALL não gerar resposta automática.
6. WHEN o AI_Service processa uma mensagem recebida via webhook, THE AI_Service SHALL tratar entregas duplicadas de forma idempotente, gerando no máximo uma resposta por mensagem do cliente.
7. IF uma mensagem de cliente é recebida enquanto a Conversation correspondente está em um modo que **não** é AI-allowed (`HUMAN_MODE` ou `AI_PAUSED`), THEN THE AI_Service SHALL bloquear o envio de qualquer resposta automática para aquela Conversation, conforme o bloqueio inteligente definido no Requirement 31 (transferência híbrida IA ↔ atendente humano), mesmo que o AI_Service da instância esteja habilitado.

### Requirement 17: Extrator de Contatos

**User Story:** Como Admin_User, quero extrair os participantes dos grupos da
instância conectada e gerar uma lista de números pronta para reutilizar no Disparo
em Massa, para montar listas de contatos a partir dos meus grupos.

#### Acceptance Criteria

1. WHILE a WhatsApp_Session da Active_Instance está `CONNECTED`, THE Contact_Extractor SHALL exibir todos os WhatsApp_Groups disponíveis da instância obtidos da Evolution_API.
2. THE Contact_Extractor SHALL permitir que o Admin_User busque WhatsApp_Groups por nome.
3. THE Contact_Extractor SHALL permitir que o Admin_User selecione um único WhatsApp_Group ou múltiplos WhatsApp_Groups.
4. WHEN o Admin_User aciona "Iniciar extração" com ao menos um WhatsApp_Group selecionado, THE Contact_Extractor SHALL extrair os Contact_Numbers de todos os participantes dos WhatsApp_Groups selecionados da Active_Instance.
5. WHEN uma Contact_Extraction termina, THE Contact_Extractor SHALL gerar a lista de todos os Contact_Numbers encontrados e exibi-la na tela.
6. THE Contact_Extractor SHALL disponibilizar a Dispatch_Ready_List como string de Contact_Numbers únicos separados por vírgula, sem espaços (ex.: `5511999999999,5511888888888,5511777777777`), com ação para copiá-la facilmente e ação para exportá-la como texto, pronta para colar no módulo de Disparo em Massa.
7. WHERE o Admin_User solicita exportação em arquivo CSV, THE Contact_Extractor SHALL gerar o arquivo seguindo a convenção de CSV do projeto (BOM UTF-8, separador `;`, escape RFC 4180, quebra `\r\n`, truncamento em 10000 linhas, filename `whatsapp_<YYYYMMDD>_<HHmm>.csv`), de forma distinta da Dispatch_Ready_List separada por vírgula destinada à reutilização no disparo.
8. WHEN uma Contact_Extraction termina, THE Contact_Extractor SHALL exibir as estatísticas total de contatos encontrados, total de contatos únicos (após deduplicação) e número de grupos analisados.
9. THE Contact_Extractor SHALL oferecer a opção de remover automaticamente os Extracted_Contacts duplicados quando o mesmo Contact_Number aparece em múltiplos WhatsApp_Groups, produzindo um conjunto sem repetições.
10. THE Contact_Extractor SHALL excluir Contact_Numbers inválidos da Dispatch_Ready_List e das estatísticas de contatos únicos.
11. IF o Admin_User aciona a extração sem nenhum WhatsApp_Group selecionado, THEN THE Contact_Extractor SHALL bloquear a operação e exibir a Canonical_Message `Selecione ao menos um grupo.`
12. IF a extração de um WhatsApp_Group selecionado falha enquanto outros são extraídos com sucesso, THEN THE Contact_Extractor SHALL concluir com os participantes dos grupos bem-sucedidos, sinalizar quais grupos falharam (degradação parcial) e prosseguir sem abortar a extração inteira.
13. IF a Evolution_API está indisponível ou retorna erro em toda a Contact_Extraction, THEN THE Contact_Extractor SHALL exibir a Canonical_Message `Não foi possível concluir a operação.` sem expor detalhes internos.
14. WHEN um WhatsApp_Group selecionado possui grande volume de participantes, THE Contact_Extractor SHALL processar a extração em páginas/lotes sem perder participantes e refletir o progresso ao Admin_User.
15. THE Contact_Extractor SHALL operar exclusivamente sobre os WhatsApp_Groups e a WhatsApp_Session da Active_Instance, sem acessar grupos ou participantes de outra WhatsApp_Instance.
16. WHEN uma Contact_Extraction é executada, THE Contact_Extractor SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id` e a quantidade de grupos analisados, sem persistir conteúdo sensível em texto puro além do necessário.

### Requirement 18: Integração não disruptiva e segurança de segredos

**User Story:** Como mantenedor do FreteGO, quero que o módulo se integre à
arquitetura atual sem quebrar nada, modele múltiplas instâncias desde o início e
proteja os segredos, para manter a estabilidade e a segurança do sistema.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL reutilizar a rota `/admin/whatsapp` e o item de menu existentes, substituindo apenas o placeholder atual sem alterar outras rotas do painel.
2. THE WhatsApp_Module SHALL introduzir as alterações de schema na migration `044` de forma idempotente, modelando WhatsApp_Instances e a coluna/chave estrangeira `instance_id` em toda entidade de dados desde o início, com par `_rollback.sql` documentado.
3. THE WhatsApp_Module SHALL aplicar RLS e filtragem por `instance_id` em todas as tabelas e RPCs do módulo, de forma que o acesso cruzado entre WhatsApp_Instances seja impossível no servidor.
4. THE WhatsApp_Module SHALL expor toda lógica de mutação por RPCs `SECURITY DEFINER` com `SET search_path = public`, `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`.
5. WHEN qualquer erro de duplicidade, acesso cruzado entre instâncias ou falha sensível ocorre, THE WhatsApp_Module SHALL responder com Canonical_Message anti-enumeração, sem revelar a existência ou ausência de registros ou instâncias específicas.
6. THE WhatsApp_Module SHALL emitir mensagens user-facing em pt-BR e usar action/error codes em inglês.
7. THE WhatsApp_Module SHALL armazenar Evolution_Api_Key e AI_Api_Key exclusivamente no Vault, escopadas por `instance_id`, sem persisti-las em colunas de tabela nem retorná-las em respostas.

### Requirement 19: Dashboard da instância

**User Story:** Como Admin_User, quero um dashboard da instância selecionada com os
indicadores operacionais do dia, para acompanhar rapidamente a saúde dos disparos
daquela instância.

#### Acceptance Criteria

1. WHILE uma Active_Instance está selecionada, THE Instance_Dashboard SHALL exibir os contadores status da conexão, mensagens enviadas hoje, disparos em andamento, mensagens agendadas, disparos concluídos, mensagens com erro, total na fila atual, respostas recebidas e atendimentos ativos, todos escopados ao `instance_id` da Active_Instance.
2. WHEN o Instance_Dashboard calcula mensagens enviadas hoje, THE Instance_Dashboard SHALL contar exclusivamente os Dispatch_Recipients com status `SENT` da Active_Instance cuja data de envio pertence ao dia corrente.
3. WHEN o Instance_Dashboard calcula mensagens com erro, THE Instance_Dashboard SHALL contar os Dispatch_Recipients com status `FAILED` da Active_Instance.
4. WHEN o Instance_Dashboard calcula a fila atual, THE Instance_Dashboard SHALL contar os Dispatch_Jobs da Active_Instance nos estados `QUEUED` e `RUNNING`.
5. WHEN o Instance_Dashboard calcula mensagens agendadas, THE Instance_Dashboard SHALL contar os Scheduled_Dispatches pendentes da Active_Instance com data/hora futura.
6. WHEN o status de um Dispatch_Recipient, Dispatch_Job ou WhatsApp_Session da Active_Instance é atualizado no servidor, THE Instance_Dashboard SHALL refletir os contadores atualizados sem exigir recarregamento manual da página.
7. WHEN o Admin_User aciona a atualização manual do Instance_Dashboard, THE Instance_Dashboard SHALL recarregar os contadores a partir do estado persistido no servidor.
8. THE Instance_Dashboard SHALL derivar todos os contadores exclusivamente de dados do `instance_id` da Active_Instance, sem agregar dados de outra WhatsApp_Instance.
9. WHEN as RPCs de leitura do Instance_Dashboard são invocadas, THE Instance_Dashboard SHALL revalidar a permissão `SETTINGS_VIEW` no servidor antes de retornar qualquer contador.
10. WHEN o Instance_Dashboard calcula disparos em andamento, THE Instance_Dashboard SHALL contar os Dispatch_Jobs da Active_Instance no estado `RUNNING`.
11. WHEN o Instance_Dashboard calcula disparos concluídos, THE Instance_Dashboard SHALL contar os Dispatch_Jobs da Active_Instance no estado `COMPLETED` cuja data de conclusão pertence ao dia corrente.
12. WHEN o Instance_Dashboard calcula respostas recebidas (Replies_Received), THE Instance_Dashboard SHALL contar as mensagens inbound de clientes recebidas pela WhatsApp_Session da Active_Instance cuja data de recebimento pertence ao dia corrente, escopadas ao `instance_id`.
13. WHEN o Instance_Dashboard calcula atendimentos ativos (Active_Conversations), THE Instance_Dashboard SHALL contar as Conversations da Active_Instance em estado ativo de atendimento (Conversation_Mode `AI_MODE`, `HUMAN_MODE`, `AI_PAUSED` ou `RETURNED_TO_AI`), seja por IA ou por humano, escopadas ao `instance_id`.

### Requirement 20: Histórico completo de disparos

**User Story:** Como Admin_User, quero um histórico de todos os disparos já
executados na instância, para consultar campanhas passadas, duplicá-las ou
reenviá-las.

#### Acceptance Criteria

1. WHEN um Dispatch_Job da Active_Instance atinge um estado terminal (`COMPLETED`, `CANCELLED` ou `FAILED`), THE WhatsApp_Module SHALL preservar o Dispatch_Job de forma durável no Campaign_History da instância, sem exclusão automática.
2. THE WhatsApp_Module SHALL listar no Campaign_History todos os Dispatch_Jobs já executados da Active_Instance com data e hora de execução, quantidade de contatos (total de destinatários), conteúdos utilizados, estado final (Status), tempo de execução, total enviado e total com erro.
3. WHEN o Admin_User abre um item do Campaign_History, THE WhatsApp_Module SHALL exibir os detalhes do disparo (Contents, destinatários, configurações e resultados) escopados à Active_Instance.
4. WHEN o Admin_User aciona "Duplicar" em um item do Campaign_History, THE WhatsApp_Module SHALL criar um novo Dispatch_Job no status `DRAFT` na Active_Instance copiando Contents, destinatários e configurações da campanha original, sem iniciar o envio.
5. WHEN o Admin_User aciona "Reenviar" em um item do Campaign_History, THE WhatsApp_Module SHALL criar um novo Dispatch_Job na Active_Instance a partir da campanha original e transicioná-lo para `QUEUED` para reprocessamento, preservando intacto o Dispatch_Job histórico original.
6. THE WhatsApp_Module SHALL exibir e operar o Campaign_History exclusivamente sobre Dispatch_Jobs do `instance_id` da Active_Instance, sem expor campanhas de outra WhatsApp_Instance.
7. WHEN o Admin_User duplica ou reenvia uma campanha, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id` e o identificador da campanha de origem.
8. WHEN as RPCs de leitura do Campaign_History são invocadas, THE WhatsApp_Module SHALL revalidar a permissão `SETTINGS_VIEW` no servidor antes de retornar qualquer registro.
9. WHEN o Admin_User abre um item do Campaign_History, THE WhatsApp_Module SHALL exibir, além dos Contents e destinatários, a data, a hora, a quantidade de contatos, os conteúdos utilizados, o Status final e o tempo de execução (Execution_Duration) do disparo.
10. WHEN o WhatsApp_Module calcula o tempo de execução de um Dispatch_Job concluído, THE WhatsApp_Module SHALL computá-lo como o intervalo entre o início do processamento e o instante em que o Dispatch_Job atingiu um estado terminal (`COMPLETED`, `CANCELLED` ou `FAILED`).
11. WHEN o Admin_User aciona "Reutilizar/Editar como nova campanha" em um item do Campaign_History, THE WhatsApp_Module SHALL criar um novo Dispatch_Job no status `DRAFT` na Active_Instance copiando Contents, destinatários e configurações da campanha original para edição, sem iniciar o envio e sem alterar o Dispatch_Job histórico original.
12. WHEN o Admin_User reutiliza/edita uma campanha como nova, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id` e o identificador da campanha de origem.

### Requirement 21: Rascunhos de campanha

**User Story:** Como Admin_User, quero salvar uma campanha como rascunho sem iniciar
o envio, para continuar a configuração depois e iniciá-la quando quiser.

#### Acceptance Criteria

1. WHEN o Admin_User salva uma campanha sem iniciar o envio, THE WhatsApp_Module SHALL persistir o Dispatch_Job no status `DRAFT` associado ao `instance_id` da Active_Instance, sem habilitar o Job_Worker.
2. THE WhatsApp_Module SHALL listar os Drafts da Active_Instance com data de criação, data de última edição e resumo de Contents e destinatários.
3. WHEN o Admin_User edita um Draft, THE WhatsApp_Module SHALL permitir alterar Contents, Contact_List, Distribution_Mode, Send_Interval e Execution_Quota, mantendo o status `DRAFT`.
4. WHEN o Admin_User edita um Draft, THE WhatsApp_Module SHALL aplicar versionamento otimista via `expected_updated_at` e abortar com `STALE_VERSION` se o registro tiver sido alterado por outro Admin_User.
5. WHEN o Admin_User aciona "Iniciar" em um Draft válido, THE WhatsApp_Module SHALL revalidar a Contact_List e os Contents no backend e transicionar o Dispatch_Job de `DRAFT` para `QUEUED`.
6. IF o Admin_User aciona "Iniciar" em um Draft cuja Contact_List válida está vazia ou cujos Contents são inválidos, THEN THE WhatsApp_Module SHALL bloquear o início e exibir a Canonical_Message correspondente (`Informe ao menos um contato válido.` ou a mensagem de Content inválido), mantendo o status `DRAFT`.
7. WHEN um Draft é criado, editado ou iniciado, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`.
8. THE WhatsApp_Module SHALL operar os Drafts exclusivamente sobre o `instance_id` da Active_Instance, sem expor rascunhos de outra WhatsApp_Instance.

### Requirement 22: Fila de execução

**User Story:** Como Admin_User, quero visualizar a fila de execução da instância
organizada por estado, para entender o que está aguardando, em execução, pausado,
agendado, concluído, cancelado ou com erro.

#### Acceptance Criteria

1. THE Execution_Queue SHALL exibir os Dispatch_Jobs da Active_Instance agrupados pelos estados Aguardando (`QUEUED` ainda não em execução), Em execução (`RUNNING`), Pausada (`PAUSED`), Agendada (Scheduled_Dispatches), Concluída (`COMPLETED`), Cancelada (`CANCELLED`) e Erro (`FAILED`).
2. WHEN a Execution_Queue exibe um Dispatch_Job, THE Execution_Queue SHALL apresentar seu estado atual, progresso (enviados/total) e data/hora relevante (início, agendamento ou conclusão).
3. WHEN o estado de um Dispatch_Job da Active_Instance muda no servidor, THE Execution_Queue SHALL refletir o item no grupo de estado correspondente sem exigir recarregamento manual da página.
4. THE Execution_Queue SHALL listar exclusivamente Dispatch_Jobs do `instance_id` da Active_Instance, sem exibir itens de outra WhatsApp_Instance.
5. WHERE o Admin_User possui a permissão `SETTINGS_EDIT`, THE Execution_Queue SHALL disponibilizar, em cada item, as ações de controle válidas para o estado atual (pausar, continuar, cancelar) conforme as transições definidas no Requirement 9.
6. WHEN as RPCs de leitura da Execution_Queue são invocadas, THE Execution_Queue SHALL revalidar a permissão `SETTINGS_VIEW` no servidor antes de retornar qualquer item.
7. THE Execution_Queue SHALL exibir o grupo Erro (`FAILED`) contendo os Dispatch_Jobs da Active_Instance que terminaram em falha, permitindo ao Admin_User identificar disparos com erro a partir da própria fila.
8. THE Execution_Queue SHALL mapear os rótulos exibidos ao Admin_User para os estados de Dispatch_Job/Scheduled_Dispatch da seguinte forma: Aguardando→`QUEUED`, Em execução→`RUNNING`, Pausada→`PAUSED`, Agendada→Scheduled_Dispatch, Concluída→`COMPLETED`, Cancelada→`CANCELLED`, Erro→`FAILED`.

### Requirement 23: Logs de erro e reenvio apenas dos que falharam

**User Story:** Como Admin_User, quero ver quais contatos falharam em um disparo e o
motivo, e reenviar apenas os que falharam, para corrigir entregas sem reenviar para
quem já recebeu.

#### Acceptance Criteria

1. WHEN um Dispatch_Recipient é marcado como `FAILED`, THE WhatsApp_Module SHALL persistir o motivo da falha (`failure_reason`) de forma durável associado ao Dispatch_Recipient e ao `instance_id`.
2. THE Error_Log SHALL exibir, para um Dispatch_Job da Active_Instance, a relação dos Dispatch_Recipients com status `FAILED` com o respectivo Contact_Number e `failure_reason`.
3. WHEN o Admin_User aciona "Reenviar apenas os que falharam" em um Dispatch_Job, THE WhatsApp_Module SHALL criar um novo Dispatch_Job (Failed_Resend) na Active_Instance contendo somente os Dispatch_Recipients com status `FAILED` do disparo de origem e transicioná-lo para `QUEUED`.
4. WHEN um Failed_Resend é processado, THE Job_Worker SHALL não reenviar mensagens aos Dispatch_Recipients que estavam com status `SENT` no disparo de origem, preservando a idempotência por Dispatch_Recipient.
5. IF o Admin_User aciona "Reenviar apenas os que falharam" em um Dispatch_Job sem nenhum Dispatch_Recipient com status `FAILED`, THEN THE WhatsApp_Module SHALL retornar `{ skipped: true, reason: 'NO_FAILED_RECIPIENTS' }` sem criar novo Dispatch_Job e registrar o log `_SKIPPED`.
6. WHEN um Failed_Resend é criado, THE WhatsApp_Module SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`, o identificador do disparo de origem e a quantidade de destinatários reenfileirados.
7. THE Error_Log e o Failed_Resend SHALL operar exclusivamente sobre Dispatch_Recipients do `instance_id` da Active_Instance, sem acessar destinatários de outra WhatsApp_Instance.
8. THE WhatsApp_Module SHALL exibir o `failure_reason` em pt-BR sem expor segredos, tokens ou detalhes internos sensíveis da Evolution_API.

### Requirement 24: Importação e exportação CSV

**User Story:** Como Admin_User, quero importar contatos de um arquivo CSV e exportar
contatos e resultados de disparo em CSV, para integrar listas externas e analisar os
resultados fora do sistema.

#### Acceptance Criteria

1. WHEN o Admin_User importa um arquivo CSV de contatos para a Active_Instance, THE WhatsApp_Module SHALL ler os Contact_Numbers e as colunas de Recipient_Data mapeadas e adicioná-los à Contact_List da Active_Instance.
2. WHEN o CSV_Import processa cada linha, THE WhatsApp_Module SHALL normalizar e validar o Contact_Number aplicando as mesmas regras do Requirement 5 (normalização, formato E.164, deduplicação).
3. IF uma linha do CSV contém um Contact_Number inválido, THEN THE WhatsApp_Module SHALL reportar a linha como inválida ao Admin_User (número da linha e motivo) e excluí-la da Contact_List, sem descartá-la silenciosamente.
4. IF o arquivo importado não é um CSV válido ou não contém a coluna de Contact_Number, THEN THE WhatsApp_Module SHALL rejeitar a importação e exibir a Canonical_Message `Não foi possível importar o arquivo.`
5. WHEN o CSV_Import conclui, THE WhatsApp_Module SHALL exibir o total de linhas lidas, total importado com sucesso e total de linhas inválidas.
6. WHEN o Admin_User exporta contatos ou resultados de disparo, THE CSV_Export SHALL gerar o arquivo seguindo a convenção de CSV do projeto: BOM UTF-8 (`\uFEFF`), separador `;`, escape RFC 4180 (aspas duplas em campos com `"`, `;`, `\n`, `\r`, com aspa interna duplicada), quebra de linha `\r\n`.
7. WHEN o conteúdo exportado excede 10000 linhas (incluindo cabeçalho), THE CSV_Export SHALL truncar em 10000 linhas e registrar `truncated: true` no audit.
8. WHEN o CSV_Export gera o arquivo, THE CSV_Export SHALL nomeá-lo no formato `whatsapp_<YYYYMMDD>_<HHmm>.csv`.
9. THE WhatsApp_Module SHALL validar o CSV_Import no frontend e revalidar no backend antes de persistir qualquer Contact_Number na Contact_List.
10. THE CSV_Import e o CSV_Export SHALL operar exclusivamente sobre dados do `instance_id` da Active_Instance, sem importar para nem exportar dados de outra WhatsApp_Instance.

### Requirement 25: Personalização de mensagens por variáveis

**User Story:** Como Admin_User, quero usar variáveis de template no texto da
mensagem para que cada contato receba uma mensagem personalizada com seu nome,
telefone e empresa.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL aceitar, no texto de um Content, as Message_Variables `{{nome}}`, `{{telefone}}` e `{{empresa}}`.
2. WHEN o Job_Worker prepara o envio a um Dispatch_Recipient, THE WhatsApp_Module SHALL gerar a Rendered_Message substituindo cada Message_Variable pelo valor correspondente do Recipient_Data daquele Dispatch_Recipient, resolvido no momento do envio.
3. THE WhatsApp_Module SHALL obter o Recipient_Data (`nome`, `empresa` e demais campos) a partir das colunas do CSV_Import mapeadas para as Message_Variables, e o `telefone` a partir do Contact_Number do Dispatch_Recipient.
4. IF uma Message_Variable referenciada não possui valor para o Dispatch_Recipient (ausente ou vazio), THEN THE WhatsApp_Module SHALL substituí-la por string vazia por padrão, ou pelo valor de fallback configurado para aquela variável quando definido, nunca entregando o marcador literal (`{{nome}}`) na Rendered_Message.
5. IF o texto contém uma variável desconhecida (não pertencente ao conjunto suportado), THEN THE WhatsApp_Module SHALL removê-la da Rendered_Message substituindo-a por string vazia, sem entregar o marcador literal e sem abortar o envio.
6. WHEN o Admin_User edita o texto de um Content, THE WhatsApp_Module SHALL exibir uma pré-visualização da Rendered_Message com dados de exemplo, indicando quais Message_Variables foram reconhecidas.
7. THE WhatsApp_Module SHALL persistir o texto do Content com as Message_Variables não resolvidas (template original) e resolver as variáveis por Dispatch_Recipient apenas no momento do envio, sem alterar o template armazenado.
8. THE WhatsApp_Module SHALL resolver as Message_Variables exclusivamente com Recipient_Data do `instance_id` da Active_Instance, sem acessar dados de destinatários de outra WhatsApp_Instance.

### Requirement 26: Configuração de IA isolada por instância (chave, prompt e base)

**User Story:** Como Admin_User, quero que cada instância tenha sua própria
configuração de IA — chave de API, prompt e base de conhecimento — para que o
atendimento de uma instância seja independente das demais.

#### Acceptance Criteria

1. THE AI_Service SHALL manter, para cada WhatsApp_Instance, uma configuração própria composta por AI_Api_Key, AI_Prompt e Knowledge_Base, todas escopadas pelo `instance_id`.
2. WHEN o Admin_User salva o AI_Prompt da Active_Instance, THE AI_Service SHALL persistir o AI_Prompt de forma durável associado à configuração do AI_Service do `instance_id` da Active_Instance.
3. IF o AI_Prompt informado está vazio, THEN THE AI_Service SHALL rejeitar o salvamento e exibir a Canonical_Message `Informe um prompt válido.`
4. WHEN o AI_Service gera uma resposta automática, THE AI_Service SHALL usar o AI_Prompt, a AI_Api_Key e a Knowledge_Base da mesma WhatsApp_Instance que recebeu a mensagem, sem utilizar configuração de outra instância.
5. THE AI_Service SHALL garantir que AI_Api_Key, AI_Prompt e Knowledge_Base de uma WhatsApp_Instance nunca sejam compartilhados, mesclados, lidos ou utilizados por outra WhatsApp_Instance (invariante de isolamento da configuração de IA).
6. WHEN o Admin_User atualiza o AI_Prompt, THE AI_Service SHALL aplicar versionamento otimista via `expected_updated_at` e abortar com `STALE_VERSION` se o registro tiver sido alterado por outro Admin_User.
7. WHEN o AI_Prompt é criado ou atualizado, THE AI_Service SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`.
8. THE AI_Service SHALL validar o AI_Prompt no frontend e revalidar no backend.

### Requirement 27: Persistência e recuperação após reinício do servidor

**User Story:** Como Admin_User, quero que agendamentos e filas pendentes sobrevivam
a um reinício do servidor, para que nenhum disparo programado seja perdido e o
processamento retome de onde parou.

#### Acceptance Criteria

1. WHEN o servidor reinicia, THE Recovery_Process SHALL identificar todos os Scheduled_Dispatches pendentes e os Dispatch_Jobs nos estados `QUEUED`, `RUNNING` e `PAUSED` a partir do estado persistido no banco de dados.
2. WHEN o Recovery_Process restaura um Dispatch_Job `RUNNING` ou `QUEUED`, THE Job_Worker SHALL retomar o processamento a partir do próximo Dispatch_Recipient `PENDING`, sem reenviar mensagens já marcadas como `SENT` (idempotência por Dispatch_Recipient).
3. WHEN o Recovery_Process restaura um Dispatch_Job `PAUSED`, THE WhatsApp_Module SHALL mantê-lo em `PAUSED` aguardando ação do Admin_User, preservando o progresso já realizado.
4. WHEN o Recovery_Process restaura um Scheduled_Dispatch cuja data/hora já passou durante a indisponibilidade, THE Job_Worker SHALL executá-lo na primeira varredura subsequente disponível, sem perder o agendamento.
5. THE Recovery_Process SHALL garantir que nenhum Scheduled_Dispatch pendente seja perdido em decorrência de um reinício do servidor.
6. IF o estado persistido de um Dispatch_Job está parcial ou inconsistente após o reinício, THEN THE Recovery_Process SHALL marcar esse Dispatch_Job com o error code `JOB_FAILED`, registrar o motivo e prosseguir com a recuperação dos demais Dispatch_Jobs, sem abortar todo o Recovery_Process.
7. THE Recovery_Process SHALL retomar cada Dispatch_Job e Scheduled_Dispatch usando exclusivamente a WhatsApp_Session e os dados do `instance_id` do próprio registro, sem misturar dados entre WhatsApp_Instances.

### Requirement 28: Painel de estatísticas por disparo

**User Story:** Como Admin_User, quero um painel de estatísticas por disparo com
totais e tempo estimado de conclusão, para acompanhar o andamento e prever quando o
disparo terminará.

#### Acceptance Criteria

1. WHILE um Dispatch_Job da Active_Instance está `QUEUED`, `RUNNING` ou `PAUSED`, THE WhatsApp_Module SHALL exibir as Dispatch_Statistics: total enviado, total pendente, total concluído, total com erro e Estimated_Completion_Time.
2. WHEN o WhatsApp_Module calcula total enviado, THE WhatsApp_Module SHALL contar os Dispatch_Recipients com status `SENT`; total com erro como os `FAILED`; total pendente como os `PENDING`; e total concluído como a soma de `SENT`, `FAILED` e `SKIPPED`.
3. WHEN o WhatsApp_Module calcula o Estimated_Completion_Time, THE WhatsApp_Module SHALL computá-lo como a quantidade de Dispatch_Recipients `PENDING` multiplicada pelo Send_Interval do Dispatch_Job.
4. IF não há Dispatch_Recipients `PENDING` em um Dispatch_Job, THEN THE WhatsApp_Module SHALL apresentar o Estimated_Completion_Time como zero.
5. WHEN o status de um Dispatch_Recipient é atualizado no servidor, THE WhatsApp_Module SHALL recalcular e refletir as Dispatch_Statistics sem exigir recarregamento manual da página.
6. THE WhatsApp_Module SHALL derivar as Dispatch_Statistics exclusivamente de Dispatch_Recipients do `instance_id` da Active_Instance, sem agregar dados de outra WhatsApp_Instance.

### Requirement 29: Arquitetura de instâncias ilimitadas e data-driven

**User Story:** Como mantenedor do FreteGO, quero que o módulo suporte um número
ilimitado de instâncias por configuração, para escalar de 5 para 10, 20 ou mais sem
reescrever a arquitetura.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL determinar a quantidade de WhatsApp_Instances exibidas e habilitadas a partir da configuração Max_Instances, com valor inicial 5, lida de configuração/linhas de instância (data-driven).
2. THE WhatsApp_Module SHALL renderizar o Instance_Panel iterando sobre as WhatsApp_Instances configuradas, sem codificar a quantidade de instâncias de forma fixa na UI.
3. WHEN o valor de Max_Instances é aumentado para 10, 20 ou mais, THE WhatsApp_Module SHALL passar a operar com o novo número de WhatsApp_Instances sem qualquer alteração de schema, RPC, política RLS ou código do Job_Worker (mudança apenas de configuração/dados).
4. THE WhatsApp_Module SHALL chavear toda entidade de dados e toda RPC exclusivamente por `instance_id`, sem qualquer lógica que dependa de um número fixo de instâncias.
5. THE WhatsApp_Module SHALL garantir que nenhuma lógica de schema, RPC, RLS, Job_Worker ou UI contenha o número 5 (ou qualquer outro limite) codificado de forma fixa para a contagem de instâncias.
6. THE WhatsApp_Module SHALL aplicar RLS e filtragem por `instance_id` de forma uniforme a qualquer WhatsApp_Instance, independentemente da quantidade total configurada, mantendo o isolamento total entre instâncias.
7. WHERE uma WhatsApp_Instance existe como linha de dados identificada por `instance_id`, THE WhatsApp_Module SHALL tratá-la igualmente às demais, sem instância privilegiada ou tratada como caso especial pelo seu índice.

### Requirement 30: Central de Conversas (Conversation Inbox)

**User Story:** Como Admin_User, quero uma Central de Conversas dentro da aba
Atendimento por IA que reúna todas as conversas do WhatsApp da instância em um só
lugar, para acompanhar os atendimentos feitos automaticamente e assumir qualquer
conversa quando necessário.

#### Acceptance Criteria

1. WHILE uma Active_Instance está selecionada, THE Conversation_Inbox SHALL exibir, dentro da aba Atendimento por IA, todas as Conversations da Active_Instance em um só lugar, escopadas ao `instance_id`.
2. WHEN o Conversation_Inbox lista uma Conversation, THE Conversation_Inbox SHALL exibir o identificador do contato (Contact_Number), a prévia da última mensagem, o horário da última mensagem e o Conversation_Mode atual com seu indicador visual (🤖 `AI_MODE`, 👤 `HUMAN_MODE`, ⏸ `AI_PAUSED`, 🔄 `RETURNED_TO_AI`).
3. WHEN o Admin_User abre uma Conversation no Conversation_Inbox, THE Conversation_Inbox SHALL exibir o histórico completo de mensagens recebidas e enviadas daquele contato, em ordem cronológica.
4. WHERE o Admin_User possui a permissão `SETTINGS_EDIT`, THE Conversation_Inbox SHALL disponibilizar a ação "Assumir Atendimento" (Human_Takeover) em qualquer Conversation, conforme o Requirement 31.
5. WHEN uma nova mensagem inbound é recebida ou o Conversation_Mode de uma Conversation muda no servidor, THE Conversation_Inbox SHALL refletir a atualização (nova mensagem, prévia, horário e indicador de status) sem exigir recarregamento manual da página.
6. THE Conversation_Inbox SHALL listar e abrir exclusivamente Conversations do `instance_id` da Active_Instance, sem exibir nem permitir abrir Conversations de outra WhatsApp_Instance.
7. WHEN as RPCs de leitura do Conversation_Inbox são invocadas, THE Conversation_Inbox SHALL revalidar a permissão `SETTINGS_VIEW` no servidor antes de retornar qualquer Conversation ou mensagem.
8. IF uma RPC do Conversation_Inbox é invocada com um identificador de Conversation que não pertence ao `instance_id` da Active_Instance ou que não existe, THEN THE Conversation_Inbox SHALL responder com a Canonical_Message anti-enumeração `Não foi possível concluir a operação.` sem revelar a existência da Conversation.
9. WHEN o Admin_User assume uma Conversation pelo Conversation_Inbox, THE Conversation_Inbox SHALL registrar a ação em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id` e o identificador da Conversation.

### Requirement 31: Transferência híbrida IA ↔ atendente humano por conversa

**User Story:** Como Admin_User, quero que cada conversa tenha um único responsável
por vez — a IA ou um atendente humano — com transferência automática quando a IA não
souber responder e tomada manual de atendimento quando eu quiser, para que nenhum
cliente receba respostas duplicadas ou conflitantes e o histórico seja preservado.

#### Acceptance Criteria

1. THE WhatsApp_Module SHALL manter, para cada Conversation, um campo Conversation_Mode com domínio fechado `AI_MODE`, `HUMAN_MODE`, `AI_PAUSED` e `RETURNED_TO_AI`, escopado pelo `instance_id`.
2. FOR ALL Conversations, THE WhatsApp_Module SHALL garantir que exista exatamente um responsável por vez — a IA ou um atendente humano, nunca os dois simultaneamente — não permitindo respostas automáticas da IA e respostas humanas concorrentes na mesma Conversation (invariante de responsável único).
3. WHEN uma nova Conversation é criada a partir da primeira mensagem de um contato, THE WhatsApp_Module SHALL defini-la com Conversation_Mode `AI_MODE` por padrão, no qual apenas a IA envia mensagens automáticas usando a Knowledge_Base e o AI_Prompt da instância.
4. WHEN a IA detecta que não há resposta adequada ou que o tema exige atendimento humano, THE AI_Service SHALL enviar a AI_Handoff_Message ao cliente e, em seguida, transicionar automaticamente o Conversation_Mode dessa Conversation para `HUMAN_MODE`, travando a IA para aquela Conversation.
5. WHILE uma Conversation está em `HUMAN_MODE` ou `AI_PAUSED`, THE AI_Service SHALL não enviar nenhuma resposta automática para aquela Conversation, mesmo que o cliente envie novas mensagens, até que a Conversation seja devolvida a um modo AI-allowed (bloqueio inteligente, garantido server-side).
6. WHEN o Admin_User aciona "Assumir Atendimento" (Human_Takeover) em uma Conversation, THE WhatsApp_Module SHALL transicionar o Conversation_Mode para `HUMAN_MODE` imediatamente, desabilitando qualquer resposta automática da IA para aquela Conversation, mesmo que a IA estivesse respondendo corretamente.
7. WHEN o Admin_User aciona "Retornar para IA" (Return_To_AI) em uma Conversation sob responsabilidade humana, THE WhatsApp_Module SHALL transicionar o Conversation_Mode para `RETURNED_TO_AI`/`AI_MODE`, permitindo que a IA volte a responder novas mensagens daquele contato.
8. WHEN a IA retoma o atendimento de uma Conversation devolvida, THE AI_Service SHALL utilizar o histórico completo já preservado da Conversation como contexto, dando continuidade de forma coerente sem perder o histórico.
9. THE WhatsApp_Module SHALL exibir, em cada Conversation, um indicador visual do Conversation_Mode atual (🤖 `AI_MODE`, 👤 `HUMAN_MODE`, ⏸ `AI_PAUSED`, 🔄 `RETURNED_TO_AI`), de modo que o operador identifique imediatamente quem é o responsável.
10. WHEN o AI_Service recebe uma mensagem inbound via webhook, THE AI_Service SHALL verificar o Conversation_Mode antes de qualquer envio e, IF o modo não for AI-allowed (`AI_MODE` ou `RETURNED_TO_AI`), THEN THE AI_Service SHALL recusar o envio de resposta automática (guarda server-side aplicável ao caminho de auto-resposta).
11. FOR ALL mensagens inbound recebidas enquanto o Conversation_Mode é `HUMAN_MODE` ou `AI_PAUSED`, THE AI_Service SHALL não enviar nenhuma resposta automática (propriedade testável do invariante de responsável único).
12. WHEN o AI_Service processa entregas duplicadas do mesmo evento de webhook, THE AI_Service SHALL tratá-las de forma idempotente, respeitando o Conversation_Mode corrente e gerando no máximo uma resposta automática por mensagem do cliente apenas quando o modo for AI-allowed.
13. WHEN uma transição de Conversation_Mode ocorre (automática por handoff da IA ou manual por Human_Takeover/Return_To_AI), THE WhatsApp_Module SHALL registrar a transição em `admin_audit_logs` via `executeAdminMutation`, incluindo o `instance_id`, o identificador da Conversation, o modo anterior e o novo modo.
14. WHEN o Admin_User altera manualmente o Conversation_Mode (Human_Takeover ou Return_To_AI), THE WhatsApp_Module SHALL aplicar versionamento otimista via `expected_updated_at` e abortar com `STALE_VERSION` se a Conversation tiver sido alterada por outro Admin_User.
15. IF o Admin_User aciona uma transição de Conversation_Mode já aplicada (ex.: assumir uma Conversation já em `HUMAN_MODE`), THEN THE WhatsApp_Module SHALL retornar `{ skipped: true, reason }` sem efeito adicional e registrar o log `_SKIPPED`.
16. WHERE uma ação de mudar o Conversation_Mode (Assumir Atendimento ou Retornar para IA) é exposta na UI, THE WhatsApp_Module SHALL exibi-la somente quando o Admin_User possuir a permissão `SETTINGS_EDIT`, e revalidar `SETTINGS_EDIT` no servidor antes de aplicar a transição.
17. THE WhatsApp_Module SHALL aplicar a lógica de Conversation_Mode a cada Conversation individualmente, de forma que uma transição em uma Conversation não altere o modo de nenhuma outra Conversation.
18. FOR ALL pares de WhatsApp_Instances distintas, THE WhatsApp_Module SHALL garantir que uma Conversation pertença a exatamente um `instance_id` e que mudanças de Conversation_Mode nunca leiam, alterem ou afetem Conversations de outra WhatsApp_Instance (invariante de isolamento por instância).
19. THE WhatsApp_Module SHALL preservar de forma durável o histórico completo de cada Conversation em todas as transições de Conversation_Mode, sem apagar mensagens ao alternar entre IA e atendimento humano.
20. THE WhatsApp_Module SHALL validar as transições de Conversation_Mode no frontend e revalidar no backend, rejeitando transições para modos fora do domínio fechado com o error code `INVALID_CONVERSATION_MODE`.

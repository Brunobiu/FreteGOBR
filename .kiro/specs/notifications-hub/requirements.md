# Requirements Document

## Introduction

O **Notifications_Hub** unifica todas as comunicações assíncronas do FreteGO em
um único modal lateral com sidebar de quatro categorias (Anúncios, Mensagens,
Tickets, Atividades). O modal já existe (`NotificationsModal.tsx`) e atende
hoje somente o motorista. Esta spec amplia o ecossistema para:

1. **Liberar o modal para o embarcador** (mesma UX, sem mapa/raio/diesel).
2. **Habilitar broadcast de comunicado** pelo admin com targeting por papel
   (motoristas, embarcadores, empresas-futuro), entrando na aba Anúncios.
3. **Adicionar chat de suporte** (usuário ↔ admin) que aparece na aba Mensagens
   ao lado do chat de frete já existente.
4. **Adicionar tickets de suporte** abríveis por usuário logado (motorista ou
   embarcador) **e** por visitante anônimo na landing page.
5. **Catch-all em Atividades** para likes em frete, avaliações, alertas de plano
   e demais eventos de sistema.

A spec respeita as convenções do FreteGO:
gating em duas camadas (UI + RLS/RPC), audit-by-construction via
`executeAdminMutation`, RBAC server-side via `is_admin_with_permission`,
master admin `Nexus_Vortex99` imutável, migrations idempotentes.

Phase 1 entrega o caminho feliz mínimo: envio imediato de broadcast (sem
rascunho, sem agendamento, sem expiração), tickets sem anexo, resposta a ticket
público por email via Edge Function. Rascunho/agendamento/expiração e anexos
ficam para Phase 2.

## Glossary

- **Notifications_Hub**: Sistema agregador que entrega ao usuário todos os
  eventos via tabela `notifications` e renderiza em `NotificationsModal`.
- **Notifications_Modal**: Componente `src/components/NotificationsModal.tsx`
  com sidebar de 4 categorias (Anúncios, Mensagens, Tickets, Atividades).
- **AppHeader**: Componente `src/components/AppHeader.tsx`, header compartilhado
  pelas páginas autenticadas. Já contém o ícone do sino e abre o
  Notifications_Modal.
- **Broadcast_Announcement**: Comunicado/notificação criado pelo admin com
  alvo definido por papel (motorista, embarcador, empresa). Persiste em
  `broadcast_announcements`. Não confundir com a feature `anuncios` (banners
  do carrossel, migration 038).
- **Target_Audience**: Subconjunto não-vazio de `{motorista, embarcador,
  empresa}` que define quais usuários recebem o broadcast.
- **Fan_Out_Broadcast**: Operação que, dado um `Broadcast_Announcement`, cria
  uma linha em `notifications` por usuário ativo dentro do `Target_Audience`.
- **Support_Ticket**: Solicitação de suporte armazenada em `support_tickets`,
  com mensagens em `support_ticket_messages`.
- **Public_Support_Ticket**: `Support_Ticket` cujo `user_id IS NULL` e que
  carrega `guest_name` e `guest_email` capturados em formulário público.
- **Support_Conversation**: Conversa de chat persistente entre um usuário
  autenticado e o pool de admins, persistida em `chat_conversations` /
  `chat_messages` (tabelas já existentes via 008).
- **Frete_Conversation**: Conversa de chat motorista ↔ embarcador atrelada a
  um frete, persistida em `conversations` / `messages` (tabelas existentes
  via 008/023/024). Não é alterada por esta spec.
- **Notification_Type_Prefix**: Convenção de prefixo no campo
  `notifications.type` que determina em qual aba do Notifications_Modal o item
  aparece. Ver Requirement 3.
- **Sound_Preference**: Preferência local (LocalStorage) de tocar/silenciar
  som ao receber notificação realtime.
- **Visitor**: Usuário anônimo (sem login) na landing page que pode abrir um
  Public_Support_Ticket.
- **Recipient_User**: Usuário cuja `notifications.user_id` corresponde ao
  registro entregue.
- **STALE_VERSION**: Erro padrão do projeto quando `expected_updated_at` não
  bate com `updated_at` atual da linha.

## Requirements

### Requirement 1: Modal de notificações compartilhado entre motorista e embarcador

**User Story:** Como motorista ou embarcador autenticado, quero abrir o mesmo
modal de notificações do header e ver minhas mensagens organizadas em quatro
abas (Anúncios, Mensagens, Tickets, Atividades), para que eu acompanhe tudo
sem trocar de tela.

#### Acceptance Criteria

1. WHEN um usuário autenticado clica no ícone de sino do AppHeader, THE Notifications_Modal SHALL abrir exibindo a sidebar com as categorias `Anúncios`, `Mensagens`, `Tickets` e `Atividades`.
2. THE Notifications_Modal SHALL classificar cada `Notification` retornada por `getNotifications(userId, 50)` em exatamente uma categoria conforme o contrato de Notification_Type_Prefix definido no Requirement 3.
3. WHEN o Notifications_Modal abre, THE Notifications_Modal SHALL pré-selecionar a primeira categoria que possua ao menos uma notificação não lida na ordem `Anúncios`, `Mensagens`, `Tickets`, `Atividades`, e na ausência de não lidas SHALL pré-selecionar `Anúncios`.
4. WHEN o usuário clica em uma notificação não lida, THE Notifications_Modal SHALL marcar a notificação como lida via `markNotificationAsRead(id)` antes de navegar para `notification.link` quando este existir.
5. THE Notifications_Modal SHALL exibir, ao lado de cada categoria na sidebar, o número de notificações não lidas naquela categoria, exibindo `9+` quando o valor exceder nove.
6. THE Notifications_Modal SHALL persistir a Sound_Preference em `localStorage` sob a chave `fretego-notif-sound`.

### Requirement 2: Header do embarcador com sininho de notificações

**User Story:** Como embarcador autenticado, quero ter o ícone de notificações no header igual ao motorista, para que eu receba comunicados e mensagens sem precisar consultar emails.

#### Acceptance Criteria

1. WHERE o usuário autenticado tem `userType = 'embarcador'`, THE AppHeader SHALL renderizar o ícone do sino com o mesmo comportamento usado para motorista, abrindo o Notifications_Modal compartilhado.
2. WHERE o usuário autenticado tem `userType = 'embarcador'`, THE AppHeader SHALL exibir no badge do sino a soma `unreadNotifications + unreadChatMessages` truncada em `9+` quando exceder nove.
3. THE AppHeader SHALL manter, para embarcador, os controles de geolocalização e perfil já existentes, mas NÃO SHALL exibir blocos exclusivos de motorista (ex.: raio de busca, preço do diesel) que existam fora deste componente.
4. WHEN um embarcador novo abre o Notifications_Modal pela primeira vez sem notificações, THE Notifications_Modal SHALL exibir o estado vazio padrão de cada aba sem erro.

### Requirement 3: Contrato de prefixo do campo `notifications.type`

**User Story:** Como time de produto, quero um contrato estável de prefixos no campo `type`, para que cada notificação caia automaticamente na aba correta sem código de mapeamento espalhado.

#### Acceptance Criteria

1. THE Notifications_Hub SHALL classificar `notifications.type` em uma das categorias do Notifications_Modal aplicando o prefixo **mais específico (mais longo)** primeiro, e o prefixo **mais genérico** apenas como fallback. O mapeamento case-insensitive é:
   - prefixo `broadcast_` mapeia para `Anúncios`.
   - prefixo `anuncio_` mapeia para `Anúncios`.
   - prefixo `frete_like_` mapeia para `Atividades` (mais específico que `frete_`).
   - prefixo `frete_` (sem ser `frete_like_`) mapeia para `Anúncios`.
   - prefixo `chat_support_` mapeia para `Mensagens` (mais específico que `chat_`).
   - prefixo `chat_` ou `message_` ou `msg_` mapeia para `Mensagens`.
   - prefixo `ticket_`, `support_` ou `suporte_` mapeia para `Tickets`.
   - qualquer outro valor mapeia para `Atividades`.
2. THE Notifications_Hub SHALL persistir todos os tipos novos criados nesta spec usando exatamente os prefixos `broadcast_`, `chat_support_`, `ticket_`, conforme tabela:
   - Broadcast emitido pelo admin: `broadcast_general`.
   - Chat de frete (já existente): `chat_message`.
   - Chat de suporte user→admin: `chat_support_user_message`.
   - Chat de suporte admin→user: `chat_support_admin_reply`.
   - Ticket criado pelo admin (mensagem inicial automática) ou criado pelo user: `ticket_created`.
   - Ticket respondido pelo admin: `ticket_replied`.
   - Ticket fechado pelo admin: `ticket_resolved`.
3. IF um valor de `notifications.type` não corresponde a nenhum prefixo conhecido, THEN THE Notifications_Modal SHALL classificá-lo em `Atividades`.
4. THE Notifications_Hub SHALL tratar o conjunto de prefixos como contrato versionado: qualquer prefixo novo SHALL ser adicionado nesta lista e refletido em `categorize` no `NotificationsModal.tsx` na mesma migration que introduzir o prefixo.

### Requirement 4: Broadcast de comunicado pelo admin com targeting

**User Story:** Como admin com permissão `FINANCEIRO_EDIT`, quero criar um comunicado com título, corpo, link opcional e público-alvo (motoristas, embarcadores, empresas-futuro), para que eu informe os usuários certos sem disparar email manual.

#### Acceptance Criteria

1. WHERE o admin autenticado satisfaz `is_admin_with_permission('FINANCEIRO_EDIT')`, THE Admin_Panel SHALL exibir o painel `Comunicados` permitindo criar um Broadcast_Announcement.
2. WHEN o admin submete um Broadcast_Announcement, THE Notifications_Hub SHALL validar `title` com tamanho entre 1 e 120 caracteres, `body` entre 1 e 2000 caracteres, `link` opcional com no máximo 500 caracteres, e `target_audience` como subconjunto não-vazio de `{'motorista', 'embarcador', 'empresa'}`.
3. IF qualquer campo do Broadcast_Announcement viola a validação acima, THEN THE Notifications_Hub SHALL recusar a criação com erro de validação descritivo e NÃO SHALL inserir linha em `broadcast_announcements`.
4. WHEN um Broadcast_Announcement válido é submetido, THE Notifications_Hub SHALL persistir a linha em `broadcast_announcements` com `created_by = auth.uid()`, `created_at = NOW()`, `status = 'sent'` e enfileirar o Fan_Out_Broadcast.
5. THE Notifications_Hub SHALL gravar audit log com action `BROADCAST_CREATE`, `target_type = 'broadcast_announcements'`, `target_id` igual ao id da linha criada, e `after_data` contendo título, audiência e link, via `executeAdminMutation`.
6. IF `auth.uid()` não satisfaz `is_admin_with_permission('FINANCEIRO_EDIT')`, THEN THE Notifications_Hub SHALL recusar a criação com `permission_denied` e gravar audit log negativo `BROADCAST_VIEW_DENIED` conforme padrão do projeto.

### Requirement 5: Fan-out de broadcast em notifications

**User Story:** Como recipient (motorista ou embarcador) dentro do `Target_Audience`, quero receber o comunicado na aba Anúncios do meu Notifications_Modal, para que eu não dependa de email para descobrir avisos da plataforma.

#### Acceptance Criteria

1. WHEN um Broadcast_Announcement é criado com sucesso, THE Fan_Out_Broadcast SHALL inserir uma linha em `notifications` para cada usuário ativo (`users.is_active = true`) cujo `user_type` esteja em `target_audience`, com `type = 'broadcast_general'`, `title` igual ao título do broadcast, `message` igual ao body do broadcast, `link` igual ao link do broadcast (ou NULL), e `read_at = NULL`.
2. THE Fan_Out_Broadcast SHALL ser idempotente em respeito ao par `(user_id, broadcast_id)`: a função SHALL armazenar `broadcast_id` em coluna nova `notifications.broadcast_id` (uuid, NULL para tipos não-broadcast) e SHALL evitar inserir duplicata para o mesmo par via `ON CONFLICT DO NOTHING` em índice único parcial.
3. THE Fan_Out_Broadcast SHALL ignorar usuários cujo `user_type` esteja no audience mas cujo papel ainda não exista no sistema (caso de `'empresa'` em Phase 1), gravando contagem de pulos no audit log mas NÃO falhando a operação.
4. WHEN o Fan_Out_Broadcast termina, THE Notifications_Hub SHALL atualizar a linha em `broadcast_announcements` com `recipients_count` igual ao número total de notificações inseridas e `dispatched_at = NOW()`.
5. WHILE o Fan_Out_Broadcast está em execução para um broadcast com mais de 10000 destinatários, THE Notifications_Hub SHALL processar em lotes de 1000 inserts para evitar pico de memória do Postgres.
6. WHEN uma `notifications` row de tipo `broadcast_general` é inserida e o Recipient_User está com Notifications_Modal aberto na aba Anúncios via Supabase realtime, THE Notifications_Modal SHALL exibir o item no topo da lista sem reload manual.

### Requirement 6: Notificações de chat de frete (motorista ↔ embarcador)

**User Story:** Como motorista ou embarcador, quero que toda mensagem nova no chat de frete dispare uma notificação na aba Mensagens, para que eu não perca uma resposta do outro lado.

#### Acceptance Criteria

1. WHEN uma `messages` row é inserida em uma `Frete_Conversation`, THE Notifications_Hub SHALL inserir uma `notifications` row para o destinatário (motorista ou embarcador que não é o sender) com `type = 'chat_message'`, `title` contendo o nome do remetente, `message` contendo um resumo da mensagem (até 100 caracteres), e `link` apontando para `/mensagens?conversa=<conversation_id>`.
2. THE Notifications_Hub SHALL preservar o comportamento de deduplicação já existente nas migrations 023 e 024, ou seja, mensagens em sequência rápida do mesmo remetente para o mesmo destinatário NÃO SHALL gerar uma nova notification se uma não-lida do mesmo `chat_message` já existir nos últimos 5 minutos.
3. WHEN o Recipient_User abre o Notifications_Modal e clica numa notificação `chat_message`, THE Notifications_Modal SHALL navegar para o link da notificação e marcar a linha como lida.

### Requirement 7: Chat de suporte (usuário ↔ admin)

**User Story:** Como motorista ou embarcador autenticado, quero abrir um chat com o suporte da FreteGO direto pelo app, para que eu não precise sair da plataforma para falar com humanos.

#### Acceptance Criteria

1. WHEN um usuário autenticado clica em `Falar com suporte` na aba Mensagens do Notifications_Modal, THE Notifications_Hub SHALL retornar a Support_Conversation existente do usuário (`chat_conversations.user_id = auth.uid()`) ou criar uma nova com `status = 'aberta'`.
2. WHEN o usuário envia uma mensagem em sua Support_Conversation, THE Notifications_Hub SHALL inserir a linha em `chat_messages` com `is_admin = false` e SHALL inserir uma `notifications` row de `type = 'chat_support_user_message'` para todo admin que satisfaça `is_admin_with_permission('SUPORTE_VIEW')` e esteja ativo.
3. WHEN o admin com `is_admin_with_permission('SUPORTE_REPLY')` envia uma mensagem na Support_Conversation, THE Notifications_Hub SHALL inserir a linha em `chat_messages` com `is_admin = true` e SHALL inserir uma `notifications` row de `type = 'chat_support_admin_reply'` para o `chat_conversations.user_id`.
4. THE Notifications_Hub SHALL exibir as Support_Conversations do admin junto com o chat de frete na aba Mensagens do Notifications_Modal do admin, ordenadas por `updated_at DESC`.
5. IF um usuário sem permissão `SUPORTE_REPLY` tenta inserir mensagem com `is_admin = true`, THEN THE Notifications_Hub SHALL recusar a operação via RLS e RPC com `permission_denied`.
6. WHEN o admin com `SUPORTE_REPLY` muda o status da Support_Conversation para `resolvida`, THE Notifications_Hub SHALL gravar audit log `SUPORTE_CHAT_RESOLVE` via `executeAdminMutation` e SHALL aceitar reabertura posterior se o usuário enviar nova mensagem (status volta para `aberta`).

### Requirement 8: Ticket de suporte por usuário autenticado

**User Story:** Como motorista ou embarcador autenticado, quero abrir um ticket formal com assunto, corpo e prioridade, para que minha demanda fique rastreada e o admin possa responder com SLA, distinto do chat informal.

#### Acceptance Criteria

1. WHEN um usuário autenticado submete um Support_Ticket via formulário, THE Notifications_Hub SHALL validar `subject` com tamanho entre 3 e 120 caracteres, `body` entre 10 e 5000 caracteres, e `priority` em `{'low', 'normal', 'high'}`, recusando submissões fora desses limites.
2. WHEN um Support_Ticket válido é submetido por usuário autenticado, THE Notifications_Hub SHALL persistir a linha em `support_tickets` com `user_id = auth.uid()`, `status = 'open'`, `created_at = NOW()`, e SHALL persistir a primeira mensagem em `support_ticket_messages` com `author_id = auth.uid()` e `is_admin = false`.
3. WHEN o admin com `is_admin_with_permission('SUPORTE_REPLY')` responde ao Support_Ticket, THE Notifications_Hub SHALL inserir a resposta em `support_ticket_messages` com `is_admin = true`, atualizar `support_tickets.status` para `'in_progress'` se estava `'open'`, e SHALL inserir uma `notifications` row de `type = 'ticket_replied'` para `support_tickets.user_id` com link `/tickets/<ticket_id>`.
4. WHEN o admin com `SUPORTE_REPLY` resolve o Support_Ticket, THE Notifications_Hub SHALL atualizar `support_tickets.status` para `'resolved'`, registrar `resolved_at = NOW()` e `resolved_by = auth.uid()`, e SHALL inserir `notifications` row de `type = 'ticket_resolved'` para o autor do ticket.
5. THE Notifications_Hub SHALL recusar atualização de Support_Ticket com `expected_updated_at` divergente de `support_tickets.updated_at` lançando `STALE_VERSION` conforme padrão do projeto.
6. IF um usuário tenta visualizar Support_Ticket cujo `user_id` é diferente do seu via PostgREST, THEN THE Notifications_Hub SHALL retornar zero linhas via RLS, e SHALL admitir SELECT apenas para admin com `is_admin_with_permission('SUPORTE_VIEW')`.
7. THE Notifications_Hub SHALL gravar audit log `SUPORTE_REPLY` ou `SUPORTE_TICKET_RESOLVE` via `executeAdminMutation` em toda mutação admin sobre `support_tickets` ou `support_ticket_messages`.

### Requirement 9: Ticket de suporte público (visitante anônimo)

**User Story:** Como visitante na landing page sem cadastro, quero enviar uma mensagem ao suporte da FreteGO informando meu nome e email, para que eu tire dúvidas antes de me cadastrar.

#### Acceptance Criteria

1. WHEN um Visitor submete o formulário público de ticket, THE Notifications_Hub SHALL validar `guest_name` entre 2 e 80 caracteres, `guest_email` em formato de email válido (regex `^[^@\s]+@[^@\s]+\.[^@\s]+$`), `subject` entre 3 e 120 caracteres, `body` entre 10 e 5000 caracteres.
2. THE Notifications_Hub SHALL expor a criação de Public_Support_Ticket via RPC `submit_public_ticket(...)` chamável pelo role `anon` sem `auth.uid()`, e SHALL persistir a linha em `support_tickets` com `user_id = NULL`, `guest_name`, `guest_email`, `status = 'open'`.
3. THE Notifications_Hub SHALL incluir um campo honeypot oculto `website_url` no formulário público; IF a submissão chega com `website_url` não-vazio, THEN THE Notifications_Hub SHALL responder com sucesso falso (HTTP 200, mas sem persistir) para enganar bots e gravar tentativa em `support_ticket_attempts` com flag `bot_detected = true`.
4. THE Notifications_Hub SHALL aplicar rate-limit por IP de origem: IF o IP de origem do request ao RPC `submit_public_ticket` registrou mais de 5 tentativas válidas em `support_ticket_attempts` na última hora, THEN THE Notifications_Hub SHALL recusar com erro genérico `Não foi possível enviar agora. Tente novamente mais tarde.` e SHALL gravar a tentativa rejeitada com `rate_limited = true`.
5. WHEN um Public_Support_Ticket é criado com sucesso, THE Notifications_Hub SHALL inserir uma `notifications` row para todo admin com `is_admin_with_permission('SUPORTE_VIEW')` ativo, com `type = 'ticket_created'`, `title` indicando ser de visitante público, e `link = '/admin/suporte/<ticket_id>'`.
6. WHEN o admin com `SUPORTE_REPLY` responde a um Public_Support_Ticket, THE Notifications_Hub SHALL invocar a Edge Function `send-public-ticket-reply` que envia email para `guest_email` com `subject` prefixado por `[FreteGO Suporte] Re: ` e o corpo da resposta, e SHALL persistir a resposta em `support_ticket_messages` com `is_admin = true`.
7. IF a chamada à Edge Function `send-public-ticket-reply` falha, THEN THE Notifications_Hub SHALL marcar a `support_ticket_messages.email_sent_at` como NULL e exibir ao admin a mensagem `Resposta salva mas falha ao enviar email. Verifique o destinatário.`, mantendo a resposta persistida para retentativa manual.
8. THE Notifications_Hub SHALL exibir Public_Support_Ticket apenas para admins com `is_admin_with_permission('SUPORTE_VIEW')` via RLS, e SHALL ocultar `guest_email` e `guest_name` de qualquer SELECT de role `anon` ou `authenticated` não-admin.

### Requirement 10: Notificações de atividades

**User Story:** Como motorista ou embarcador, quero receber na aba Atividades os eventos de like em meus fretes/fotos, avaliações recebidas e alertas de plano, para que eu não dependa de checar manualmente cada módulo.

#### Acceptance Criteria

1. WHEN um motorista curte um frete (já existe via 021), THE Notifications_Hub SHALL inserir/preservar a `notifications` row com `type = 'frete_like_<id>'` que recai em `Atividades` por força do prefixo `frete_like_` definido no Requirement 3.
2. THE Notifications_Hub SHALL classificar tipos de avaliação (`rating_*`), alertas de plano (`plan_*`) e eventos de sistema (`system_*`) na aba `Atividades` por força do fallback do Requirement 3 (qualquer prefixo desconhecido → Atividades).
3. WHEN o plano de um usuário está a 3 dias do vencimento, THE Notifications_Hub SHALL inserir uma `notifications` row com `type = 'plan_expiring'` para esse usuário no máximo uma vez por ciclo, e SHALL evitar duplicatas via índice único parcial em `(user_id, type)` enquanto não-lida.
4. WHEN o plano de um usuário expira, THE Notifications_Hub SHALL inserir uma `notifications` row com `type = 'plan_expired'` para esse usuário no máximo uma vez por ciclo de plano.
5. THE Notifications_Hub SHALL preservar a tabela `notifications` existente como única fonte de verdade para todos esses tipos, sem criar tabelas auxiliares para atividades.

### Requirement 11: RLS, permissões admin e audit

**User Story:** Como engenharia de segurança, quero que toda leitura e mutação relacionada a notificações, broadcast, tickets e chat de suporte respeitem RLS server-side e gerem audit log para mutações admin, para que ninguém consiga vazar dados via cliente manipulado.

#### Acceptance Criteria

1. THE Notifications_Hub SHALL garantir que `notifications` SELECT por usuário não-admin retorne apenas linhas com `user_id = auth.uid()` via RLS.
2. THE Notifications_Hub SHALL admitir SELECT em `notifications` para admin que satisfaça `is_admin_with_permission('USER_VIEW')` (policy já existente em 031), sem alteração.
3. THE Notifications_Hub SHALL impedir INSERT direto em `notifications` por role `authenticated` ou `anon`: inserções SHALL ocorrer somente via RPC `SECURITY DEFINER` (fan-out, chat triggers) ou triggers SQL existentes.
4. THE Notifications_Hub SHALL admitir SELECT/INSERT/UPDATE/DELETE em `broadcast_announcements` apenas para admin com `is_admin_with_permission('FINANCEIRO_EDIT')`, e SHALL gravar audit log `BROADCAST_VIEW_DENIED` em RPC quando o caller falha o gating.
5. THE Notifications_Hub SHALL admitir SELECT em `support_tickets` por usuário não-admin apenas quando `user_id = auth.uid()`, e por admin somente quando `is_admin_with_permission('SUPORTE_VIEW')`.
6. THE Notifications_Hub SHALL admitir INSERT em `support_tickets` por role `authenticated` apenas via RPC `submit_user_ticket` (que cola `auth.uid()` no `user_id`), e por role `anon` apenas via RPC `submit_public_ticket` com `user_id = NULL`.
7. THE Notifications_Hub SHALL admitir INSERT em `support_ticket_messages` por usuário não-admin apenas em ticket próprio (`support_tickets.user_id = auth.uid()`), e por admin apenas via RPC `reply_to_ticket` que valida `is_admin_with_permission('SUPORTE_REPLY')`.
8. THE Notifications_Hub SHALL preservar a imutabilidade do master admin `Nexus_Vortex99`: toda RPC ou trigger introduzida nesta spec SHALL chamar `assertNotMasterNorSelf` antes de qualquer UPDATE/DELETE em `users` ou em linhas que tenham `users.id = (SELECT id FROM users WHERE admin_username='Nexus_Vortex99')` como `created_by`.
9. THE Notifications_Hub SHALL gravar audit log via `executeAdminMutation` para todas as mutações admin desta spec com action codes em UPPER_SNAKE em inglês: `BROADCAST_CREATE`, `SUPORTE_CHAT_RESOLVE`, `SUPORTE_REPLY` (ticket), `SUPORTE_TICKET_RESOLVE`, `SUPORTE_PUBLIC_TICKET_REPLY`.
10. WHERE uma RPC introduzida nesta spec é `SECURITY DEFINER`, THE Notifications_Hub SHALL aplicar a postura padrão do projeto: `SET search_path = public`, validação `auth.uid() IS NULL` (exceto `submit_public_ticket`), `is_admin_with_permission(...)` quando aplicável, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated` (ou `TO anon, authenticated` no caso de `submit_public_ticket`).

### Requirement 12: Realtime e som de notificação

**User Story:** Como usuário (motorista, embarcador ou admin), quero ouvir um som curto quando uma notificação chega enquanto eu uso o app, e poder silenciar isso a qualquer momento, para que eu fique ciente sem ser incomodado.

#### Acceptance Criteria

1. WHEN uma `notifications` row é inserida com `user_id = auth.uid()`, THE AppHeader SHALL receber o evento via Supabase realtime (canal já existente em `useNotificationsRealtime`) e SHALL incrementar o badge do sino sem reload.
2. WHILE a Sound_Preference está ativa (LocalStorage `fretego-notif-sound !== '0'`), THE Notifications_Hub SHALL tocar o som curto padrão ao receber o evento realtime.
3. WHEN o usuário alterna o toggle de som dentro do Notifications_Modal, THE Notifications_Hub SHALL persistir a escolha em `localStorage['fretego-notif-sound']` como `'1'` ou `'0'` e SHALL refletir o estado novo nas próximas notificações realtime.
4. IF o navegador bloqueia autoplay de áudio antes de qualquer interação do usuário, THEN THE Notifications_Hub SHALL ignorar silenciosamente o erro do `audio.play()` sem propagar para o usuário e sem desativar a Sound_Preference.
5. THE Notifications_Hub SHALL emitir o evento global `fretego-notifications-refresh` quando uma notificação for marcada como lida, para que o badge do AppHeader recalcule contagem via `getUnreadNotificationCount`.

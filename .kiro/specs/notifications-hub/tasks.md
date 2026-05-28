# Implementation Plan — Notifications_Hub

## Overview

Plano de implementação do Notifications_Hub: modal compartilhado motorista/embarcador, broadcast pelo admin, chat de suporte, tickets (logado e público anônimo), realtime e som. 12 epics, ~70 tasks atômicas.

Convenções herdadas (não redocumentar — ver `project-conventions.md`, `admin-patterns.md`, `requirements.md` e `design.md`):
- Migrations idempotentes com `BEGIN/COMMIT` e `DO $check$` defensivo.
- pt-BR em UI/comentários; action codes e error codes em **inglês UPPER_SNAKE**.
- Padrão compacto pós-cleanup (sem `<h1>` grande no topo, popover de filtros, paginação 10/50/100, botões `text-xs px-2.5 py-1`).
- CSV: BOM UTF-8 + `;` + RFC 4180 + truncamento 10000 linhas.
- Property tests obrigatórios (CP-1 a CP-4) **NÃO** levam asterisco. Opcionais levam `*`.
- Toda mutação admin passa por `executeAdminMutation`; idempotência via `_SKIPPED` log dentro da RPC.
- Versionamento otimista via `updated_at` + `STALE_VERSION`.
- RPCs SECURITY DEFINER seguem postura: `SET search_path=public`, `auth.uid() IS NULL` ⇒ `permission_denied`, `is_admin_with_permission` quando admin, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated` (ou `anon, authenticated` em `submit_public_ticket`).

## Tasks

- [x] 1. Migration 041 e contratos base de banco
  - [x] 1.1 Criar `supabase/migrations/041_notifications_hub.sql`
    - Cabeçalho com objetivo, dependências de migrations 001 (notifications), 008/009 (chat), 030 (admin-foundation).
    - Envolver em `BEGIN; ... COMMIT;`.
    - Blocos `DO $check$` defensivos validando: (a) `is_admin_with_permission(text)` existe; (b) `admin_audit_logs` existe com `after_data`; (c) `notifications` existe com colunas `user_id`, `type`, `title`, `message`, `link`, `read_at`, `created_at`; (d) `chat_conversations` e `chat_messages` existem; (e) `users.user_type` aceita `'motorista'` e `'embarcador'`.
    - Cada bloco levanta `EXCEPTION` clara quando dependência ausente.
    - _Requirements: 11.10, 13.1_

  - [x] 1.2 Criar tabela `broadcast_announcements`
    - 11 colunas conforme `design.md` §Data Models.
    - 4 CHECK constraints: tamanho de title (1-120), body (1-2000), link (≤500 ou NULL), `target_audience` subset não-vazio de `{motorista,embarcador,empresa}`.
    - Status enum CHECK em `('sent','draft','scheduled')`.
    - Default `status='sent'`, `created_at=NOW()`, `updated_at=NOW()`.
    - FK `created_by → users(id) ON DELETE SET NULL`.
    - Índice `idx_broadcasts_created` em `(created_at DESC)`.
    - `ENABLE ROW LEVEL SECURITY`.
    - `COMMENT ON TABLE`.
    - _Requirements: 4.4, 11.4_

  - [x] 1.3 Criar tabela `support_tickets`
    - 12 colunas conforme `design.md` §Data Models.
    - CHECKs: `subject` (3-120), `status ∈ {open,in_progress,resolved}`, `priority ∈ {low,normal,high}`, `guest_name` (2-80 quando NOT NULL), `guest_email` regex anti-fake.
    - Constraint `chk_user_xor_guest` garantindo XOR entre `user_id` e `guest_*`.
    - FKs `user_id, resolved_by → users(id) ON DELETE SET NULL`.
    - Índices `idx_tickets_user (user_id, created_at DESC)` e `idx_tickets_status (status, created_at DESC)`.
    - `ENABLE ROW LEVEL SECURITY`.
    - _Requirements: 8.1, 8.2, 9.1, 11.5_

  - [x] 1.4 Criar tabela `support_ticket_messages`
    - 7 colunas: `id`, `ticket_id`, `author_id` (NULL = anônimo), `body` (1-5000), `is_admin` (default false), `email_sent_at` (NULL = não enviado ou não-aplicável), `created_at`.
    - FK `ticket_id → support_tickets(id) ON DELETE CASCADE`.
    - FK `author_id → users(id) ON DELETE SET NULL`.
    - Índice `idx_ticket_messages_ticket (ticket_id, created_at)`.
    - `ALTER TABLE ... REPLICA IDENTITY FULL` para realtime.
    - `ENABLE ROW LEVEL SECURITY`.
    - _Requirements: 8.3, 8.4, 9.6, 11.7_

  - [x] 1.5 Criar tabela `support_ticket_attempts`
    - 7 colunas: `id`, `ip inet`, `guest_email` (NULL OK), `bot_detected boolean`, `rate_limited boolean`, `ticket_id` (NULL se rejeitado), `created_at`.
    - FK `ticket_id → support_tickets(id) ON DELETE SET NULL`.
    - Índice `idx_ticket_attempts_ip_time (ip, created_at DESC)` para rate-limit.
    - `ENABLE ROW LEVEL SECURITY` — sem policies públicas (só RPC SECURITY DEFINER acessa).
    - _Requirements: 9.3, 9.4_

  - [x] 1.6 Estender tabela `notifications`
    - `ADD COLUMN broadcast_id uuid NULL REFERENCES broadcast_announcements(id) ON DELETE SET NULL`.
    - `ADD COLUMN ticket_id uuid NULL REFERENCES support_tickets(id) ON DELETE SET NULL`.
    - Índice único parcial `uq_notifications_user_broadcast (user_id, broadcast_id) WHERE broadcast_id IS NOT NULL` — idempotência do fan-out.
    - Índice único parcial `uq_notifications_user_plan_unread (user_id, type) WHERE read_at IS NULL AND type LIKE 'plan_%'` — uma notificação plan_* não-lida por user.
    - Índice `idx_notifications_user_created (user_id, created_at DESC)` para listagem rápida no modal.
    - _Requirements: 5.2, 10.3, 10.4_

  - [x] 1.7 RLS de `broadcast_announcements`
    - SELECT: `is_admin_with_permission('FINANCEIRO_VIEW') OR ...EDIT')`.
    - INSERT/UPDATE/DELETE: `is_admin_with_permission('FINANCEIRO_EDIT')`.
    - `DROP POLICY IF EXISTS` antes de `CREATE POLICY` (idempotência).
    - _Requirements: 11.4_

  - [x] 1.8 RLS de `support_tickets`
    - SELECT: `user_id = auth.uid() OR is_admin_with_permission('SUPORTE_VIEW')`.
    - INSERT direto **bloqueado** (sem policy de INSERT — só via RPC SECURITY DEFINER).
    - UPDATE: `is_admin_with_permission('SUPORTE_REPLY')`.
    - DELETE: bloqueado (sem policy).
    - _Requirements: 11.5, 11.6_

  - [x] 1.9 RLS de `support_ticket_messages`
    - SELECT via subquery: ticket pertence ao caller OU caller é admin com SUPORTE_VIEW.
    - INSERT bloqueado direto (só via RPC).
    - _Requirements: 11.7_

  - [x] 1.10 RLS de `support_ticket_attempts`
    - Sem policies — toda interação via RPC SECURITY DEFINER.
    - _Requirements: 11.6_

  - [x] 1.11 Bloquear INSERT direto em `notifications` por `authenticated` e `anon`
    - Revisar policy existente; se houver INSERT permissivo, `DROP POLICY` + recriar restrito.
    - INSERT só via triggers SQL ou RPCs SECURITY DEFINER desta spec.
    - _Requirements: 11.3_
    - **Nota**: a migration 001 não tem INSERT policy explícita em `notifications`; sem RLS policy, INSERT direto via PostgREST já é bloqueado por default. Mantido como está.

  - [x] 1.12 Trigger `broadcast_fanout_after_insert` em `broadcast_announcements`
    - `AFTER INSERT FOR EACH ROW`.
    - Function `broadcast_fanout()` `RETURNS trigger SECURITY DEFINER SET search_path=public`.
    - Itera `NEW.target_audience` e insere `notifications` em batch via `INSERT ... SELECT ... FROM users WHERE is_active=true AND user_type=ANY(NEW.target_audience) ON CONFLICT (user_id, broadcast_id) DO NOTHING`.
    - `GET DIAGNOSTICS v_count = ROW_COUNT`.
    - `UPDATE broadcast_announcements SET recipients_count=v_count, dispatched_at=NOW() WHERE id=NEW.id`.
    - Idempotente em re-INSERT do mesmo broadcast (não acontece, mas defensivo).
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.13 Trigger `chat_messages_notify_on_insert` em `chat_messages`
    - `AFTER INSERT FOR EACH ROW`.
    - Se `NEW.is_admin = false`: insert `notifications` para todos admins ativos com `is_admin_with_permission('SUPORTE_VIEW')`, `type='chat_support_user_message'`, link `/admin/suporte/chat?conv=<id>`.
    - Se `NEW.is_admin = true`: insert `notifications` para `chat_conversations.user_id` da conversa, `type='chat_support_admin_reply'`, link `/suporte/chat`.
    - Defensivo: `RAISE WARNING` (não bloqueia INSERT) se algo falhar — não queremos quebrar chat por falha de notif.
    - _Requirements: 7.2, 7.3_
    - **Nota**: filtro de admin com SUPORTE_VIEW resolvido via nova função `has_admin_permission(target_user_id, action)` introduzida na própria migration 041. Variante parametrizada de `is_admin_with_permission` que aceita o user_id como argumento (necessário em triggers, onde `auth.uid()` aponta pro caller original e não pra cada admin alvo).

  - [x] 1.14 Trigger `support_ticket_messages_notify_on_insert` em `support_ticket_messages`
    - `AFTER INSERT FOR EACH ROW`.
    - Resolve ticket via `SELECT * FROM support_tickets WHERE id = NEW.ticket_id`.
    - Se `NEW.is_admin = true` E `ticket.user_id IS NOT NULL`: insere notif para `ticket.user_id`, `type='ticket_replied'`, link `/tickets/<ticket_id>`.
    - Se `NEW.is_admin = false` E é a primeira mensagem (`COUNT(*) FROM support_ticket_messages WHERE ticket_id=NEW.ticket_id = 1`): insere notif para todos admins com `SUPORTE_VIEW`, `type='ticket_created'`, link `/admin/suporte/tickets/<ticket_id>`.
    - _Requirements: 8.3, 9.5_

  - [x] 1.15 Trigger `support_tickets_resolved_notify` em `support_tickets`
    - `AFTER UPDATE FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='resolved' AND NEW.user_id IS NOT NULL)`.
    - Insert `notifications` para `NEW.user_id`, `type='ticket_resolved'`, link `/tickets/<id>`.
    - _Requirements: 8.4_
    - **Nota**: função filtra `user_id IS NULL` internamente em vez do WHEN, porque o trigger `WHEN` não pode acessar funções complexas. Comportamento equivalente.

  - [x] 1.16 RPC `rpc_create_broadcast(p_title, p_body, p_link, p_target_audience)` SECURITY DEFINER
    - Auth check + `is_admin_with_permission('FINANCEIRO_EDIT')`.
    - Path negativo: insert `BROADCAST_VIEW_DENIED` em `admin_audit_logs` + `RAISE permission_denied USING ERRCODE='42501'`.
    - Validações de domínio com `RAISE EXCEPTION ... USING ERRCODE='P0001'`:
      - `char_length(p_title) BETWEEN 1 AND 120` ⇒ `INVALID_TITLE`.
      - `char_length(p_body) BETWEEN 1 AND 2000` ⇒ `INVALID_BODY`.
      - `p_link IS NULL OR char_length(p_link) <= 500` ⇒ `INVALID_LINK`.
      - `array_length(p_target_audience,1) >= 1` ⇒ `EMPTY_AUDIENCE`.
      - `p_target_audience <@ ARRAY['motorista','embarcador','empresa']::text[]` ⇒ `INVALID_AUDIENCE`.
    - INSERT em `broadcast_announcements` com `created_by=auth.uid()`. Trigger faz fan-out.
    - SELECT linha resultante (pega `recipients_count` e `dispatched_at` populados pelo trigger).
    - Retorna `jsonb` com a linha.
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 11.10_

  - [x] 1.17 RPC `submit_user_ticket(p_subject, p_body, p_priority)` SECURITY DEFINER
    - Auth check (`auth.uid() IS NOT NULL`).
    - Validações: subject (3-120), body (10-5000), priority em enum.
    - Em transação: INSERT `support_tickets` com `user_id=auth.uid()`, depois INSERT primeira `support_ticket_messages` com `author_id=auth.uid()`, `is_admin=false`.
    - Retorna jsonb do ticket.
    - `GRANT EXECUTE TO authenticated`.
    - _Requirements: 8.1, 8.2_

  - [x] 1.18 RPC `submit_public_ticket(p_guest_name, p_guest_email, p_subject, p_body, p_website_url)` SECURITY DEFINER
    - **Sem auth check** — chamável por `anon`.
    - Honeypot: se `p_website_url IS NOT NULL AND char_length(p_website_url) > 0`: insert `support_ticket_attempts(bot_detected=true)` + RETURN `{ submitted: true }` sem criar ticket.
    - Validações: guest_name (2-80), guest_email regex, subject (3-120), body (10-5000). Falha ⇒ `RAISE 'INVALID_INPUT'`.
    - Rate-limit: `SELECT count(*) FROM support_ticket_attempts WHERE ip = inet_client_addr() AND created_at > NOW() - INTERVAL '1 hour' AND bot_detected=false AND rate_limited=false`. Se `> 5`: insert `support_ticket_attempts(rate_limited=true)` + RAISE genérico `'PUBLIC_TICKET_RATE_LIMITED'` (cliente traduz para "Não foi possível enviar agora").
    - INSERT em `support_tickets` com `user_id=NULL, guest_name, guest_email`.
    - INSERT primeira mensagem com `author_id=NULL, is_admin=false`.
    - INSERT `support_ticket_attempts(ticket_id=...)`.
    - Trigger 1.14 dispara notif aos admins.
    - RETURN `{ submitted: true }` (resposta opaca anti-enumeration).
    - `GRANT EXECUTE TO anon, authenticated`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.8_

  - [x] 1.19 RPC `reply_to_ticket(p_ticket_id, p_body, p_expected_updated_at)` SECURITY DEFINER
    - Auth check + `is_admin_with_permission('SUPORTE_REPLY')`.
    - Path negativo: `SUPORTE_TICKET_VIEW_DENIED` log + raise.
    - `SELECT FOR UPDATE` no ticket; `NOT FOUND` ⇒ `RAISE 'NOT_FOUND'`.
    - Versionamento otimista: `UPDATE ... WHERE id=$ AND updated_at=$expected`. `ROW_COUNT=0` ⇒ `RAISE 'STALE_VERSION'`.
    - INSERT `support_ticket_messages` com `is_admin=true, author_id=auth.uid(), email_sent_at=NULL`.
    - UPDATE `support_tickets.status` para `'in_progress'` se era `'open'`, sempre toca `updated_at=NOW()`.
    - Trigger 1.14 notifica `user_id` (se não-público).
    - Retorna `{ message: ..., ticket: ... }`.
    - _Requirements: 8.3, 8.5_

  - [x] 1.20 RPC `resolve_ticket(p_ticket_id, p_expected_updated_at)` SECURITY DEFINER
    - Auth + `is_admin_with_permission('SUPORTE_REPLY')`.
    - `SELECT FOR UPDATE`; `NOT FOUND` ⇒ raise.
    - **Idempotência _SKIPPED**: status já `'resolved'` ⇒ INSERT `SUPORTE_TICKET_RESOLVE_SKIPPED` em `admin_audit_logs` (`after_data={reason:'ALREADY_RESOLVED'}`) + RETURN `{skipped:true,reason:'ALREADY_RESOLVED'}`.
    - Versionamento otimista. `STALE_VERSION` em ROW_COUNT=0.
    - UPDATE: `status='resolved'`, `resolved_at=NOW()`, `resolved_by=auth.uid()`.
    - Trigger 1.15 notifica user.
    - Retorna ticket atualizado.
    - _Requirements: 8.4, 8.5_

  - [x] 1.21 RPC `mark_email_sent(p_message_id, p_sent_at)` SECURITY DEFINER
    - Auth + `is_admin_with_permission('SUPORTE_REPLY')`.
    - UPDATE `support_ticket_messages.email_sent_at = p_sent_at WHERE id = p_message_id`.
    - Usado pelo client após receber sucesso da Edge Function.
    - _Requirements: 9.6, 9.7_

  - [x] 1.22 RPC `resolve_support_conversation(p_conversation_id, p_expected_updated_at)` SECURITY DEFINER
    - Auth + `is_admin_with_permission('SUPORTE_REPLY')`.
    - Idempotente _SKIPPED se status já `'resolvida'`.
    - Versionamento otimista.
    - UPDATE `chat_conversations.status='resolvida', updated_at=NOW()`.
    - Audit log `SUPORTE_CHAT_RESOLVE`.
    - _Requirements: 7.6_

  - [ ] 1.23 Atualizar policies de `chat_conversations` e `chat_messages` para admin
    - Garantir que admin com `SUPORTE_VIEW` SELECTa todas as conversas/mensagens.
    - Garantir que admin com `SUPORTE_REPLY` faz INSERT em `chat_messages` com `is_admin=true`.
    - Não quebrar policies existentes para o usuário comum.
    - _Requirements: 7.4, 7.5, 11.7_
    - **Pendente**: a migration 041 não estendeu policies de `chat_conversations`/`chat_messages` para admin SUPORTE_VIEW. Precisa de migration adicional 042 ou ajuste nas policies existentes.

  - [x] 1.24 Criar migration de rollback `041_notifications_hub_rollback.sql`
    - DROP TRIGGER → DROP FUNCTION → DROP TABLE em ordem inversa.
    - DROP COLUMN das colunas adicionadas em `notifications` (broadcast_id, ticket_id) e índices únicos parciais.
    - Reverter mudanças de policy em chat_conversations/chat_messages.
    - **Não auto-aplicada** — apenas documental.
    - _Requirements: project-conventions_

- [ ] 2. Tipos TS, helpers e error mapping
  - [ ] 2.1 Tipos públicos em `src/services/admin/broadcasts.ts`
    - Exportar `Broadcast`, `TargetAudience`, `BroadcastStatus`.
    - JSDoc em pt-BR explicando cada campo.
    - _Requirements: 4.1_

  - [ ] 2.2 Tipos públicos em `src/services/admin/tickets.ts`
    - Exportar `SupportTicket`, `TicketStatus`, `TicketPriority`, `TicketMessage`.
    - _Requirements: 8.1_

  - [ ] 2.3 Tipos públicos em `src/services/admin/supportChat.ts`
    - Exportar `SupportConversation`, `SupportChatMessage`.
    - _Requirements: 7.1_

  - [ ] 2.4 Helper `mapPostgresError(err)` reutilizável (se já não existir uma versão genérica)
    - Mapear códigos `P0001` (`STALE_VERSION`, `INVALID_TITLE`, `INVALID_BODY`, `EMPTY_AUDIENCE`, `INVALID_INPUT`, `PUBLIC_TICKET_RATE_LIMITED`, `NOT_FOUND`, `INVALID_STATUS`) para mensagens user-facing pt-BR canônicas.
    - Mapear `42501` para `Acesso negado.`.
    - Mapear `STALE_VERSION` para toast "Outro admin atualizou. Recarregando." + dispatch refetch.
    - _Requirements: project-conventions_

- [ ] 3. Leituras de service (TypeScript)
  - [ ] 3.1 `listBroadcasts({limit,offset})` → `{ items, total }`
    - SELECT * FROM broadcast_announcements + count exato.
    - Ordem `created_at DESC`.
    - _Requirements: 4.1_

  - [ ] 3.2 `getBroadcastDetail(id)` → broadcast + breakdown por audience
    - SELECT broadcast.
    - SELECT count agrupado por user_type via JOIN com notifications onde broadcast_id = id.
    - _Requirements: 4.5_

  - [ ] 3.3 `previewBroadcastRecipients(audience)` → number
    - SELECT count(*) FROM users WHERE is_active=true AND user_type=ANY(audience).
    - Usado no modal de confirmação antes de enviar.
    - _Requirements: 4.4_

  - [ ] 3.4 `listMyTickets()` (user) → SupportTicket[]
    - SELECT * FROM support_tickets WHERE user_id=auth.uid() ORDER BY created_at DESC.
    - _Requirements: 8.6_

  - [ ] 3.5 `getMyTicket(id)` → { ticket, messages[] }
    - SELECT ticket + SELECT messages do ticket.
    - RLS garante que só o dono lê.
    - _Requirements: 8.6_

  - [ ] 3.6 `listAdminTickets(filters)` → { items, total }
    - Filtros: status, priority, guestOnly (`user_id IS NULL`), q (LIKE em subject), date range.
    - Paginação 10/50/100.
    - _Requirements: 8.6, 11.5_

  - [ ] 3.7 `getAdminTicketDetail(id)` → { ticket, messages[] }
    - Mesma estrutura, RLS admin libera todos os tickets.
    - _Requirements: 11.5_

  - [ ] 3.8 `listSupportConversations(filters)` (admin) → { items, total }
    - SELECT chat_conversations + JOIN users (nome do user) + count de mensagens não-lidas (read_at NULL AND is_admin=false).
    - Ordem `updated_at DESC`.
    - _Requirements: 7.4_

  - [ ] 3.9 `getSupportConversationMessages(conversationId)` → SupportChatMessage[]
    - SELECT chat_messages WHERE conversation_id=$.
    - _Requirements: 7.4_

  - [ ] 3.10 `openMySupportConversation()` (user)
    - SELECT chat_conversations WHERE user_id=auth.uid() ou cria.
    - Idempotente — sempre retorna a única conversa do user.
    - _Requirements: 7.1_

- [ ] 4. Mutações de service (TypeScript)
  - [ ] 4.1 `createBroadcast(input)` (admin)
    - Wrap em `executeAdminMutation` com action `BROADCAST_CREATE`, target_type `broadcast_announcements`, after_data com title+audience.
    - Chama RPC `rpc_create_broadcast`.
    - _Requirements: 4.4, 4.5_

  - [ ] 4.2 `submitUserTicket(input)` (user)
    - Chama RPC `submit_user_ticket`.
    - Sem `executeAdminMutation` (não é mutação admin).
    - _Requirements: 8.2_

  - [ ] 4.3 `submitPublicTicket(input)` (anon)
    - Chama RPC `submit_public_ticket` com role anon.
    - Resposta opaca `{ submitted: true }` em todos os caminhos (honeypot, rate-limit, sucesso).
    - _Requirements: 9.2, 9.3, 9.4_

  - [ ] 4.4 `postMyTicketReply(ticketId, body)` (user)
    - INSERT direto em `support_ticket_messages` (RLS valida ownership do ticket).
    - _Requirements: 8.3_

  - [ ] 4.5 `replyToTicket(ticketId, body, expectedUpdatedAt)` (admin)
    - Wrap em `executeAdminMutation` com action `SUPORTE_REPLY`.
    - Chama RPC `reply_to_ticket`.
    - Se ticket é público (user_id=null): após sucesso da RPC, chama Edge Function `send-public-ticket-reply` com guest_email, guest_name, subject, body, admin_name. Em sucesso: chama RPC `mark_email_sent(message_id, NOW())`. Em falha: deixa `email_sent_at=NULL`, exibe toast "Resposta salva, mas falha ao enviar email. Verifique o destinatário."
    - _Requirements: 8.3, 9.6, 9.7_

  - [ ] 4.6 `resolveTicket(ticketId, expectedUpdatedAt)` (admin)
    - Wrap em `executeAdminMutation` com action `SUPORTE_TICKET_RESOLVE`.
    - Detecta `{skipped:true}` e exibe toast neutro `Ticket já estava resolvido.`.
    - _Requirements: 8.4_

  - [ ] 4.7 `postSupportMessage(message)` (user)
    - SELECT/INSERT da Support_Conversation se necessário.
    - INSERT em `chat_messages` com `is_admin=false`.
    - _Requirements: 7.2_

  - [ ] 4.8 `postAdminReply(conversationId, message, expectedUpdatedAt)` (admin)
    - Wrap em `executeAdminMutation` com action `SUPORTE_CHAT_REPLY`.
    - Versionamento otimista contra `chat_conversations.updated_at`.
    - INSERT mensagem + UPDATE updated_at.
    - _Requirements: 7.3_

  - [ ] 4.9 `resolveSupportConversation(id, expectedUpdatedAt)` (admin)
    - Wrap em `executeAdminMutation` com action `SUPORTE_CHAT_RESOLVE`.
    - Idempotente _SKIPPED.
    - _Requirements: 7.6_

  - [ ] 4.10 Property test CP-1 — paridade de prefixos (categorize)
    - `src/__tests__/notifications/cp1_categorize_prefixes.property.test.ts`
    - fast-check: para cada prefixo conhecido + sufixo arbitrário, `categorizeNotification` retorna a categoria documentada.
    - Para qualquer string que não casa com nenhum prefixo, retorna `'atividades'`.
    - Property: `chat_support_*` é classificado como Mensagens, **não** Tickets (especificidade vence).
    - Property: `frete_like_*` é Atividades, **não** Anúncios.
    - _Requirements: 3.1, CP-1_

  - [ ] 4.11 Property test CP-2 — fan-out de broadcast idempotente
    - `src/__tests__/admin/notifications/cp2_broadcast_fanout_idempotent.property.test.ts`
    - Mock supabase com tabela em memória.
    - Property: criar broadcast e disparar fan-out N vezes (N ∈ [1,5]) ⇒ count de notifications por user resultante = 1.
    - Property: índice único parcial deduplicado garante idempotência mesmo se trigger reentrar.
    - _Requirements: 5.2, CP-2_

  - [ ] 4.12 Property test CP-3 — honeypot do public ticket
    - `src/__tests__/notifications/cp3_public_ticket_honeypot.property.test.ts`
    - fast-check: para qualquer `website_url` não-vazio (`fc.string({ minLength:1, maxLength:200 })`), `submitPublicTicket` retorna `{submitted:true}` mas `support_tickets` count permanece 0 e `support_ticket_attempts.bot_detected=true`.
    - _Requirements: 9.3, CP-3_

  - [ ] 4.13 Property test CP-4 — versionamento otimista de ticket
    - `src/__tests__/admin/notifications/cp4_ticket_stale_version.property.test.ts`
    - fast-check: gerar par `(real_updated_at, stale_updated_at)` distintos. `replyToTicket(id, body, stale)` ⇒ STALE_VERSION. `replyToTicket(id, body, real)` ⇒ sucesso.
    - _Requirements: 8.5, CP-4_

- [ ] 5. Edge Function `send-public-ticket-reply`
  - [ ] 5.1 Criar `supabase/functions/send-public-ticket-reply/index.ts`
    - Verify JWT habilitado (chamadas vêm de admin autenticado via fetch direto, ou do RPC via service-role).
    - Input: `ticket_id, guest_name, guest_email, subject, body, admin_name`.
    - Validar `guest_email` formato.
    - Renderizar template HTML simples com header FreteGO + body + rodapé.
    - Enviar via provider de email (env: `EMAIL_PROVIDER_API_KEY`).
    - Retorna `{ ok: true, message_id }` ou `{ ok: false, error }`.
    - _Requirements: 9.6, 9.7_

  - [ ] 5.2 Adicionar template HTML do email
    - `supabase/functions/send-public-ticket-reply/template.html` ou inline.
    - Variáveis: `{{guest_name}}`, `{{subject}}`, `{{body}}`, `{{admin_name}}`, `{{reply_link}}`.
    - Estilo simples: header verde com logo FreteGO, body em texto, rodapé com link de "responder".
    - _Requirements: 9.6_

  - [ ] 5.3 Configurar env vars no Supabase
    - `EMAIL_PROVIDER_API_KEY` (Resend/SendGrid/SES — a definir).
    - `EMAIL_FROM_ADDRESS` (ex: `suporte@fretego.com.br`).
    - Documentar em `docs/SUPABASE_SETUP.md` ou similar.
    - _Requirements: 9.6_

- [ ] 6. NotificationsModal — extensão
  - [ ] 6.1 Atualizar `categorize` em `NotificationsModal.tsx`
    - Iterar prefixos do mais longo para o mais curto.
    - Adicionar `chat_support_` antes de `chat_`, `frete_like_` antes de `frete_`.
    - _Requirements: 3.1_

  - [ ] 6.2 Adicionar botão `Falar com suporte` no topo da aba Mensagens
    - Visível apenas para `userType in ['motorista', 'embarcador']`.
    - Click chama `openMySupportConversation()` + navega para `/suporte/chat` ou abre subpainel inline (a definir UX).
    - _Requirements: 7.1_

  - [ ] 6.3 Adicionar botão `Abrir novo ticket` no topo da aba Tickets
    - Visível apenas para user logado.
    - Click abre `<UserTicketForm>` em modal filho.
    - _Requirements: 8.1_

  - [ ] 6.4 Aba Mensagens deve unir notificações de chat de frete + chat de suporte
    - Categorize já cobre via prefixo `chat_*`.
    - UX: cada item mostra ícone/cor diferente (frete vs suporte) com tooltip "Frete" ou "Suporte".
    - _Requirements: 1.2, 6.1_

  - [ ] 6.5 Realtime: ao receber INSERT de notification do user, atualizar lista
    - Hook `useNotificationsRealtime` já existe; garantir que `NotificationsModal` reaja a `new-notification` event refetchando ou prepending.
    - _Requirements: 5.6, 12.1_

  - [ ] 6.6 Som de notificação
    - Já existe toggle. Apenas confirmar que persistência em `localStorage['fretego-notif-sound']` está correta e que `audio.play()` é silenciosamente ignorado se autoplay bloqueia.
    - _Requirements: 12.2, 12.3, 12.4_

- [ ] 7. AppHeader do embarcador
  - [ ] 7.1 Validar que sininho aparece para embarcador
    - Hoje o `AppHeader` é compartilhado. Confirmar via teste manual ou snapshot que `userType='embarcador'` renderiza o sino + dropdown corretamente.
    - _Requirements: 2.1, 2.2_

  - [ ] 7.2 Garantir que blocos motorista (raio, diesel) não vazam pro embarcador
    - Esses blocos vivem em `MapaToolbar` na HomePage do motorista — fora do AppHeader. Verificar que a HomePage do embarcador não importa MapaToolbar.
    - _Requirements: 2.3_

- [ ] 8. UserTicketForm e PublicTicketForm
  - [ ] 8.1 `src/components/UserTicketForm.tsx`
    - Modal/inline com campos `subject`, `body`, `priority` (low/normal/high).
    - Submit chama `submitUserTicket`.
    - Toast sucesso + fecha modal.
    - _Requirements: 8.1, 8.2_

  - [ ] 8.2 `src/components/PublicTicketForm.tsx`
    - Form público com `guest_name`, `guest_email`, `subject`, `body`.
    - Honeypot `website_url` em `<input type="text" name="website_url" tabIndex={-1} autoComplete="off" style={{ position:'absolute', left:'-9999px' }} />`.
    - Submit chama `submitPublicTicket` (sem auth).
    - Toast genérico de sucesso `Recebemos sua mensagem. Entraremos em contato pelo email informado.` em todos os retornos (anti-enumeration).
    - _Requirements: 9.1, 9.3, 9.4_

  - [ ] 8.3 `src/pages/PublicTicketPage.tsx` (rota `/contato`)
    - Página pública usando `PublicTicketForm`.
    - Acessível sem login.
    - SEO: title "Contato — FreteGO".
    - _Requirements: 9.1_

  - [ ] 8.4 Link "Fale conosco" no footer/landing
    - Adicionar link na home pública (`/`) e em `/login` apontando para `/contato`.
    - _Requirements: 9.1_

  - [ ] 8.5 Página `MyTicketsPage.tsx` (user logado, rota `/tickets`)
    - Lista tickets do user via `listMyTickets`.
    - Click abre detail page `/tickets/:id`.
    - _Requirements: 8.6_

  - [ ] 8.6 Página `MyTicketDetailPage.tsx` (user logado)
    - Lista mensagens + form de resposta inline.
    - Click em "Responder" chama `postMyTicketReply`.
    - _Requirements: 8.6_

- [ ] 9. Páginas admin
  - [ ] 9.1 `src/pages/admin/AdminBroadcastPage.tsx`
    - Tabela compacta com título, audiência (chips), recipients_count, dispatched_at, created_by.
    - Filtros em popover (data range).
    - Paginação 10/50/100.
    - Botão `+ Novo comunicado` no topo direito.
    - _Requirements: 4.1_

  - [ ] 9.2 `src/components/admin/broadcast/BroadcastFormModal.tsx`
    - Campos title, body (textarea com contador), link, 3 checkboxes de audience.
    - Empresas: checkbox **disabled** com badge "(em breve)" e tooltip explicativo.
    - Antes de enviar, fetch `previewBroadcastRecipients(selected)` e mostra confirmação "Enviar para X destinatários? Não dá pra desfazer.".
    - Submit chama `createBroadcast`.
    - _Requirements: 4.2, 4.4_

  - [ ] 9.3 `src/pages/admin/AdminTicketsPage.tsx`
    - Tabela: De (nome user OU `[Visitante] guest_name`), assunto, status (chip colorido), prioridade (chip), criado em.
    - Filtros: status, priority, "apenas visitantes", date range.
    - Paginação 10/50/100.
    - Permissão `SUPORTE_VIEW`.
    - _Requirements: 8.6, 11.5_

  - [ ] 9.4 `src/pages/admin/AdminTicketDetailPage.tsx`
    - Cabeçalho com info do ticket (assunto, status, autor, data).
    - Lista de mensagens estilo email/chat (alternando alinhamento esquerda/direita conforme `is_admin`).
    - Caixa de resposta no rodapé com botão "Responder" (precisa `SUPORTE_REPLY`).
    - Botão "Marcar como resolvido" (precisa `SUPORTE_REPLY`).
    - Aviso amarelo no topo se ticket é público: "Esta resposta será enviada por email para `<guest_email>`".
    - Se uma mensagem admin tem `email_sent_at=NULL`: badge vermelho "Email não enviado" + botão "Reenviar email".
    - _Requirements: 8.3, 8.4, 9.6, 9.7_

  - [ ] 9.5 `src/pages/admin/AdminSupportChatPage.tsx`
    - Layout 2 colunas: lista de conversas à esquerda, conversa selecionada à direita.
    - Lista mostra nome do user + última mensagem + timestamp + badge não-lidas.
    - Conversa direita: stream de mensagens + caixa de resposta.
    - Botão "Marcar como resolvida" no header da conversa.
    - Permissão `SUPORTE_VIEW`/`SUPORTE_REPLY`.
    - _Requirements: 7.4_

- [ ] 10. Sidebar admin: novos itens
  - [ ] 10.1 Adicionar item "Comunicados" em `AdminSidebar.tsx`
    - Link para `/admin/comunicados`.
    - Permissão `FINANCEIRO_EDIT`.
    - Ícone megafone.
    - _Requirements: 4.1_

  - [ ] 10.2 Adicionar grupo "Suporte" com 2 sub-itens em `AdminSidebar.tsx`
    - "Tickets" → `/admin/suporte/tickets`. Permissão `SUPORTE_VIEW`.
    - "Chat" → `/admin/suporte/chat`. Permissão `SUPORTE_VIEW`.
    - Ícone life-buoy ou message-square.
    - Badge no item Tickets/Chat com count de não-lidas (opcional para Phase 1).
    - _Requirements: 7.4, 8.6_

  - [ ] 10.3 Roteamento em `AdminLayoutRoute.tsx`
    - Adicionar rotas `/admin/comunicados`, `/admin/suporte/tickets`, `/admin/suporte/tickets/:id`, `/admin/suporte/chat`.
    - Cada rota envolvida em `<AdminGuard permission="...">`.
    - _Requirements: 4.1, 8.6, 7.4_

- [ ] 11. Mobile, a11y e wiring
  - [ ] 11.1 Mobile: NotificationsModal já é responsivo
    - Validar tabs em viewport <768px (deve virar dropdown ou ícones-only).
    - _Requirements: 1.1_

  - [ ] 11.2 Mobile: AdminTicketsPage e AdminBroadcastPage
    - Tabela vira lista de cards single-column em <768px (padrão do projeto).
    - _Requirements: project-conventions_

  - [ ] 11.3 a11y: aria-labels nos botões de ação (resolver, responder, fechar modal)
    - _Requirements: project-conventions_

  - [ ] 11.4 a11y: foco no primeiro input ao abrir modal de form
    - _Requirements: project-conventions_

- [ ] 12. Checkpoint e validação fim-a-ponta
  - [ ] 12.1 Aplicar migration 041 em ambiente de dev
    - `supabase db push` ou aplicar manual.
    - Smoke: verificar tabelas, índices, triggers, RPCs criados via `\dt`, `\df`.
    - _Requirements: 1.1_

  - [ ] 12.2 `npx tsc --noEmit` passa sem erros
    - _Requirements: project-conventions_

  - [ ] 12.3 `npx vitest --run` passa todos os property tests + suites afetadas
    - CP-1 a CP-4 verdes.
    - _Requirements: CP-1, CP-2, CP-3, CP-4_

  - [ ] 12.4 `npx vite build` sem erros
    - _Requirements: project-conventions_

  - [ ] 12.5 Smoke manual ponta-a-ponta — fluxo Broadcast
    - Logar como admin, criar broadcast pra `motorista`, verificar que motorista logado vê a notif na aba Anúncios em realtime.
    - Repetir pra `embarcador`.
    - Tentar marcar "empresa" — checkbox desabilitado.
    - _Requirements: 4.x, 5.x_

  - [ ] 12.6 Smoke manual — fluxo Ticket de visitante
    - Acessar `/contato` deslogado, preencher form, submeter.
    - Confirmar `support_tickets` populada com `user_id=NULL`.
    - Confirmar admin recebeu notif `ticket_created`.
    - Admin responde, conferir email recebido em `guest_email` (ou que `email_sent_at` ficou populado).
    - _Requirements: 9.x_

  - [ ] 12.7 Smoke manual — fluxo Ticket de user logado
    - Logar como motorista, abrir `/tickets`, criar ticket.
    - Admin responde via `/admin/suporte/tickets/:id`.
    - Motorista recebe notif `ticket_replied` e abre o ticket.
    - Admin marca resolvido. Motorista recebe `ticket_resolved`.
    - _Requirements: 8.x_

  - [ ] 12.8 Smoke manual — fluxo Chat suporte
    - Logar como motorista, abrir `Falar com suporte` no Notifications_Modal.
    - Enviar mensagem.
    - Admin loga em `/admin/suporte/chat`, vê conversa, responde.
    - Motorista recebe notif `chat_support_admin_reply` em realtime.
    - Admin marca resolvida. Motorista envia nova mensagem → status volta a `aberta`.
    - _Requirements: 7.x_

  - [ ] 12.9 Smoke manual — Anti-bot do ticket público
    - Submeter form com campo honeypot preenchido via DevTools.
    - Confirmar resposta opaca `{ submitted: true }` mas `support_tickets` count = 0.
    - Submeter 6 tickets em <1h do mesmo IP — 6º deve ser rate-limited.
    - _Requirements: 9.3, 9.4_

  - [ ] 12.10 Validar audit logs
    - Conferir que cada mutação admin gerou linha em `admin_audit_logs` com action correto (`BROADCAST_CREATE`, `SUPORTE_REPLY`, `SUPORTE_TICKET_RESOLVE`, `SUPORTE_CHAT_REPLY`, `SUPORTE_CHAT_RESOLVE`, `SUPORTE_PUBLIC_TICKET_REPLY`).
    - _Requirements: 11.9_

  - [ ] 12.11 Validar Stealth_404 e gating
    - Logar como user comum (não-admin), tentar GET `/admin/comunicados` → deve renderizar `<Stealth404 />`.
    - Tentar chamar `rpc_create_broadcast` direto via Supabase JS client → permission_denied + log negativo `BROADCAST_VIEW_DENIED` em `admin_audit_logs`.
    - _Requirements: project-conventions, 4.6, 11.4_

  - [ ] 12.12 Documentação
    - Atualizar `docs/ROADMAP.md` marcando notifications-hub como entregue.
    - Adicionar seção "Notificações" em `docs/GUIA_TESTES_MANUAIS.md` com os smoke tests acima.
    - _Requirements: project-conventions_

## Notas e Pontos Em Aberto

### Feature relacionada (não escopo desta spec): mudar localização atual no header

> O usuário quer que ao clicar no chip de localização do header (que hoje só
> mostra cidade + temperatura) apareça também um botão **"Mudar localização"**.
> Ao clicar, abre input de busca + mapa pra selecionar uma cidade arbitrária.
> A localização escolhida vira a "localização ativa" do motorista, fazendo com
> que os fretes do raio sejam filtrados em torno dela ao invés do GPS atual.
>
> **Por que não está nesta spec:** essa funcionalidade é a base da **Ideia 01
> (Frete de Retorno Automático)** documentada em
> `.kiro/ideias/01-frete-retorno-automatico.md`. O fluxo de "mudar localização
> manualmente" é o pré-requisito visual e UX dela, e o motorista usa isso pra
> ver fretes de retorno a partir do destino do frete atual.
>
> **Ação:** quando a Ideia 01 virar spec própria (ex: `frete-retorno`), incluir
> o botão "Mudar localização" como Requisito 1 dessa nova spec. Por enquanto,
> registrar aqui apenas como pendência cruzada.
>
> Componentes envolvidos quando for implementar:
> - Estender `useGeolocation` com `setManualLocation(point, address?)` (já existe).
> - Adicionar entrada no dropdown do GPS no `AppHeader.tsx` ("Mudar localização")
>   abrindo modal com `<input>` de cidade + mapa Leaflet pra confirmar pin.
> - Persistir escolha em `localStorage['fretego-manual-location']` para sobreviver
>   ao reload, com botão "Voltar para GPS atual".
> - Garantir que `HomePage` leia a localização efetiva (manual OU GPS) sem
>   duplicar lógica.

### Phase 2 (futuro)
- Rascunho/agendamento de broadcast (`status='draft'`, `scheduled_for timestamptz`).
- Expiração de broadcast (`expires_at`).
- Anexos em ticket (storage bucket `support_attachments`).
- Categorização avançada de ticket (categoria + tags).
- Métricas: tempo médio de resposta, taxa de resolução, ranking de admins.
- Notificações push (web push API + service worker).

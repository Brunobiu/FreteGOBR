# Requirements — Histórico de Conversas da IA Supervisora

## Introdução

Hoje o chat do painel **Supervisor IA** (`/admin/supervisor`) é efêmero: as
mensagens vivem só no estado do React e somem ao recarregar. Esta feature
persiste as conversas e as expõe numa **lista lateral**, permitindo reabrir e
continuar uma conversa anterior.

Complementa a spec `admin-ia-supervisora` (migration 118). **Migration 119.**

### Decisões/Defaults aprovados

- **Persistência dirigida pelo frontend**: a página chama RPCs `append_message`
  após a pergunta do usuário e após a resposta da IA. A **edge function
  `ia-supervisor` NÃO muda** (evita redeploy; ela continua só respondendo).
- **Isolamento por dono**: cada admin só vê as próprias sessões
  (`admin_id = auth.uid()`), além do gate `SUPERVISOR_VIEW`.
- **Sem nova ação RBAC**: reusa `SUPERVISOR_VIEW` (já concedida a SUPER_ADMIN/ADMIN).
- **Sem PII**: `content` é sanitizado (reusa `sanitizeSupervisorDetail`/padrões)
  antes de persistir; título derivado da 1ª pergunta, truncado e sanitizado.
- Read-only quanto ao sistema: o histórico é apenas registro do chat; a IA segue
  sem executar ações.

## Glossário

- **Chat_Session**: uma conversa (linha em `supervisor_chat_sessions`): dono,
  título, timestamps.
- **Chat_Message**: uma mensagem (linha em `supervisor_chat_messages`): sessão,
  papel (`user`/`ai`), conteúdo, timestamp.
- **Title_Derivation**: regra determinística que deriva o título da sessão da 1ª
  mensagem do usuário (trunca em 80, colapsa espaços, sanitiza PII).

## Requirements

### Requirement 1 — Criar e listar sessões
**User Story:** Como admin, quero que minhas conversas fiquem salvas e listadas,
para reabrir uma anterior.

#### Acceptance Criteria
1. WHEN o admin envia a 1ª pergunta sem sessão ativa, THE sistema SHALL criar uma
   `Chat_Session` (dono = `auth.uid()`) e anexar a mensagem.
2. THE `supervisor_chat_sessions_list` SHALL retornar apenas as sessões do
   próprio admin, ordenadas por `updated_at` desc, depois `id` asc.
3. WHEN não há permissão `SUPERVISOR_VIEW` OR `auth.uid()` é nulo, THE RPC SHALL
   falhar com `permission_denied` (ERRCODE 42501).
4. THE título inicial da sessão SHALL ser derivado da 1ª mensagem do usuário
   (Title_Derivation); vazio ⇒ `'Nova conversa'`.

### Requirement 2 — Anexar e listar mensagens
1. THE `supervisor_chat_message_append(p_session, p_role, p_content)` SHALL
   inserir a mensagem se a sessão pertence ao caller; senão `permission_denied`.
2. THE `p_role` SHALL pertencer a `{'user','ai'}`; valor inválido ⇒ erro de
   validação (a precedência de `permission_denied` é preservada — Req 6).
3. THE `p_content` SHALL ser não-vazio e ≤ 8000 chars; THE conteúdo SHALL ser
   sanitizado (sem PII/segredos) na camada de service antes de persistir.
4. THE `supervisor_chat_messages_list(p_session)` SHALL retornar as mensagens da
   sessão (do dono) ordenadas por `created_at` asc, depois `id` asc.
5. WHEN uma mensagem é anexada, THE `updated_at` da sessão SHALL avançar.

### Requirement 3 — Renomear e excluir sessões (idempotente)
1. THE `supervisor_chat_session_rename(p_session, p_title)` SHALL atualizar o
   título (1..120 chars) da sessão do dono.
2. THE `supervisor_chat_session_delete(p_session)` SHALL excluir a sessão do dono
   (CASCADE nas mensagens). Excluir uma sessão inexistente/já-excluída ⇒
   resultado `{skipped:true}` (idempotente), não erro.
3. Excluir/renomear sessão de OUTRO admin ⇒ 0 linhas afetadas (RLS/escopo por
   dono); nunca vaza nem altera dados de terceiros.

### Requirement 4 — Isolamento e segurança (RLS)
1. THE RLS de `supervisor_chat_sessions`/`_messages` SHALL permitir SELECT apenas
   ao dono (`admin_id = auth.uid()`) sob `SUPERVISOR_VIEW`.
2. THE escrita direta (INSERT/UPDATE/DELETE) SHALL ser negada (somente via RPC
   SECURITY DEFINER).
3. anon e Cliente comum SHALL receber 0 linhas.

### Requirement 5 — UI (lista lateral + continuar conversa)
1. THE SupervisorChatPage SHALL exibir uma lista lateral das conversas do admin,
   com botão "Nova conversa".
2. WHEN o admin seleciona uma conversa, THE página SHALL carregar suas mensagens.
3. WHEN o admin pergunta, THE página SHALL persistir a mensagem do usuário e a da
   IA na sessão ativa (criando a sessão na 1ª pergunta).
4. THE degradação do chat ("IA indisponível") SHALL ser preservada.
5. THE página SHALL seguir o padrão compacto (sem `<h1>`) e o Stealth_404.

### Requirement 6 — Precedência de erro e governança
1. `permission_denied` SHALL ter precedência sobre validação simultânea (CP de
   precedência), no mapeamento de erro do service.
2. Falha de persistência do histórico NÃO SHALL quebrar o chat (a resposta da IA
   é exibida mesmo se o append falhar) — degradação graciosa.

## Correctness Properties (resumo; detalhe em design.md)
- **CP1 Title_Derivation determinístico e sem PII** (mesma entrada ⇒ mesmo
  título; nunca emite PII; trunca ≤ 80).
- **CP2 Ordenação total** de sessões (`updated_at` desc, `id`) e mensagens
  (`created_at` asc, `id`): antissimétrica/transitiva/estável.
- **CP3 Validação de mensagem** determinística e total (role fechado, content
  1..8000) com precedência de `permission_denied`.

## Reuso / dependências
- Reusa `SUPERVISOR_VIEW` (118), `is_admin_with_permission` (030),
  `sanitizeSupervisorDetail` (118), `executeAdminMutation`/`logAdminAction` (030),
  `mapSupervisorError`/`SupervisorError` (118).
- Depende de 030 (foundation) e 118 (supervisor) aplicadas.

## Não-objetivos
- Não altera a edge function `ia-supervisor` (persistência é frontend-driven).
- Não compartilha conversas entre admins. Sem busca full-text no v1.

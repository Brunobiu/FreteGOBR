# Design — Histórico de Conversas da IA Supervisora (migration 119)

## Arquitetura

```
SupervisorChatPage (UI)
  ├─ lista lateral: listChatSessions()  ──► supervisor_chat_sessions_list (RPC)
  ├─ ao abrir conversa: listChatMessages(s) ─► supervisor_chat_messages_list (RPC)
  ├─ ao perguntar:
  │    1. ensureSession() ─► supervisor_chat_session_create (se não houver ativa)
  │    2. appendChatMessage(s,'user',q) ─► supervisor_chat_message_append (RPC)
  │    3. askSupervisor(q)  ─► edge function ia-supervisor (INALTERADA)
  │    4. appendChatMessage(s,'ai',ans) ─► supervisor_chat_message_append (RPC)
  ├─ renomear: renameChatSession ─► supervisor_chat_session_rename
  └─ excluir:  deleteChatSession ─► supervisor_chat_session_delete
```

A **edge function não muda**: o frontend orquestra a persistência. Se um append
falhar, o chat continua (a resposta aparece); só o registro daquela mensagem se
perde (degradação graciosa — Req 6.2).

## Modelo de dados (migration 119)

### supervisor_chat_sessions
| coluna       | tipo        | notas |
|--------------|-------------|-------|
| id           | uuid PK     | gen_random_uuid() |
| admin_id     | uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE | dono = auth.uid() |
| title        | text NOT NULL DEFAULT 'Nova conversa' CHECK (char_length 1..120) | pt-BR, sem PII |
| created_at   | timestamptz NOT NULL DEFAULT now() | |
| updated_at   | timestamptz NOT NULL DEFAULT now() | trigger toca em UPDATE; append toca via RPC |

Índice: `(admin_id, updated_at DESC)`.

### supervisor_chat_messages
| coluna       | tipo        | notas |
|--------------|-------------|-------|
| id           | uuid PK     | |
| session_id   | uuid NOT NULL REFERENCES supervisor_chat_sessions(id) ON DELETE CASCADE | |
| role         | text NOT NULL CHECK (role IN ('user','ai')) | |
| content      | text NOT NULL CHECK (char_length 1..8000) | sanitizado na camada service |
| created_at   | timestamptz NOT NULL DEFAULT now() | |

Índice: `(session_id, created_at ASC)`.

### RLS (admin-only, por dono)
- `*_select_owner`: `FOR SELECT TO authenticated USING (is_admin_with_permission('SUPERVISOR_VIEW') AND admin_id = auth.uid())`.
  Mensagens: dono via join `EXISTS (SELECT 1 FROM supervisor_chat_sessions s WHERE s.id = session_id AND s.admin_id = auth.uid())`.
- `*_no_dml`: `FOR ALL TO authenticated USING (false) WITH CHECK (false)` (escrita só por RPC).

### RPCs SECURITY DEFINER (header padrão: `SET search_path=public`, gate auth.uid()+SUPERVISOR_VIEW, REVOKE/GRANT)
- `supervisor_chat_session_create(p_title text)` → `{id, title}`. Título: `COALESCE(NULLIF(trim,''),'Nova conversa')` truncado 120.
- `supervisor_chat_sessions_list()` → `{items}` (do dono; ORDER updated_at desc, id).
- `supervisor_chat_messages_list(p_session uuid)` → `{items}` (valida posse; ORDER created_at asc, id).
- `supervisor_chat_message_append(p_session uuid, p_role text, p_content text)` → `{id}`. Valida posse + role∈{user,ai} + content 1..8000; toca `updated_at` da sessão.
- `supervisor_chat_session_rename(p_session uuid, p_title text)` → `{ok}|{skipped}` (não-dono/inexistente ⇒ skipped).
- `supervisor_chat_session_delete(p_session uuid)` → `{ok}|{skipped:true,reason:'ALREADY_GONE'}` (idempotente; CASCADE).

Auditoria: `supervisor_chat_session_create`/`_delete` gravam audit (`SUPERVISOR_CHAT_SESSION_CREATED`/`_DELETED`) via INSERT guardado `IF v_caller IS NOT NULL`. Append NÃO audita (volume alto; é dado do próprio chat).

## Núcleo puro — `src/services/admin/supervisor/chatHistory.ts`
- `deriveTitle(firstUserMessage: string): string` — colapsa espaços, sanitiza PII
  (reusa `sanitizeSupervisorDetail` sobre `{t:msg}` ou padrões), trunca 80; vazio
  ⇒ `'Nova conversa'`. **Determinístico, total, sem PII** (CP1).
- `compareSessions(a,b)` — `updated_at` desc, `id` asc (CP2).
- `compareMessages(a,b)` — `created_at` asc, `id` asc (CP2).
- `validateMessage(role, content)` — `{ ok } | { code, message }`; role fechado,
  content 1..8000 (CP3).
- `CHAT_LIMITS` = { TITLE_MAX:120, CONTENT_MAX:8000, TITLE_DERIVE_MAX:80 }.

## Service — adições em `src/services/admin/supervisor.ts`
Tipos `SupervisorChatSession`/`SupervisorChatMessage` (snake_case). Funções:
`createChatSession`, `listChatSessions`, `listChatMessages`, `appendChatMessage`
(sanitiza content via `sanitizeSupervisorContent`), `renameChatSession`,
`deleteChatSession` (runSkippableMutation). Erros via `mapSupervisorError`
(precedência de permission_denied). `appendChatMessage` nunca lança ao chamador
do chat — o caller (página) faz `.catch(()=>null)`.

## Correctness Properties
- **CP1** (`cp1_chat_title.property.test.ts`): `deriveTitle` determinístico;
  `expectNoSecrets(deriveTitle(x))`; comprimento ≤ 80; só espaços ⇒ 'Nova conversa'.
- **CP2** (`cp2_chat_ordering.property.test.ts`): `compareSessions`/`compareMessages`
  ordem total (antissimétrica/transitiva/estável; permutação invariante).
- **CP3** (`cp3_chat_validation.property.test.ts`): `validateMessage` total;
  role∉{user,ai} ⇒ inválido; content vazio/>8000 ⇒ inválido; precedência de
  permission_denied no modelo do service (mapSupervisorError).

## Testing strategy
- Property (numRuns≥100) CP1–CP3 + `pureFunctions.unit` (exemplos/edge).
- Service test: mapError, listas + sanitização, append sanitiza content,
  delete `_SKIPPED`, audit-fail-não-bloqueia.
- UI test (harness manual, mirror supervisorUI): sidebar lista, "Nova conversa",
  selecionar carrega mensagens, perguntar persiste user+ai (spies), Stealth404,
  sem `<h1>`, degradação preservada, renomear/excluir.
- Integração (`tests/admin/supervisor/chat_history_*`): RLS por dono (outro admin
  não vê), gating 42501, append toca updated_at, delete idempotente CASCADE,
  rename/delete de não-dono = 0 linhas.

## Idioma / convenções
identifiers/SQL/action codes em inglês UPPER_SNAKE; UI/mensagens pt-BR.
Idempotente (admin-patterns §9); par `_rollback`.

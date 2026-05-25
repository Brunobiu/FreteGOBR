# Implementation Plan: admin-blacklist

## Overview

Plano incremental para entregar o módulo de Blacklist do painel administrativo do FreteGO, sentado em cima das fundações já em produção: `admin-foundation` (migration 030, `AdminProvider`, `AdminGuard`, `AdminShell`, `Permission_Matrix`, `executeAdminMutation`, `is_admin_with_permission`, `Stealth404`), `admin-users` (migration 031, padrão de versionamento otimista via `updated_at`, padrão de bulk com `Promise.allSettled` + concorrência 5, padrão de CSV BOM UTF-8 + `;` + RFC 4180, `users.is_active`/`users.ban_reason`/`users.banned_at`/`users.banned_by`), `admin-fretes` (migration 032, padrão de skip idempotente com audit log `_SKIPPED`, padrão de export client-side com truncamento 10000) e `embarcador-branch` (migration 033, `embarcadores.cnpj` consultado para auto-blacklist do tipo `cnpj`). Cada task referencia requisitos do `requirements.md` (Reqs X.Y) e propriedades de correção do `design.md` (CP-N). Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, docs auxiliares); sub-tasks sem asterisco são obrigatórias.

> **Nota de numeração:** A migration 034 está reservada por outra spec (`034_admin_notify_user.sql`). Esta spec usa **migration 035** em todos os arquivos e referências (`supabase/migrations/035_admin_blacklist.sql` e `supabase/migrations/035_admin_blacklist_rollback.sql`). O conteúdo técnico do `design.md` permanece válido — só a numeração mudou.

Convenções:

- Esta spec é continuação de `admin-foundation` + `admin-users` + `admin-fretes` + `embarcador-branch`. Toda dependência lá entregue (Provider, Guard, Shell, Sidebar, hooks, services, RPCs, padrões) é **reusada sem modificação**, exceto `AdminLayoutRoute` que recebe 3 rotas filhas novas e `users.ts` (`banUser`/`unbanUser`) que ganham parâmetros opcionais para auto-blacklist.
- Toda mutação passa por `executeAdminMutation`; nenhuma chamada direta a `.update`/`.delete`/`.insert` em `admin_blacklist` no service (apenas `select`). Toda mutação real acontece em RPC `SECURITY DEFINER` que valida `is_admin_with_permission` server-side.
- Stack: TypeScript + React + Supabase + fast-check + Vitest (já em uso no projeto).
- Property tests obrigatórios: 4.5 (CP-2, adicionar duplicada ativa é idempotente) e 10.4 (CP-1, phone na blacklist ativa sempre bloqueia signup/login/email). Os demais CPs (CP-3 normalize idempotente, CP-4 Permission_Matrix parity TS↔SQL) são opcionais conforme `requirements.md` § Padrões de Sucesso e `design.md` §13.
- Todo checkpoint (intermediário e final) garante: `npx tsc --noEmit` zero erros, `npx vitest run` verde, `npm run build` limpa.

## Tasks
- [x] 1. Migration 035 e contratos base de banco
  - [x] 1.1 Criar `supabase/migrations/035_admin_blacklist.sql`
    - Cabeçalho com objetivo, dependência de `001..033` (incluindo `030_admin_foundation`, `031_admin_users`, `033_embarcador_branch`), e nota explicando que `034_admin_notify_user` é spec independente — esta migration é a 035.
    - Envolver em `BEGIN; ... COMMIT;`. 3 blocos `DO $check$ ... $check$` defensivos validando: (a) `is_admin_with_permission(text)` existe (migration 030); (b) `admin_audit_logs` existe com colunas `admin_id`, `action`, `target_type`, `target_id`, `before_data`, `after_data`, `ip`, `user_agent` (migration 030); (c) `embarcadores.cnpj` existe (migration 033).
    - Cada bloco `DO` levanta `EXCEPTION` clara quando dependência ausente, abortando o `BEGIN`.
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 1.2 Criar tabela `admin_blacklist` com 12 colunas
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `type text NOT NULL CHECK (type IN ('phone','cpf','cnpj','email','ip_address'))`, `value text NOT NULL`, `reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 1000)`, `expires_at timestamptz NULL`, `source_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL`, `created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT`, `created_at timestamptz NOT NULL DEFAULT NOW()`, `updated_at timestamptz NOT NULL DEFAULT NOW()`, `removed_at timestamptz NULL`, `removed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL`, `removed_reason text NULL CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 1000)`.
    - `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
    - `COMMENT ON TABLE` e `COMMENT ON COLUMN` para `value`, `source_user_id`, `expires_at`.
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 1.3 Adicionar constraint `chk_admin_blacklist_remove_consistency`
    - `CHECK ((removed_at IS NULL AND removed_by IS NULL AND removed_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL))`.
    - Idempotente via `DROP CONSTRAINT IF EXISTS` antes de `ADD CONSTRAINT`.
    - _Requirements: 6.4, 17.3_

  - [x] 1.4 Criar índice único parcial e 5 índices secundários
    - `CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_blacklist_active_unique ON admin_blacklist (type, value) WHERE removed_at IS NULL` — reforça unicidade apenas entre entradas ativas (Req 4.11, CP-2).
    - `idx_admin_blacklist_type ON admin_blacklist(type)`.
    - `idx_admin_blacklist_created_at ON admin_blacklist(created_at DESC)`.
    - `idx_admin_blacklist_created_by ON admin_blacklist(created_by)`.
    - `idx_admin_blacklist_expires_at ON admin_blacklist(expires_at) WHERE expires_at IS NOT NULL AND removed_at IS NULL`.
    - `idx_admin_blacklist_source_user_id ON admin_blacklist(source_user_id) WHERE source_user_id IS NOT NULL AND removed_at IS NULL`.
    - Todos via `CREATE INDEX IF NOT EXISTS`.
    - _Requirements: 4.11, 17.3_

  - [x] 1.5 Adicionar 4 policies RLS via `is_admin_with_permission`
    - `admin_blacklist_select` (FOR SELECT) ⇒ `is_admin_with_permission('BLACKLIST_VIEW')`.
    - `admin_blacklist_insert` (FOR INSERT) ⇒ `is_admin_with_permission('BLACKLIST_MANAGE')` em WITH CHECK (defesa em profundidade — RPC já checa).
    - `admin_blacklist_update` (FOR UPDATE) ⇒ `is_admin_with_permission('BLACKLIST_MANAGE')` em USING e WITH CHECK.
    - `admin_blacklist_delete` (FOR DELETE) ⇒ `USING (false)` (DELETE físico nunca permitido via cliente; apenas soft delete via UPDATE).
    - Idempotente via `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 1.6 Criar funções puras `blacklist_normalize` e `blacklist_validate`
    - `blacklist_normalize(p_type text, p_raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER`: phone (digits-only + remove DDI 55 quando 12/13 dígitos), cpf/cnpj (digits-only), email (`lower(trim(...))`), ip_address (`trim`). `RAISE EXCEPTION` em tipo desconhecido. `GRANT EXECUTE TO anon, authenticated`.
    - `blacklist_validate(p_type text, p_value text) RETURNS text LANGUAGE plpgsql IMMUTABLE`: retorna `'OK'` ou mensagem `'INVALID_INPUT: ...'`. Phone 10/11 dígitos, CPF 11 + DV check + rejeita sequência repetida, CNPJ 14 + DV check + rejeita repetida, email regex + max 320 chars, IP IPv4 octetos 0..255 ou IPv6 hex+`:`. `GRANT EXECUTE TO authenticated`.
    - Both `REVOKE ALL FROM PUBLIC` antes do `GRANT`.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, CP-3_

  - [x] 1.7 Criar funções `is_blacklisted` e `log_blacklist_block`
    - `is_blacklisted(p_type text, p_value text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`: aplica `blacklist_normalize` server-side e consulta `admin_blacklist WHERE type = p_type AND value = <normalizado> AND removed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`. `GRANT EXECUTE TO anon, authenticated` (necessário para signup pré-login).
    - `log_blacklist_block(p_action text, p_type text, p_value text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER`: normaliza valor, busca `entry_id` (pode ser NULL se já removido), aplica rate limiting (mesmo IP só pode disparar 30 logs por minuto via `COUNT(*)` em `admin_audit_logs`; se exceder, retorna silenciosamente), mascara CPF/CNPJ no log (apenas 2 últimos dígitos), insere em `admin_audit_logs` com `admin_id = NULL`. `GRANT EXECUTE TO anon, authenticated`.
    - Both `REVOKE ALL FROM PUBLIC` antes do `GRANT`.
    - _Requirements: 9.4, 10.4, 11.4, 12.6, CP-1_

  - [x] 1.8 Criar 5 RPCs de mutação `SECURITY DEFINER`
    - `admin_blacklist_add(p_type, p_value, p_reason, p_expires_at, p_source_user_id) RETURNS jsonb`: valida `auth.uid()` + `is_admin_with_permission('BLACKLIST_MANAGE')`; aplica `blacklist_normalize` + `blacklist_validate`; checa proteção do Master_Admin (`SELECT users WHERE admin_username='Nexus_Vortex99'` e compara phone/cpf/cnpj/email — `RAISE 'MASTER_PROTECTED'`); INSERT capturando 23505 (unique violation parcial); em conflito, faz SELECT do `existing_id` para detectar `removed_at` e levanta `ALREADY_BLACKLISTED` com `DETAIL existing_id, status='active'|'removed'`. Retorna `jsonb_build_object('id', <uuid>)`.
    - `admin_blacklist_update(p_id, p_reason, p_expires_at, p_expected_updated_at) RETURNS jsonb`: valida permissão; faz `UPDATE ... WHERE id=$1 AND updated_at=p_expected_updated_at AND removed_at IS NULL`; se 0 linhas, faz SELECT para distinguir `STALE_VERSION` (updated_at diverge), `NOT_FOUND` ou `ALREADY_REMOVED`; senão retorna `{ updated: true, updated_at: <novo> }`.
    - `admin_blacklist_reactivate(p_id, p_reason, p_expires_at, p_expected_updated_at) RETURNS jsonb`: valida permissão; faz `UPDATE ... SET removed_at=NULL, removed_by=NULL, removed_reason=NULL, reason=p_reason, expires_at=p_expires_at, updated_at=NOW() WHERE id=$1 AND updated_at=p_expected_updated_at`; mesma distinção de erros do `update`. Retorna `{ reactivated: true, updated_at }`.
    - `admin_blacklist_remove(p_id, p_remove_reason) RETURNS jsonb`: valida permissão; pre-fetch `removed_at`; se já removida, retorna `{ skipped: true, reason: 'ALREADY_REMOVED' }` SEM UPDATE; senão faz `UPDATE ... SET removed_at=NOW(), removed_by=auth.uid(), removed_reason=p_remove_reason, updated_at=NOW()`; retorna `{ removed: true }`.
    - `admin_blacklist_remove_by_user(p_user_id) RETURNS jsonb`: valida permissão; faz `UPDATE ... SET removed_at=NOW(), removed_by=auth.uid(), removed_reason='auto-unblacklist via unban', updated_at=NOW() WHERE source_user_id=p_user_id AND removed_at IS NULL` capturando `ROW_COUNT`; retorna `{ removed_count: N }`.
    - Todas: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`. **Não** logam internamente; o log fica em `executeAdminMutation` na camada TS.
    - _Requirements: 4.10, 4.11, 4.13, 5.7, 5.8, 5.9, 6.5, 6.6, 8.7_

  - [x] 1.9 Criar 3 triggers
    - `users_blacklist_block` (BEFORE INSERT ON users FOR EACH ROW): consulta `is_blacklisted('phone', NEW.phone)`, `is_blacklisted('cpf', NEW.cpf)`, `is_blacklisted('email', NEW.email)`; em qualquer match, chama `log_blacklist_block('BLACKLIST_SIGNUP_BLOCKED', <tipo>, <valor>, ...)` e `RAISE EXCEPTION 'blacklisted_<tipo>'` para abortar o INSERT.
    - `embarcadores_blacklist_block` (BEFORE INSERT ON embarcadores FOR EACH ROW): consulta `is_blacklisted('cnpj', NEW.cnpj)`; em match, log + `RAISE EXCEPTION 'blacklisted_cnpj'`.
    - `admin_blacklist_set_updated_at` (BEFORE UPDATE ON admin_blacklist FOR EACH ROW): seta `NEW.updated_at = NOW()` quando `OLD.updated_at = NEW.updated_at` (suporta versionamento otimista chamando RPCs).
    - Idempotente via `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`.
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 1.10 Atualizar `is_admin_with_permission` para nova matriz
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)`: SUPORTE ganha `BLACKLIST_VIEW`; MODERADOR ganha `BLACKLIST_VIEW` + `BLACKLIST_MANAGE`; SUPER_ADMIN mantém `BLACKLIST_VIEW` + `BLACKLIST_MANAGE` + `BLACKLIST_BULK`.
    - **Remove** referência ao código antigo `BLACKLIST_EDIT` do SQL (existia apenas como reserva em `permissions.ts`); a `Permission_Matrix` TS o marca como `@deprecated` (task 2.1).
    - FINANCEIRO **não** ganha nada de blacklist.
    - _Requirements: 12.7, 12.8, CP-4_

  - [x] 1.11 Bloco `-- VERIFY` pós-deploy comentado
    - SELECTs documentando: tabela `admin_blacklist` existe com 12 colunas; constraint `chk_admin_blacklist_remove_consistency` ativa; 1 índice único parcial + 5 secundários; 4 policies RLS; 7 funções/RPCs (`blacklist_normalize`, `blacklist_validate`, `is_blacklisted`, `log_blacklist_block`, `admin_blacklist_add`, `admin_blacklist_update`, `admin_blacklist_reactivate`, `admin_blacklist_remove`, `admin_blacklist_remove_by_user`); 3 triggers; `is_admin_with_permission` retorna `true` para SUPORTE+`BLACKLIST_VIEW` e MODERADOR+`BLACKLIST_MANAGE`.
    - Comentado (`/* ... */`) — serve como smoke test executável manualmente após deploy.
    - _Requirements: 17.7_

  - [ ]* 1.12 Smoke test de idempotência da migration
    - Script ou doc em `supabase/migrations/_test_idempotency_035.sql` que aplica a migration 2x e valida que a segunda execução não falha e não duplica dados/policies/triggers.
    - _Requirements: 17.3_

  - [x] 1.13 Criar script de rollback `supabase/migrations/035_admin_blacklist_rollback.sql`
    - Documenta DROP de: 3 triggers, 5 RPCs, 2 funções `is_blacklisted`/`log_blacklist_block`, 2 funções `blacklist_normalize`/`blacklist_validate`, 4 policies, 6 índices, 1 constraint, tabela `admin_blacklist`.
    - Reverte alteração de `is_admin_with_permission` para versão da migration 032 (sem `BLACKLIST_*` novos).
    - **Não** é auto-aplicado; serve como referência para recovery.
    - _Requirements: 17.6_

- [x] 2. Permission_Matrix update e tipos puros do service
  - [x] 2.1 Atualizar `src/services/admin/permissions.ts`
    - Adicionar à enum `AdminAction`: `BLACKLIST_MANAGE` (substitui `BLACKLIST_EDIT` semanticamente) e `BLACKLIST_BULK` (importação em massa). Manter `BLACKLIST_VIEW` e `BLACKLIST_EDIT` como **`@deprecated`** com `/** @deprecated use BLACKLIST_MANAGE */` em comentário JSDoc; manter o valor para evitar quebra retroativa, mas não referenciado por novas políticas.
    - Atualizar `SUPORTE_PERMS` para incluir `BLACKLIST_VIEW`.
    - Atualizar `MODERADOR_PERMS` para incluir `BLACKLIST_VIEW` e `BLACKLIST_MANAGE` (sem `BLACKLIST_BULK`).
    - Atualizar `SUPER_ADMIN_PERMS` para incluir `BLACKLIST_VIEW` + `BLACKLIST_MANAGE` + `BLACKLIST_BULK`.
    - `FINANCEIRO_PERMS` permanece sem permissões de blacklist.
    - _Requirements: 12.7, 12.8, CP-4_

  - [x] 2.2 Criar `src/services/admin/blacklist.ts` parte 1 — tipos públicos
    - `BlacklistType = 'phone' | 'cpf' | 'cnpj' | 'email' | 'ip_address'`.
    - `BlacklistTypeFilter = BlacklistType | 'todos'`.
    - `BlacklistStatus = 'ativo' | 'expirado' | 'removido'`.
    - `BlacklistFilters` (com `DEFAULT_BLACKLIST_FILTERS` exportado): `{ type: BlacklistTypeFilter; status: 'todos'|'ativo'|'expirado'|'removido'; createdBy: string|null; from: string|null; to: string|null; q: string; sort: 'created_desc'|'created_asc'|'expires_asc'|'removed_desc'; page: number; pageSize: number; sourceUserId: string|null }`.
    - `BlacklistEntry` com 12 colunas + status derivado.
    - `BlacklistListResult { rows, total, page, pageSize }`.
    - `BlacklistSourceUser { id, name, type: 'motorista'|'embarcador', is_active, banned_at }`.
    - `BlacklistAttempt { id, created_at, action: 'BLACKLIST_LOGIN_BLOCKED'|'BLACKLIST_SIGNUP_BLOCKED'|'BLACKLIST_EMAIL_BLOCKED', ip, user_agent }`.
    - `BlacklistAuditEntry` (igual ao padrão `admin-fretes`).
    - `BlacklistDetailBundle { entry, creator, remover?, sourceUser?, attempts: { rows, total, page }, history, errors: Partial<Record<...>> }`.
    - Payloads: `BlacklistAddPayload`, `BlacklistUpdatePayload`, `BlacklistRemoveOptions`.
    - `BulkRemoveResult { success, skipped, failed, details }`.
    - `BulkImportRow { line, type, value, reason, expires_at, status: 'success'|'skipped'|'failed', error?, existing_id? }`.
    - `BulkImportResult { success, skipped, failed, details: BulkImportRow[] }`.
    - Classe `BlacklistServiceError extends Error` com 11 codes em `BlacklistErrorCode`: `INVALID_INPUT`, `ALREADY_BLACKLISTED`, `MASTER_PROTECTED`, `STALE_VERSION`, `NOT_FOUND`, `ALREADY_REMOVED`, `PERMISSION_DENIED`, `BULK_LIMIT_EXCEEDED`, `BLACKLISTED` (signup/login hit), `TIMEOUT` (RPC timeout fail-open), `RATE_LIMITED`. Cada erro pode carregar `extra: { existing_id?, removed?, type? }`.
    - Tabela de mensagens UI (pt-BR) por code, exportada como `BLACKLIST_ERROR_MESSAGES`.
    - Constantes canônicas: `GENERIC_LOGIN_MESSAGE = 'Não foi possível autenticar.'`, `GENERIC_SIGNUP_MESSAGE = 'Não foi possível concluir o cadastro.'`, `GENERIC_EMAIL_MESSAGE = 'Não foi possível enviar o código.'` (anti-enumeration, idênticas às mensagens existentes do app).
    - _Requirements: 4.6, 5.6, 6.6, 9.5, 10.5, 11.5, 14.1, 14.2_

  - [x] 2.3 Helpers puros e testáveis
    - `blacklistNormalize(type: BlacklistType, raw: string): string`: paridade com `blacklist_normalize` SQL (phone digits-only + remove DDI 55 quando 12/13 dígitos; cpf/cnpj digits-only; email `lower(trim)`; ip `trim`).
    - `blacklistValidate(type: BlacklistType, normalized: string): { ok: true } | { ok: false, reason: 'INVALID_INPUT', detail: string }`: paridade com `blacklist_validate` SQL.
    - `maskValueForList(type, value): string`: phone → `(XX) XXXXX-XXXX`/`(XX) XXXX-XXXX`; cpf → `***.***.***-XX`; cnpj → `**.***.***/****-XX`; email/ip → integral.
    - `classifyEntryStatus(entry): BlacklistStatus` — `removed_at` setado ⇒ `removido`; `expires_at <= now` ⇒ `expirado`; senão `ativo`.
    - `isUuid(s): boolean`.
    - `randomBlacklistDelayMs(): number` — inteiro aleatório no intervalo `[300, 600]`, anti-enumeration timing.
    - `withTimingParity<T>(p: Promise<T>, minMs?, maxMs?): Promise<T>` — aguarda `Math.max(elapsed, randomBlacklistDelayMs())` antes de resolver/rejeitar; usado nos hooks user-facing.
    - _Requirements: 1.5, 4.6, 14.4, 14.5, CP-3_

  - [x] 2.4 Helpers de CSV
    - `exportEntriesToCsvString(rows: BlacklistEntry[]): string`: cabeçalho fixo `id;type;value;reason;status;created_by_name;created_at;expires_at;removed_by_name;removed_at;source_user_id`; escape RFC 4180; separador `;`; BOM UTF-8 (`\uFEFF`).
    - `buildImportTemplateCsv(): string`: arquivo modelo com cabeçalho `type;value;reason;expires_at` + 1 linha de exemplo comentada via `#` ignorada pelo parser.
    - `parseImportCsv(text: string): { rows: BulkImportRow[]; headerOk: boolean; errors: string[] }`: aceita BOM + sep `;`, valida cabeçalho exato, suporta `expires_at` vazio = NULL, ignora linhas começadas com `#`.
    - `buildImportReportCsv(result: BulkImportResult): string`: cabeçalho `line;type;value;status;error;existing_id`; usado para botão de download em `BlacklistImportReport`.
    - _Requirements: 7.7, 7.8, 8.6_

  - [x] 2.5 URL ↔ filtros round-trip
    - `parseBlacklistFiltersFromQuery(qs: URLSearchParams): BlacklistFilters` — defaults aplicados a valores ausentes/inválidos; valida domínio fechado de `type`/`status`/`sort`; valida `from`/`to` em formato ISO date.
    - `serializeBlacklistFiltersToQuery(f: BlacklistFilters): URLSearchParams` — omite valores default para URL limpa.
    - _Requirements: 2.14, 2.15, 2.16_

- [x] 3. Service core: leituras (`blacklist.ts` parte 2)
  - [x] 3.1 `listEntries(filters: BlacklistFilters): Promise<BlacklistListResult>`
    - Aplica `Blacklist_Type_Filter`, `Blacklist_Status_Filter` (server-side: `ativo` ⇒ `removed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`; `expirado` ⇒ `removed_at IS NULL AND expires_at <= NOW()`; `removido` ⇒ `removed_at IS NOT NULL`), `createdBy` (eq), `Blacklist_Period_Filter` (`gte from + 'T00:00:00Z'`, `lte to + 'T23:59:59Z'`), `Blacklist_Search` (ILIKE em `value` e `reason`; quando termo é digit-only com `length >= 8`, casa adicionalmente contra `value` normalizado), `sourceUserId` (eq, usado pelo unban form), `Blacklist_Sort` e paginação.
    - Join com `users` (criador, removedor, source_user) para snapshots de nome.
    - Retorna `{rows, total, page, pageSize}`. `total` vem de `count: 'exact'`.
    - Execução com JWT do admin: RLS filtra silenciosamente quando o admin não tem `BLACKLIST_VIEW`.
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 12.1_

  - [x] 3.2 `getBlacklistDetail(id, attemptsPage): Promise<BlacklistDetailBundle>`
    - Valida `id` como UUID antes de chamar o banco; se inválido, lança `NOT_FOUND` (a página converte em Stealth 404).
    - Consolida 6 sub-queries via `Promise.allSettled`: entrada principal (fonte da verdade — falha aqui ⇒ `NOT_FOUND`), snapshot do criador, snapshot do removedor (se aplicável), snapshot do `source_user` (se aplicável; tipo `motorista`/`embarcador` derivado de `users.user_type`), tentativas paginadas 10/página em `admin_audit_logs WHERE action IN ('BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED','BLACKLIST_EMAIL_BLOCKED') AND target_type='admin_blacklist' AND target_id = :id`, histórico de mudanças em `admin_audit_logs WHERE action IN ('BLACKLIST_CREATED','BLACKLIST_UPDATED','BLACKLIST_REMOVED','BLACKLIST_REACTIVATED') AND target_type='admin_blacklist' AND target_id = :id`.
    - Cada bloco que falha registra em `bundle.errors[bloco]`; demais blocos continuam renderizando (degradação parcial).
    - Bloqueia retorno (lança `NOT_FOUND`) quando o registro principal não existe.
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.13_

  - [x] 3.3 `isBlacklisted(type: BlacklistType, valueRaw: string): Promise<boolean>` — wrapper user-facing
    - Invoca RPC `supabase.rpc('is_blacklisted', { p_type: type, p_value: valueRaw })`. A normalização acontece server-side; **não** chamamos `blacklistNormalize` TS antes para garantir paridade exata.
    - **Sem timeout interno** — o caller (LoginForm/RegisterForm/ModalVerificacaoEmail) é responsável por aplicar `Promise.race` com 3s e degradar fail-open. Manter timeout único na call site evita comportamento opaco.
    - _Requirements: 9.1, 10.1, 11.1_

  - [x] 3.4 `logBlacklistBlock(action, type, valueRaw, ip?, userAgent?): Promise<void>` — wrapper user-facing
    - Invoca RPC `supabase.rpc('log_blacklist_block', { p_action, p_type, p_value, p_ip, p_user_agent })`.
    - Erros são engolidos silenciosamente (logging best-effort; falha de log NÃO bloqueia o fluxo do usuário).
    - _Requirements: 9.4, 10.4, 11.4, 12.6_

  - [ ]* 3.5 Property test CP-3 (normalize idempotente) em `src/__tests__/admin/blacklist/cp3NormalizeIdempotent.property.test.ts`
    - **Property CP-3: blacklistNormalize é idempotente**
    - Para todo `(type, raw)`, `blacklistNormalize(type, blacklistNormalize(type, raw)) === blacklistNormalize(type, raw)`. Cobre os 5 tipos com geradores fast-check (incluindo telefones com prefixo 55, espaços/pontuação em CPF/CNPJ, emails com case misto, IPs com whitespace).
    - **Validates: Requirements 14.4, 14.5**

- [x] 4. Service core: mutações single (`blacklist.ts` parte 3)
  - [x] 4.1 `addEntry(payload: BlacklistAddPayload): Promise<{ id: string } | { existing_id: string; removed: boolean }>`
    - Validação local: `blacklistNormalize` + `blacklistValidate`; `reason` 1..1000 chars após `trim()` (lança `INVALID_INPUT`); `expires_at` opcional, se preenchido deve ser `> NOW()`; `source_user_id` opcional, se preenchido deve ser UUID válido.
    - `executeAdminMutation` com `action='BLACKLIST_CREATED'`, `target_type='admin_blacklist'`, `target_id` resolvido após sucesso (estratégia herdada do padrão de `users.ts::createUser`: log inicial sem `target_id`, depois `update target_id` no log gravado).
    - Invoca RPC `admin_blacklist_add(p_type, p_value, p_reason, p_expires_at, p_source_user_id)`.
    - **Fluxo duplicate-removed**: se RPC levanta `ALREADY_BLACKLISTED` com `DETAIL status='removed'`, o erro é decorado com `extra: { existing_id, removed: true }` e propagado. A UI usa esse flag para oferecer botão "Reativar" que chama `reactivateEntry` em vez de re-tentar `addEntry`. Audit log `BLACKLIST_CREATED_SKIPPED` com `after: { reason: 'ALREADY_BLACKLISTED', existing_id, status: 'removed' }`.
    - Em `ALREADY_BLACKLISTED status='active'`: erro decorado com `extra: { existing_id, removed: false }`; audit log `BLACKLIST_CREATED_SKIPPED` com `status: 'active'`. UI oferece link "Ver entrada existente".
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 14.1, 14.2, 16.1, CP-2_

  - [x] 4.2 `updateEntry(id, payload: BlacklistUpdatePayload, expectedUpdatedAt: string)`
    - Validação local de `reason` e `expires_at` (mesma de `addEntry`).
    - `executeAdminMutation` com `action='BLACKLIST_UPDATED'`, `before: { reason: <antigo>, expires_at: <antigo> }`, `after: { reason: <novo>, expires_at: <novo> }`.
    - Invoca RPC `admin_blacklist_update(p_id, p_reason, p_expires_at, p_expected_updated_at)`.
    - Distingue erros: `STALE_VERSION` (gera audit log `BLACKLIST_UPDATE_STALE_VERSION`), `NOT_FOUND`, `ALREADY_REMOVED` (modal exibe `Esta entrada foi removida. Recarregue a página.`).
    - Retorna `{ updated: true, updated_at }`.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 16.1, 16.2, 16.3_

  - [x] 4.3 `reactivateEntry(id, payload, expectedUpdatedAt)`
    - Variante de `updateEntry` que chama RPC `admin_blacklist_reactivate`. Reverte `removed_at = NULL`, `removed_by = NULL`, `removed_reason = NULL`, e atualiza `reason`/`expires_at` com os valores submetidos.
    - `executeAdminMutation` com `action='BLACKLIST_REACTIVATED'`, `before: { removed_at, removed_by, removed_reason, reason, expires_at }`, `after: { reason, expires_at, removed_at: null }`.
    - Distingue `STALE_VERSION`, `NOT_FOUND`.
    - Usado pelo `BlacklistAddModal` no fluxo "Reativar?" detectado via `extra.removed = true` em `addEntry`.
    - _Requirements: 4.13, 16.1_

  - [x] 4.4 `removeEntry(id, options: { reason?: string }): Promise<{ removed: true } | { skipped: true; reason: 'ALREADY_REMOVED' }>` — idempotente
    - Validação local: `options.reason` opcional, `<= 1000` chars (lança `INVALID_INPUT` quando excede).
    - Pre-fetch do `removed_at` atual.
    - Se já removida: `executeAdminMutation` com `action='BLACKLIST_REMOVED_SKIPPED'`, `after: { reason: 'ALREADY_REMOVED' }`, NÃO chama RPC, retorna skip.
    - Caso contrário: `executeAdminMutation` com `action='BLACKLIST_REMOVED'`, `before: <snapshot completo>`, `after: { removed_at: <ts>, removed_by: <admin_id>, removed_reason }` invoca RPC `admin_blacklist_remove(p_id, p_remove_reason)`.
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 14.5_

  - [x] 4.5 Property test CP-2 (adicionar duplicada ativa é idempotente) em `src/__tests__/admin/blacklist/cp2DuplicateIdempotent.property.test.ts`
    - **Property CP-2: addEntry sobre entrada ativa preexistente é idempotente**
    - Para toda `BlacklistEntry e` com `removed_at IS NULL` em `(type, value)`, executar `addEntry({ type: e.type, value: <qualquer raw normalizando para e.value>, reason: <novo>, ... })` falha com `BlacklistServiceError(ALREADY_BLACKLISTED)` carregando `extra.existing_id === e.id` e `extra.removed === false`. NÃO insere nova linha (mock conta `rpc.callCount === 1` via expectativa do conflito server-side, e `count(admin_blacklist) === count_inicial`). Gera exatamente 1 audit log `BLACKLIST_CREATED_SKIPPED`. Repetir `n ∈ [1, 5]` vezes preserva o estado e gera `n` logs `_SKIPPED`.
    - **Validates: Requirements 4.11, 4.12, 14.5**

- [x] 5. Service core: bulk + export (`blacklist.ts` parte 4)
  - [x] 5.1 `bulkRemove(ids: string[], options: { reason?: string }): Promise<BulkRemoveResult>`
    - Valida `ids.length <= 200`; senão lança `BULK_LIMIT_EXCEEDED`.
    - Valida `reason` <= 1000 chars (opcional).
    - Pool de concorrência 5 via `Promise.allSettled` (padrão herdado de `users.ts::bulkToggleActive` e `fretes.ts::bulkClose`).
    - Cada ID é processado por `removeEntry(id, options)`; resultado classificado em `success` (`removed: true`), `skipped` (`ALREADY_REMOVED`), `failed` (qualquer outro erro com mensagem capturada).
    - Cada operação gera 1 audit log próprio (single `BLACKLIST_REMOVED` ou `BLACKLIST_REMOVED_SKIPPED`); o bulk em si NÃO gera log agregado.
    - Retorna `{ success, skipped, failed, details: BulkRemoveDetail[] }`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.2 `bulkImport(rows: BulkImportRow[]): Promise<BulkImportResult>`
    - Valida `rows.length <= 1000`; senão lança `BULK_LIMIT_EXCEEDED`.
    - Pré-validação client-side por linha (`blacklistNormalize` + `blacklistValidate` + `reason` 1..1000 + `expires_at` futuro se presente). Linhas inválidas marcadas `failed` antes de qualquer mutação.
    - 1 audit log header `BLACKLIST_BULK_IMPORT` no início com `after: { total_rows, valid_count, invalid_count }`.
    - Pool de concorrência 5; cada linha válida chama `addEntry(payload)` core. Resultado por linha classificado: `success` (RPC retornou `id`), `skipped` (`ALREADY_BLACKLISTED` — duplicata ativa ou removida), `failed` (`MASTER_PROTECTED`, `INVALID_INPUT` server-side, ou erro desconhecido).
    - Cada `addEntry` interno gera seu próprio audit log (`BLACKLIST_CREATED` ou `BLACKLIST_CREATED_SKIPPED`); o header conta como log adicional para rastreabilidade da operação em massa.
    - Retorna `{ success, skipped, failed, details: BulkImportRow[] }` com motivo por linha.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 5.3 `exportCSV(filters: BlacklistFilters): Promise<{ csv: string; totalExported: number; truncated: boolean }>`
    - Reusa `listEntries(filters)` paginando até atingir 10000 linhas ou `total`.
    - Gera CSV via `exportEntriesToCsvString`; retorna `{ csv, totalExported, truncated: total > 10000 }`.
    - Dispara `executeAdminMutation` com `action='BLACKLIST_EXPORTED'`, `after: { filters, total_exported, requested_limit: 10000 }`.
    - _Requirements: 1.13_

- [x] 6. Componentes da listagem
  - [x] 6.1 `src/components/admin/blacklist/BlacklistFilters.tsx`
    - Padrão compacto/popover seguindo `UsersFilters.tsx` e `FretesFilters.tsx` recém-atualizados: botão de ícone (`SlidersHorizontal`) abre popover com os filtros; campo de busca livre permanece inline ao lado do botão.
    - Filtros no popover: dropdown `Tipo` (Todos/Telefone/CPF/CNPJ/E-mail/IP), dropdown `Status` (Todos/Ativos/Expirados/Removidos), dropdown searchable `Criado por` (consulta `users WHERE is_superuser=true` por `name|admin_username ILIKE`), 2 inputs `<input type="date">` `from`/`to`, dropdown `Ordenar` (`Mais recentes`/`Mais antigos`/`Expira em breve`/`Removidos recentes`).
    - Validação client-side: `from > to` ⇒ erro `Data inicial deve ser menor ou igual à final.` e NÃO dispara busca (Req 2.7).
    - `onChange` sempre reseta `page=1` (Req 2.13).
    - Busca `Blacklist_Search` debounced 300ms.
    - Labels via `htmlFor`/`id`; container com contador `Total: N entradas (filtradas)`.
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13_

  - [x] 6.2 `src/components/admin/blacklist/BlacklistTable.tsx`
    - Linha com checkbox bulk (gated por `BLACKLIST_MANAGE`), id curto (8 chars), badge de tipo (cor por valor), valor renderizado via `maskValueForList(type, value)`, motivo truncado em 60 chars + `…`, criado por (nome do admin), criado em, expira em (`—` quando NULL, data quando preenchido), badge de status (`Ativo`/`Expirado`/`Removido`).
    - `<th scope="col">` em todas as colunas; `<caption class="sr-only">Lista de entradas da blacklist do FreteGO</caption>`.
    - Atalhos: `↑/↓` navega, `Enter` abre detalhe, `Space` toggla checkbox.
    - `aria-label` em checkboxes (`Selecionar entrada [tipo] [valor mascarado]`); `aria-busy` no container quando `loading=true`.
    - Estado vazio com `role="status"` e mensagem `Nenhuma entrada encontrada com os filtros atuais.`.
    - _Requirements: 1.5, 1.8, 1.9, 1.10, 1.14, 7.1_

  - [x] 6.3 `src/components/admin/blacklist/BlacklistAddModal.tsx`
    - Dropdown `Tipo` (5 opções), campo `Valor` com placeholder e máscara dependentes do tipo selecionado, textarea `Motivo` (1..1000 com contador), date-picker `Expira em` (opcional, mínimo amanhã 00:00 UTC), input opcional `Identificador de origem (UUID do usuário)`.
    - Ao mudar `Tipo`, limpa `Valor` e atualiza máscara.
    - Aplica `blacklistNormalize` + `blacklistValidate` antes do submit; mensagens específicas por tipo.
    - Em `ALREADY_BLACKLISTED status='active'`: exibe banner `Já existe entrada ativa para este identificador.` + link `Ver entrada existente` para `/admin/blacklist/<existing_id>`.
    - Em `ALREADY_BLACKLISTED status='removed'` (fluxo `extra.removed = true`): exibe banner `Existe uma entrada anterior removida para este identificador. Deseja reativar?` + botão `Reativar` que chama `reactivateEntry(existing_id, ..., expectedUpdatedAt)` (faz GET prévio para capturar `expectedUpdatedAt`).
    - Em `MASTER_PROTECTED`: erro `Este identificador pertence ao administrador master e não pode ser bloqueado.`.
    - `role="dialog"`, `aria-modal="true"`, foco inicial em `Cancelar`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.12, 4.13, 4.14, 18.4_

  - [x] 6.4 `src/components/admin/blacklist/BlacklistEditModal.tsx`
    - Campos editáveis: `Motivo` (textarea, 1..1000), `Expira em` (date-picker, opcional, com botão `Limpar` para tornar permanente).
    - `Tipo` e `Valor` em readonly (imutáveis após criação).
    - Pré-preenche com `expectedUpdatedAt` capturado na abertura.
    - Em `STALE_VERSION`: banner com botão `Recarregar` que fecha o modal e força re-fetch do bundle.
    - Em `ALREADY_REMOVED`: banner `Esta entrada foi removida. Recarregue a página.` + desabilita botão de salvar.
    - `role="dialog"`, `aria-modal="true"`, foco inicial em `Cancelar`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 16.4, 18.4_

  - [x] 6.5 `src/components/admin/blacklist/BlacklistRemoveModal.tsx`
    - Textarea `Motivo da remoção` opcional (0..1000 com contador).
    - Botão `Confirmar remoção`; em skip (`ALREADY_REMOVED`), exibe toast neutro `Esta entrada já estava removida.` e fecha.
    - `role="dialog"`, foco inicial em `Cancelar`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 18.4_

  - [x] 6.6 `src/components/admin/blacklist/BlacklistBulkRemoveModal.tsx`
    - Visível na barra de bulk quando `selectedCount > 0` e admin tem `BLACKLIST_MANAGE`.
    - Textarea `Motivo` opcional (mesmo que será aplicado a todos os itens).
    - `disabled` quando `selectedCount > 200` com aviso `Máximo de 200 por operação.`.
    - Modal de progresso `[K] de [N] processados` durante execução.
    - Modal de resumo final `[K] removidos, [F] falhas, [S] já estavam removidos.` com link `Ver detalhes` listando ids/erros.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 7. Componentes do detalhe
  - [x] 7.1 `src/components/admin/blacklist/BlacklistEntryHeader.tsx`
    - Título com badge de tipo + valor mascarado (ou integral, conforme toggle do data block).
    - Botões `Editar` e `Remover` visíveis apenas quando `removed_at IS NULL` E admin tem `BLACKLIST_MANAGE`.
    - Botão `Reativar` visível apenas quando `removed_at IS NOT NULL` E admin tem `BLACKLIST_MANAGE`.
    - Botões **ocultos** (não desabilitados) quando admin não tem permissão.
    - _Requirements: 3.11, 3.12, 5.1, 6.1_

  - [x] 7.2 `src/components/admin/blacklist/BlacklistEntryDataBlock.tsx`
    - Campos: id completo, tipo, valor (renderizado conforme `maskValueForList`), motivo integral, expiração (`Permanente` quando NULL; data formatada quando preenchida; badge `Expirada em <data>` quando `expires_at <= NOW()`), status, criado por (nome + link `/admin/users/<criador.id>` se admin tem `USER_VIEW`), criado em.
    - Para `cpf`/`cnpj`: botão `Mostrar` ao lado do valor mascarado, visível apenas quando admin tem `BLACKLIST_MANAGE`. Click revela valor integral até o próximo render (sem audit log nesta spec, conforme tradeoff de §14 do design).
    - Bloco `Removida` aninhado, exibido apenas quando `removed_at IS NOT NULL`: removido por (nome + link), removido em, motivo de remoção (`Sem motivo informado` quando NULL).
    - _Requirements: 3.6, 3.7_

  - [x] 7.3 `src/components/admin/blacklist/BlacklistSourceUserBlock.tsx`
    - Visível apenas quando `source_user_id IS NOT NULL` E `bundle.sourceUser` foi resolvido.
    - Exibe nome do usuário, tipo (`motorista`/`embarcador`), status (`ativo`/`inativo`/`banido` derivado de `is_active`/`banned_at`).
    - Link `Ver perfil` para `/admin/users/<source_user_id>` (visível apenas se admin tem `USER_VIEW`).
    - Estado de erro isolado quando `bundle.errors.sourceUser` está presente.
    - _Requirements: 3.8_

  - [x] 7.4 `src/components/admin/blacklist/BlacklistAttemptsBlock.tsx`
    - Lista paginada 10/página, ordenada por `created_at DESC`.
    - Cada linha: data/hora formatada `dd/MM/yyyy HH:mm`, ação (`Login bloqueado`/`Cadastro bloqueado`/`E-mail bloqueado`), IP de origem, user agent truncado.
    - Bloco inteiro **gated por `AUDIT_VIEW`**: oculto se admin não tem essa permissão.
    - Estado de erro isolado.
    - _Requirements: 3.9_

  - [x] 7.5 `src/components/admin/blacklist/BlacklistAuditHistoryBlock.tsx`
    - Lista de `admin_audit_logs WHERE action IN ('BLACKLIST_CREATED','BLACKLIST_CREATED_SKIPPED','BLACKLIST_UPDATED','BLACKLIST_UPDATE_STALE_VERSION','BLACKLIST_REMOVED','BLACKLIST_REMOVED_SKIPPED','BLACKLIST_REACTIVATED') AND target_type='admin_blacklist' AND target_id=:id` ordenada por `created_at DESC`.
    - Cada linha: data/hora, nome do admin (resolvido via join), `action`, botão `Ver detalhes` que abre modal com `before_data` e `after_data` em JSON.
    - Bloco inteiro **gated por `AUDIT_VIEW`**: oculto se admin não tem essa permissão.
    - _Requirements: 3.10_

- [x] 8. Bulk import (página + componentes)
  - [x] 8.1 `src/pages/admin/blacklist/BlacklistBulkImportPage.tsx`
    - Rota `/admin/blacklist/bulk` protegida por `AdminGuard`; gated por `BLACKLIST_BULK` (`Stealth_404` se ausente).
    - Componente de upload (`<input type="file" accept=".csv">`) + botão `Baixar modelo CSV` que dispara `buildImportTemplateCsv()`.
    - Após upload, lê arquivo via `FileReader.readAsText(..., 'utf-8')`, chama `parseImportCsv`, renderiza `BlacklistImportPreview`.
    - Botão `Confirmar importação` chama `bulkImport(rows)`; durante execução exibe progresso `[K] de [N] processados`. Após conclusão, renderiza `BlacklistImportReport`.
    - Estado vazio inicial com instruções breves e link para o modelo.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 8.2 `src/components/admin/blacklist/BlacklistImportPreview.tsx`
    - Tabela com até 1000 linhas: número da linha, tipo, valor, motivo (truncado), expiração, status de pré-validação (`válido` / `inválido com motivo`).
    - Sumário no topo: `Total: N linhas, Válidas: V, Inválidas: I`.
    - Botão `Confirmar importação` desabilitado quando `V === 0`.
    - Aviso quando `N > 1000`: `Arquivo excede o limite de 1000 linhas. Apenas as 1000 primeiras serão processadas.`.
    - _Requirements: 8.3, 8.4_

  - [x] 8.3 `src/components/admin/blacklist/BlacklistImportReport.tsx`
    - Sumário pós-execução: `[K] sucesso, [S] já existiam (puladas), [F] falhas`.
    - Tabela com linhas `failed` e `skipped`: número da linha, tipo, valor, motivo do skip/erro, link `Ver entrada` para `existing_id` quando aplicável.
    - Botão `Baixar relatório CSV` que dispara download via `buildImportReportCsv(result)`.
    - _Requirements: 8.5, 8.6_

- [x] 9. Páginas e wiring
  - [x] 9.1 `src/pages/admin/blacklist/BlacklistListPage.tsx`
    - **Padrão herdado do cleanup recente em `UsersListPage` e `FretesListPage`**: SEM título `<h1>` grande no topo (a navegação do shell já identifica a página); filtros em popover via botão de ícone `SlidersHorizontal`; paginação com dropdown de tamanho de página (`10` / `50` / `100`) ao lado do botão `Exportar`; botões de ação compactos com classes `text-xs px-2.5 py-1`.
    - `useSearchParams` para sincronizar filtros com URL via `parseBlacklistFiltersFromQuery` / `serializeBlacklistFiltersToQuery`.
    - Compõe `BlacklistFilters` + `BlacklistTable` + barra de bulk com `BlacklistBulkRemoveModal`.
    - Botões topo direito (gating via `useAdminPermission`): `Adicionar entrada` (`BLACKLIST_MANAGE`), `Importar CSV` (`BLACKLIST_BULK`), `Exportar CSV` (`BLACKLIST_VIEW`).
    - Skeleton em `loading=true`; estado de erro com botão `Tentar novamente`.
    - Stealth 404 quando admin não tem `BLACKLIST_VIEW` (delegado ao `AdminGuard`).
    - Busca debounced 300ms apenas no campo `q`; demais filtros disparam imediatamente.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 2.7, 2.14, 2.15, 12.7_

  - [x] 9.2 `src/pages/admin/blacklist/BlacklistDetailPage.tsx`
    - Path param `:id`; valida UUID antes de chamar `getBlacklistDetail`; em inválido ou `NOT_FOUND`, renderiza `Stealth_404`.
    - Compõe os 5 blocos: `BlacklistEntryHeader` + `BlacklistEntryDataBlock` + `BlacklistSourceUserBlock` + `BlacklistAttemptsBlock` + `BlacklistAuditHistoryBlock` (cada um isolando seu estado de erro).
    - Gating de modais (`BlacklistEditModal`, `BlacklistRemoveModal`, fluxo de reativação reutilizando `BlacklistAddModal` em modo readonly nos campos de tipo/valor) via `useAdminPermission` + checagens locais por `removed_at`.
    - Após remove bem-sucedido, atualiza UI in-place sem reload (estado vai para `removido`); botão `Reativar` substitui `Editar`/`Remover`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 6.7, 6.8, 12.7, 15.1, 15.2, 15.3_

  - [x] 9.3 Atualizar `src/components/admin/AdminLayoutRoute.tsx`
    - Adicionar 3 rotas filhas dentro do bloco `<AdminGuard><AdminShell>...`: `blacklist` (lista) → `blacklist/bulk` → `blacklist/:id` (detalhe).
    - Importar `BlacklistListPage`, `BlacklistBulkImportPage` e `BlacklistDetailPage` de `src/pages/admin/blacklist/`.
    - **Atenção à ordem**: `blacklist` precisa vir antes de `blacklist/bulk`, que precisa vir antes de `blacklist/:id`. Caso contrário, o `:id` casaria com `bulk` e renderizaria a página errada.
    - _Requirements: 1.1, 3.1, 8.1, 15.4_

  - [ ]* 9.4 Test de roteamento em `src/__tests__/admin/blacklist/routing.test.tsx`
    - Garante que `blacklist` casa com `BlacklistListPage`, `blacklist/bulk` casa com `BlacklistBulkImportPage`, e `blacklist/<uuid>` casa com `BlacklistDetailPage`. Regressão da ordem das rotas.
    - _Requirements: 15.4_

- [x] 10. Hooks de bloqueio user-facing
  - [x] 10.1 Atualizar `src/components/LoginForm.tsx`
    - Antes de `supabase.auth.signInWithPassword`: chamar `withTimingParity(Promise.race([isBlacklisted('phone', phoneInputDigits), timeout3s]))` onde o `timeout3s` resolve `false` (fail-open).
    - Em hit (`true`): chamar `logBlacklistBlock('BLACKLIST_LOGIN_BLOCKED', 'phone', phoneInputDigits, ip?, ua?)` (best-effort, erro ignorado), aguardar `withTimingParity` (300..600ms), exibir `GENERIC_LOGIN_MESSAGE` (idêntica à mensagem de credencial inválida), retornar sem chamar o auth.
    - Em miss/timeout: prossegue para o auth normalmente; trigger `users_blacklist_block` é a barreira final.
    - Manter mensagem genérica em todos os caminhos de falha (credencial inválida, blacklist hit, erro de rede, timeout).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 10.2 Atualizar `src/components/RegisterForm.tsx`
    - Antes de `supabase.auth.signUp`: 4 chamadas paralelas a `isBlacklisted` para `phone`, `cpf` (motorista), `cnpj` (embarcador), `email`, agrupadas em `Promise.race([Promise.allSettled([...]), timeout3sTotal])` onde o timeout total é 3s.
    - Em qualquer match: para cada tipo matched, chamar `logBlacklistBlock('BLACKLIST_SIGNUP_BLOCKED', <type>, <value>, ip?, ua?)`; aguardar `withTimingParity`; exibir `GENERIC_SIGNUP_MESSAGE`; abortar fluxo.
    - Em todos miss / timeout: prossegue para o `signUp`; trigger é a barreira final.
    - **1 audit log por tipo matched** (não 1 agregado): a UI sumariza com mensagem genérica, mas o trail no banco é granular.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 10.3 Atualizar `src/components/ModalVerificacaoEmail.tsx`
    - Antes de chamar a função de envio do código (Supabase Edge Function ou equivalente): `withTimingParity(Promise.race([isBlacklisted('email', emailInput), timeout3s]))`.
    - Em hit: `logBlacklistBlock('BLACKLIST_EMAIL_BLOCKED', 'email', emailInput, ip?, ua?)`; aguardar `withTimingParity`; exibir `GENERIC_EMAIL_MESSAGE`; abortar.
    - Em miss/timeout: prossegue normalmente.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 10.4 Property test CP-1 (phone na blacklist sempre bloqueia) em `src/__tests__/admin/blacklist/cp1PhoneAlwaysBlocks.property.test.ts`
    - **Property CP-1: Phone em entrada ativa sempre bloqueia signup E login E email**
    - Para toda `BlacklistEntry e` com `e.type='phone'` E `e.removed_at IS NULL` E `(e.expires_at IS NULL OR e.expires_at > now)`:
      - cenário (a) login: mock `isBlacklisted('phone', e.value)` retorna `true`; `LoginForm` exibe `GENERIC_LOGIN_MESSAGE` E chama `logBlacklistBlock('BLACKLIST_LOGIN_BLOCKED', ...)` E NÃO chama `signInWithPassword`.
      - cenário (b) signup: mock `isBlacklisted('phone', e.value)` retorna `true` (demais tipos `false`); `RegisterForm` exibe `GENERIC_SIGNUP_MESSAGE` E chama `logBlacklistBlock('BLACKLIST_SIGNUP_BLOCKED', 'phone', ...)` E NÃO chama `signUp`.
      - cenário (c) negação por entrada expirada: para `e.expires_at <= now` (entrada expirada), mock retorna `false`; o fluxo prossegue normalmente para o auth — confirma que a property só vale enquanto a entrada está ATIVA.
    - Geradores fast-check produzem variações de phone com/sem prefixo 55, com/sem máscara, normalizando para o mesmo `e.value`.
    - **Validates: Requirements 9.1, 9.2, 9.4, 10.1, 10.2, 10.4, 11.1, 11.4, 14.4**

- [x] 11. Auto-blacklist no fluxo de ban (admin-users)
  - [x] 11.1 Estender `src/services/admin/users.ts::banUser`
    - Assinatura atualizada: `banUser(userId, payload, expectedUpdatedAt, options?: { addToBlacklist?: BanUserBlacklistItem[] })` onde `BanUserBlacklistItem = { type: 'phone'|'cpf'|'cnpj'|'email'; value: string }`.
    - Após o UPDATE de ban bem-sucedido (mesma transação lógica do `executeAdminMutation` de ban), itera `addToBlacklist` em paralelo com pool de concorrência 5, chamando `addEntry({ type, value, reason: <users.ban_reason herdado>, expires_at: null, source_user_id: userId })` para cada item.
    - Resultado por item: `inserted` (sucesso), `skipped` (`ALREADY_BLACKLISTED`), `failed` (capturado e contado, mas NÃO aborta os demais).
    - **Não aborta** o ban se algum addEntry falhar; a falha vira parte do retorno.
    - Retorna `{ user, blacklistResult?: { inserted: number; skipped: number; failed: number; details: Array<{ type, status, error? }> } }`.
    - _Requirements: 15.5, 15.6_

  - [x] 11.2 Estender `src/services/admin/users.ts::unbanUser`
    - Assinatura atualizada: `unbanUser(userId, expectedUpdatedAt, options?: { removeBlacklistEntries?: boolean })`.
    - Após o UPDATE de unban bem-sucedido, se `removeBlacklistEntries === true`, invoca RPC `admin_blacklist_remove_by_user(p_user_id)` via `executeAdminMutation` com `action='BLACKLIST_REMOVED_BY_USER'`, `before: { user_id, count_active }`, `after: { removed_count }`.
    - Retorna `{ user, blacklistRemoved?: number }` (count retornado pela RPC).
    - **Não aborta** o unban se a remoção em massa falhar.
    - _Requirements: 15.7, 15.8_

  - [x] 11.3 Atualizar `src/components/admin/users/BanUserForm.tsx` — modo ban
    - Adicionar checkbox `Adicionar identificadores à blacklist` (default unchecked, gated por `BLACKLIST_MANAGE`).
    - Quando marcado, expande lista com checkboxes pré-marcados para cada identificador disponível: `phone` (sempre), `cpf` (se motorista), `cnpj` (se embarcador), `email` (sempre). Cada checkbox individual pode ser desmarcado.
    - No submit, monta `BanUserBlacklistItem[]` apenas com os checkboxes ativos e passa para `banUser(..., { addToBlacklist })`.
    - Após sucesso, exibe toast `Usuário banido. N entrada(s) adicionada(s) à blacklist.` (omite quando `addToBlacklist` vazio).
    - _Requirements: 15.5, 15.6_

  - [x] 11.4 Atualizar `src/components/admin/users/BanUserForm.tsx` — modo unban
    - No mesmo form, no modo `unban`: adicionar checkbox `Remover entradas de blacklist vinculadas` (default unchecked, gated por `BLACKLIST_MANAGE`).
    - Ao lado do checkbox, exibir contador `[N] entradas ativas vinculadas`. Contagem obtida via query auxiliar `listEntries({ ...DEFAULT_BLACKLIST_FILTERS, sourceUserId: userId, status: 'ativo', pageSize: 1 })` cujo `.total` alimenta o contador.
    - No submit, passa `{ removeBlacklistEntries: <checkbox> }` para `unbanUser(...)`.
    - Após sucesso, exibe toast `Usuário desbanido. K entrada(s) removida(s) da blacklist.` (omite quando flag falsa).
    - _Requirements: 15.7, 15.8_

- [x] 12. Checkpoint intermediário
  - [x] 12.1 Ensure all tests pass, ask the user if questions arise
    - Rodar `npx tsc --noEmit` (zero erros).
    - Rodar `npx vitest --run` com pelo menos os testes obrigatórios verdes (4.5 CP-2 + 10.4 CP-1).
    - Rodar `npm run build` (build limpa).

- [x] 13. Validação fim a fim e migração
  - [ ]* 13.1 Roteiro E2E manual em `docs/admin-blacklist-e2e.md`
    - Sequência: aplicar migration 035 → login admin → `/admin/blacklist` (filtros, busca, sort, paginação, export CSV) → `/admin/blacklist/<id>` (5 blocos, edit com STALE_VERSION simulado, remove, reativação) → `/admin/blacklist/bulk` (template download, upload com 1 linha válida + 1 inválida + 1 duplicada, relatório CSV) → ban de usuário com `addToBlacklist=[phone,email]` → unban com `removeBlacklistEntries=true`.
    - Casos negativos: SUPORTE tentando INSERT direto via cliente Supabase ⇒ 0 linhas afetadas; MODERADOR sem `BLACKLIST_BULK` em `/admin/blacklist/bulk` ⇒ Stealth 404; tentar adicionar phone do Master_Admin ⇒ erro `MASTER_PROTECTED`; signup com phone blacklisted ⇒ `GENERIC_SIGNUP_MESSAGE` + audit log `BLACKLIST_SIGNUP_BLOCKED`; trigger bypass test (insert direto via service-role com phone blacklisted) ⇒ `RAISE EXCEPTION 'blacklisted_phone'`.

  - [x] 13.2 Aplicar migration `035_admin_blacklist.sql` em Supabase de desenvolvimento
    - Executar via psql ou Supabase Studio.
    - Rodar bloco `-- VERIFY` (descomentado pontualmente) e validar todos os SELECTs retornando esperado.
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.7_

  - [ ]* 13.3 Property test CP-4 (Permission_Matrix parity TS↔SQL) em `src/__tests__/admin/blacklist/cp4PermissionMatrixParity.property.test.ts`
    - **Property CP-4: Permission_Matrix determinística para BLACKLIST_***
    - Integração: gated por env var `RUN_SUPABASE_INTEGRATION=1`; em ambiente local conectado ao Supabase, executa `is_admin_with_permission` no banco para cada `(role, action) ∈ AdminRole × {BLACKLIST_VIEW, BLACKLIST_MANAGE, BLACKLIST_BULK}` e compara com `hasPermission` do TS, garantindo paridade exata. Verifica também que `BLACKLIST_EDIT` (deprecated) não está mais referenciado em nenhuma policy.
    - Skipa silenciosamente quando a env var não está setada.
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8**

  - [x] 13.4 Checkpoint final
    - `npx tsc --noEmit` zero erros.
    - `npm run build` limpa.
    - `npx vitest --run` todas as suítes verdes (opcionais skipadas se não implementadas; obrigatórias 4.5 CP-2 e 10.4 CP-1 verdes).
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, roteiros manuais e docs auxiliares). O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Sub-tasks 4.5 (CP-2, addEntry duplicada idempotente) e 10.4 (CP-1, phone na blacklist sempre bloqueia) **NÃO** levam asterisco — são property tests obrigatórios e bloqueiam merge conforme `requirements.md` § Padrões de Sucesso e `design.md` §13.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N) e os requisitos que ela valida.
- Migration 035 inclui rollback paralelo (`035_admin_blacklist_rollback.sql`) que documenta DROP de toda a estrutura criada, sem auto-aplicação.
- Padrões herdados sem modificação: `AdminProvider`/`AdminGuard`/`AdminShell`/`AdminSidebar` (admin-foundation), `executeAdminMutation` + audit-by-construction (admin-foundation), versionamento otimista via `updated_at` (admin-users), bulk com `Promise.allSettled` + concorrência 5 (admin-users/admin-fretes), skip idempotente com `_SKIPPED` (admin-fretes), CSV BOM UTF-8 + `;` + RFC 4180 (admin-users), padrão compacto de listagem com filtros em popover e paginação 10/50/100 (admin-users/admin-fretes pós-cleanup).
- O item `Blacklist` no `AdminSidebar` já está configurado em `admin-foundation` gated por `BLACKLIST_VIEW`; esta spec não toca o sidebar.
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.

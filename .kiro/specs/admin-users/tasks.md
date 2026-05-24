# Implementation Plan: admin-users

## Overview

Plano incremental para entregar o módulo de Gestão de Usuários do painel administrativo do FreteGO, sentado em cima da `admin-foundation` (migration 030, `AdminProvider`, `AdminGuard`, `AdminShell`, `Permission_Matrix`, `executeAdminMutation`, `is_admin_with_permission`). Cada task referencia requisitos do `requirements.md` (Reqs X.Y) e propriedades de correção do `design.md` (CP-N). Sub-tasks marcadas com `*` são opcionais (testes de propriedade, smoke tests, docs auxiliares); sub-tasks sem asterisco são obrigatórias.

Convenções:
- Esta spec é continuação de `admin-foundation`. Toda dependência lá entregue (Provider, Guard, Shell, Sidebar, hooks, services, RPC) é **reusada sem modificação**, exceto `AdminLayoutRoute` que recebe 3 rotas filhas.
- Toda mutação passa por `executeAdminMutation`; nenhum chamada direta a `.update`/`.delete`/`.insert` em `users.ts`.
- Stack: TypeScript + React + Supabase + fast-check + Vitest (já em uso no projeto).
- Property tests obrigatórios: 3.11 (CP-1, Master imutável) e 3.12 (CP-2, toggle idempotente). Os demais são opcionais.

## Tasks

- [ ] 1. Migration 031 e contratos base de banco
  - [x] 1.1 Criar `supabase/migrations/031_admin_users.sql`
    - Cabeçalho com objetivo, dependência de `001..030` e nota sobre triggers do Master_Admin.
    - Envolver em `BEGIN; ... COMMIT;`. Bloco `DO $check$` validando que `is_admin_with_permission` existe (migration 030 aplicada).
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NULL`, `banned_at TIMESTAMPTZ NULL`, `banned_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`.
    - `CHECK (chk_users_ban_consistency)`: `ban_reason` e `banned_at` andam juntos; `chk_users_ban_reason_length`: `char_length(ban_reason) <= 1000`.
    - `CREATE INDEX IF NOT EXISTS idx_users_banned ON users(id) WHERE ban_reason IS NOT NULL`.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 19.1, 19.2, 19.3, 19.5_

  - [x] 1.2 Adicionar 4 triggers de imutabilidade do Master_Admin e proteção do Last_Super_Admin
    - `users_master_admin_immutable_update` (BEFORE UPDATE em `users`): falha com `master_admin_immutable` quando a linha do Master tem `is_active`, `admin_username`, `is_superuser` ou `name` alterado.
    - `users_master_admin_immutable_delete` (BEFORE DELETE em `users`): falha quando a linha alvo tem `admin_username = 'Nexus_Vortex99'`.
    - `admin_roles_master_immutable` (BEFORE INSERT OR UPDATE em `admin_roles`): falha em qualquer tentativa de setar `revoked_at IS NOT NULL` em `(user_id = master, role = 'SUPER_ADMIN')`.
    - `last_super_admin_protected` (BEFORE UPDATE em `admin_roles`): adquire `pg_advisory_xact_lock` para serializar; falha com `last_super_admin_protected` quando a operação reduziria o conjunto de SUPER_ADMINs ativos a 0 distintos `user_id`.
    - _Requirements: 6.12, 10.3, 11.1, 11.2, 11.3, 11.4, 11.8_

  - [x] 1.3 Adicionar 3 RPCs (1 `STABLE`, 2 `SECURITY DEFINER`)
    - `count_active_super_admins() RETURNS integer STABLE` retorna `COUNT(DISTINCT user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN' AND revoked_at IS NULL`.
    - `admin_force_logout(p_user_id uuid) RETURNS jsonb SECURITY DEFINER`: valida `is_admin_with_permission('USER_EDIT')`, bloqueia Master, bloqueia self (`auth.uid()`), revoga refresh tokens em `auth.refresh_tokens`, retorna `{revoked_tokens: N}`.
    - `admin_delete_user(p_user_id uuid, p_cancel_active_fretes boolean) RETURNS jsonb SECURITY DEFINER`: valida `is_admin_with_permission('USER_DELETE')`, bloqueia Master, bloqueia self, em uma transação `UPDATE fretes SET status='cancelado'` (se `p_cancel_active_fretes`) e `DELETE FROM users WHERE id = p_user_id`, retorna `{deleted: true, cancelled_fretes: N}`.
    - _Requirements: 6.5, 6.10, 8.3, 8.4, 8.5, 8.6, 10.4, 10.5_

  - [x] 1.4 Adicionar 12 policies RLS adicionais via `is_admin_with_permission`
    - `users_admin_select` / `users_admin_update` / `users_admin_delete`.
    - `motoristas_admin_select`, `embarcadores_admin_select`, `documents_admin_select`, `notifications_admin_select`, `chat_messages_admin_select` (apenas SELECT, mapeados a `USER_VIEW`).
    - 4 policies extras de `motoristas_admin_update`, `embarcadores_admin_update`, `documents_admin_update`, `documents_admin_delete` quando aplicável a `USER_EDIT`/`USER_DELETE`.
    - Idempotente via `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`.
    - Preservar policies do app comum (`auth.uid() = user_id`) intactas.
    - Garantir que `admin_audit_logs` permanece imutável (UPDATE/DELETE = false).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [-] 1.5 Bloco `-- VERIFY` pós-deploy
    - SELECTs que validam: presença das 3 colunas novas em `users`, presença dos 4 triggers, presença das 3 RPCs, presença das 12 policies novas.
    - Os SELECTs servem como smoke test executável manualmente após o deploy.
    - _Requirements: 19.7_

  - [ ]* 1.6 Smoke test de idempotência da migration
    - Script ou doc rápido em `supabase/migrations/_test_idempotency_031.sql` que aplica a migration 2x e valida que a segunda execução não falha e não duplica dados.
    - _Requirements: 19.3, 19.6_

  - [x] 1.7 Criar script de rollback `supabase/migrations/031_admin_users_rollback.sql`
    - Documenta DROP de triggers, RPCs, policies novas e ALTER TABLE para remover colunas.
    - **Não** é auto-aplicado; serve como referência para recovery.
    - _Requirements: 19.6_

- [ ] 2. Service core: `src/services/admin/users.ts` — parte 1 (helpers puros + leituras)
  - [x] 2.1 Tipos públicos exportados
    - `UserType`, `UserTypeFilter`, `UserStatusFilter`, `UserSort`, `UsersFilters`, `UserRow`, `UsersListResult`, `UserDocument`, `UserFreteRow`, `UserRatingRow`, `UserChatMetadata`, `UserDetailBundle`, `BulkResult`, `BulkSkipReason`, `EditUserPayload`, `AdminUserRow`.
    - Classe `UsersServiceError extends Error` com 11 codes do `UsersErrorCode`: `MASTER_ADMIN_IMMUTABLE`, `SELF_ACTION_FORBIDDEN`, `STALE_VERSION`, `LAST_SUPER_ADMIN_PROTECTED`, `NO_RECOVERY_CHANNEL`, `PHONE_ALREADY_USED`, `EMAIL_ALREADY_USED`, `NOT_FOUND`, `PERMISSION_DENIED`, `BULK_LIMIT_EXCEEDED`, `INVALID_INPUT`.
    - Tabela de mensagens UI (pt-BR) por code, exportada como `USERS_ERROR_MESSAGES`.
    - _Requirements: 4.7, 4.8, 5.6, 5.7, 5.8, 5.9, 6.7, 6.8, 7.4, 12.11, 17.3_

  - [x] 2.2 Helpers puros e testáveis
    - `classifyUserStatus(u): 'ativo' | 'inativo' | 'banido'` (Req 18.4).
    - `normalizeDigits(s)`: remove tudo exceto `\d`.
    - `isMasterAdmin(u)`: `u.admin_username === 'Nexus_Vortex99'`.
    - `csvField(s)`: escape RFC 4180 (aspas duplas + duplicação interna quando contém `,`, `"`, `\n`, `\r`).
    - `exportUsersToCsvString(rows)`: cabeçalho fixo `id,user_type,name,phone,email,cpf_or_cnpj,company_name,is_active,created_at,last_activity_at`.
    - `parseUsersFiltersFromQuery(qs)` / `serializeUsersFiltersToQuery(f)`: round-trip; defaults aplicados a valores ausentes/inválidos.
    - `escapeOr(s)`: escape de caracteres `,` em PostgREST `.or()` para evitar injeção em busca.
    - _Requirements: 2.4, 2.5, 2.9, 2.11, 14.3, 14.4, 18.4_

  - [x] 2.3 `listUsers(filters)` — leitura paginada
    - Aplica `User_Type_Filter`, `User_Status_Filter`, `User_Search` (ILIKE no `users` + `embarcadores.company_name`, com fallback a `normalizeDigits` quando `q` é numérico ≥ 8 dígitos), `User_Sort` e paginação 25/página.
    - Retorna `{rows, total, page, pageSize}`. `total` vem de `count: 'exact'` na query do Supabase.
    - Execução com JWT do admin: RLS filtra silenciosamente quando o admin não tem `USER_VIEW`.
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 13.7, 13.8_

  - [x] 2.4 `getUserDetail(id)` — bundle agregado com degradação parcial
    - Valida `id` como UUID v4 antes de chamar o banco; se inválido, lança `NOT_FOUND` (a página converte em Stealth 404).
    - Consolida 6 blocos via `Promise.allSettled`: cadastro (fonte da verdade), localização, documentos, fretes (motorista=`frete_clicks`+join, embarcador=`fretes`), avaliações, chat metadata.
    - Cada bloco que falha é registrado em `bundle.errors[bloco]`; os demais blocos continuam renderizando.
    - Bloqueia retorno (lança `NOT_FOUND`) quando o registro principal não existe ou tem `user_type = 'admin'`.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 16.3, 16.4_

  - [ ]* 2.5 Property test CP-6 (filtros round-trip via URL) em `src/__tests__/admin/users/filtersRoundTrip.property.test.ts`
    - **Property CP-6: Round-trip de filtros via URL**
    - Para todo `f: UsersFilters` válido, `parseUsersFiltersFromQuery(serializeUsersFiltersToQuery(f))` é deep-equal a `f`.
    - **Validates: Requirements 2.9, 2.10, 2.11**

  - [ ]* 2.6 Property test CP-11 (status classification) em `src/__tests__/admin/users/statusClassification.property.test.ts`
    - **Property CP-11: User_Status_Filter classifica corretamente**
    - Para todo `User_Row`, exatamente uma de `ativo`, `inativo`, `banido` casa.
    - **Validates: Requirements 18.4**

  - [ ]* 2.7 Property test CP-7 (CSV round-trip RFC 4180) em `src/__tests__/admin/users/csvRoundTrip.property.test.ts`
    - **Property CP-7: CSV export respeita RFC 4180**
    - Para toda lista `L: UserRow[]` com strings arbitrárias (incluindo `,`, `"`, `\n`, `\r`), `parseCsv(exportUsersToCsvString(L))` é deep-equal a `L`; cada linha tem 10 campos.
    - **Validates: Requirements 14.3, 14.4**

  - [ ]* 2.8 Property test CP-10 (search normaliza telefone/CPF) em `src/__tests__/admin/users/searchNormalization.property.test.ts`
    - **Property CP-10: Search normaliza telefone e CPF**
    - Para toda string `q` numérica ≥ 8 dígitos, busca com máscara e sem máscara retornam o mesmo conjunto.
    - **Validates: Requirements 2.4, 2.5**

- [ ] 3. Service core: `src/services/admin/users.ts` — parte 2 (mutações)
  - [x] 3.1 Helper `applyVersionedUpdate(table, id, patch, expectedUpdatedAt, action)`
    - Wraps a query Supabase com `WHERE id = $1 AND updated_at = $2`; se `count = 0`, lança `STALE_VERSION` e gera audit log `{action}_STALE_VERSION` via `executeAdminMutation`.
    - Retorna a linha atualizada quando `count = 1`.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 3.2 `toggleActive(id, targetState, expectedUpdatedAt)`
    - Pre-checks: `isMasterAdmin` ⇒ `MASTER_ADMIN_IMMUTABLE`; `id === self` ⇒ `SELF_ACTION_FORBIDDEN`.
    - `executeAdminMutation('USER_TOGGLE_ACTIVE', payload, () => applyVersionedUpdate(...))`.
    - Idempotente: se já no `targetState`, segue o mesmo fluxo, mas nenhuma linha real muda no banco (CP-2).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 17.5_

  - [x] 3.3 `banUser(id, reason, expectedUpdatedAt)` e `unbanUser(id, expectedUpdatedAt)`
    - `banUser`: `executeAdminMutation('USER_BAN', ...)` com `is_active=false`, `ban_reason`, `banned_at=NOW()`, `banned_by=admin_id` em uma única chamada.
    - `unbanUser`: `executeAdminMutation('USER_UNBAN', ...)` zerando `ban_reason`, `banned_at`, `banned_by` e setando `is_active=true`.
    - Reusa pre-checks de Master/self.
    - _Requirements: 18.5, 18.6, 18.7, 18.8_

  - [x] 3.4 `editUser(id, data, expectedUpdatedAt)`
    - Validação zod-like dos campos (`name` 3..255, `email` RFC 5322, `phone` `^\+?\d{10,15}$` após normalização, `cpf` 11 dígitos com módulo 11, `cnpj` 14 dígitos com módulo 11, `company_name` obrigatório se embarcador).
    - Pre-checks Master/self.
    - `executeAdminMutation('USER_EDIT', ...)` que aplica versioned update em `users` e em `motoristas`/`embarcadores`.
    - Catch de unique violation: classifica em `PHONE_ALREADY_USED` ou `EMAIL_ALREADY_USED` conforme constraint name.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 17.1, 17.2, 17.3_

  - [x] 3.5 `deleteUser(id, options)` via RPC `admin_delete_user`
    - Pre-checks Master/self.
    - Validação local: `confirmedName === user.name` e `cancelActiveFretes` consistente.
    - `executeAdminMutation('USER_DELETE', ...)` que invoca `supabase.rpc('admin_delete_user', { p_user_id, p_cancel_active_fretes })`.
    - Retorna `{ deleted: true, cancelledFretes }`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [x] 3.6 `requestPasswordReset(id)` com obfuscação no audit
    - Pre-check Master.
    - Detecta canal: email ⇒ `auth.admin.generateLink({type:'recovery'})`; senão SMS; senão `NO_RECOVERY_CHANNEL`.
    - `executeAdminMutation('USER_PASSWORD_RESET_REQUESTED', ...)` com `after_data = { channel, target_email_obfuscated, target_phone_obfuscated }` (substitui meio por `***`).
    - Não armazena nem expõe o token gerado.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 3.7 `forceLogout(id)` via RPC `admin_force_logout`
    - Pre-checks Master/self (defesa em profundidade; o RPC também bloqueia).
    - `executeAdminMutation('USER_FORCE_LOGOUT', ...)` invocando o RPC; retorna `{revokedTokens}`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 3.8 `bulkToggleActive(ids, targetState)` — concorrência limitada
    - Valida `ids.length <= 200`; senão lança `BULK_LIMIT_EXCEEDED`.
    - Para cada id: pula com motivo se Master, self ou já no `targetState` (gera audit log `USER_TOGGLE_ACTIVE_SKIPPED` por skip).
    - Executa o restante em `Promise.allSettled` com pool de concorrência 5; cada sucesso/falha vira 1 audit log próprio.
    - Retorna `BulkResult { success, skipped, failed }`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 17.6_

  - [x] 3.9 `exportUsersCSV(filters)` — client-side com truncamento
    - Reusa `listUsers(filters)` paginando até atingir 10000 linhas ou `total`.
    - Gera CSV via `exportUsersToCsvString`, retorna `{csv, totalExported, truncated}` (truncated quando `total > 10000`).
    - Dispara `executeAdminMutation('USERS_EXPORT', ...)` com `after = { filters, total_exported, requested_limit: 10000 }`.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 3.10 `listAdmins()` — join com último login de `admin_audit_logs`
    - Retorna `AdminUserRow[]` com nome, `admin_username`, `is_active`, `is_superuser`, `roles[]` (de `admin_roles WHERE revoked_at IS NULL`), `is_master`, `last_login_at` (subquery em `admin_audit_logs WHERE action = 'ADMIN_LOGIN_SUCCESS'`).
    - _Requirements: 9.4, 9.5, 9.6_

  - [x] 3.11 Property test CP-1 (Master_Admin é imutável) em `src/__tests__/admin/users/masterImmutable.property.test.ts`
    - **Property CP-1: Master_Admin é imutável**
    - Para toda `AdminAction a ∈ {USER_TOGGLE_ACTIVE, USER_EDIT, USER_DELETE, USER_FORCE_LOGOUT, USER_PASSWORD_RESET_REQUESTED}` e todo `Target_User u` com `admin_username = 'Nexus_Vortex99'`, `Users_Service.<mutação>(u.id, ...)` falha com `MASTER_ADMIN_IMMUTABLE` antes de qualquer chamada ao banco (asserção via spy no cliente Supabase).
    - **Validates: Requirements 4.7, 5.8, 6.7, 7.7, 8.5, 11.1, 11.5**

  - [x] 3.12 Property test CP-2 (toggle idempotente) em `src/__tests__/admin/users/toggleIdempotent.property.test.ts`
    - **Property CP-2: Toggle ativo→ativo é idempotente**
    - Para todo `userId` válido (não-Master, não-self) e todo `targetState ∈ {true, false}`, executar `toggleActive(userId, targetState)` duas vezes consecutivas produz o mesmo estado final em `users.is_active`. A segunda chamada gera audit log mas o `UPDATE` afeta 0 linhas.
    - **Validates: Requirements 4.5, 4.6, 4.9, 17.6**

  - [ ]* 3.13 Property test CP-9 (versionamento otimista) em `src/__tests__/admin/users/optimisticVersion.property.test.ts`
    - **Property CP-9: Versionamento otimista detecta concorrência**
    - Para toda sequência `[t1, t2]` com `t1 < t2`, `editUser(u, expectedUpdatedAt=t1)` quando o banco já tem `updated_at=t2` falha com `STALE_VERSION` e o registro permanece inalterado.
    - **Validates: Requirements 17.1, 17.2, 17.3**

  - [ ]* 3.14 Property test CP-8 (bulk pula Master e self) em `src/__tests__/admin/users/bulkSkip.property.test.ts`
    - **Property CP-8: Bulk action pula Master e self**
    - Para toda lista `userIds` que inclua `master_id` e/ou `self_id`, `bulkToggleActive(userIds, targetState)` retorna `S >= |{ids ∈ {master, self}}|` em `skipped`, e `users.is_active` desses dois IDs permanece inalterado.
    - **Validates: Requirements 12.8, 12.11**

  - [ ]* 3.15 Property test CP-3 (audit by construction) em `src/__tests__/admin/users/auditByConstruction.property.test.ts`
    - **Property CP-3: Toda mutação gera exatamente 1 audit log**
    - Para toda mutação bem-sucedida, há exatamente 1 registro novo em `admin_audit_logs`; em falha pós-log, há 1 original + 1 `_ROLLBACK`.
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6**

- [ ] 4. Componentes da listagem
  - [x] 4.1 `src/components/admin/users/UsersFilters.tsx`
    - Dropdown `User_Type_Filter` (Todos/Motorista/Embarcador), dropdown `User_Status_Filter` (Todos/Ativo/Inativo/Banido), input `User_Search` com debounce 300ms, dropdown `User_Sort`.
    - `onChange` sempre reseta `page=1` (exceto mudança apenas de `pageSize`).
    - Labels associados via `htmlFor`/`id`; container com contador `Total: N usuários (filtrados)`.
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 20.1, 20.2_

  - [x] 4.2 `src/components/admin/users/UsersTable.tsx`
    - Linha com checkbox bulk (oculto se `canSelect=false` ou se `isMasterAdminId(id)` ou `isSelfId(id)`), foto, nome, tipo, telefone, email, status, datas.
    - `<th scope="col">` em todas as colunas; `<caption class="sr-only">Lista de usuários do FreteGO</caption>`.
    - Atalhos de teclado: `↑/↓` navega, `Enter` abre detalhe, `Space` toggla checkbox.
    - `aria-label` em checkboxes (`Selecionar usuário [nome]`); `aria-busy` no container quando `loading=true`.
    - Estado vazio com `role="status"` e mensagem `Nenhum usuário encontrado com os filtros atuais.`.
    - _Requirements: 1.5, 1.8, 1.9, 12.1, 12.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8_

  - [x] 4.3 `src/components/admin/users/UsersBulkBar.tsx`
    - Barra fixa no topo quando `selectedCount > 0`, com botões `Ativar selecionados`, `Desativar selecionados`, `Limpar seleção`, contador `[N] selecionados`.
    - `disabled` quando `selectedCount > 200` com aviso `Máximo de 200 por operação.`.
    - Modal de progresso `[K] de [N] processados` durante execução.
    - Modal de resumo final `[K] sucesso, [F] falhas, [S] pulados.` com link `Ver detalhes` listando pulados/falhos.
    - _Requirements: 12.3, 12.4, 12.7, 12.9, 12.11_

- [ ] 5. Componentes do detalhe
  - [x] 5.1 `src/components/admin/users/UserDetailHeader.tsx`
    - Foto, nome, tipo, telefone, email, CPF/CNPJ, datas, badge de status.
    - Botões de ação (`Editar`, `Desativar`/`Ativar`, `Banir`, `Reset senha`, `Forçar logout`, `Excluir`) com gating via `useAdminPermission` + checagens locais (Master/self).
    - Botões ocultos (não desabilitados) quando o admin não tem permissão ou o target é Master/self.
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 5.1, 6.1, 6.2, 7.1, 8.1, 11.6_

  - [x] 5.2 `src/components/admin/users/UserDocumentsBlock.tsx`
    - Lista os registros de `documents` por tipo; gera signed URL **sob demanda** ao clicar `Ver` (TTL 10min).
    - Renderiza estado de erro do bloco isoladamente (`bundle.errors.documents`).
    - Para motorista: CNH, ANTT, vehicle_documents, foto. Para embarcador: CNPJ, logo.
    - _Requirements: 3.6, 3.7, 3.8, 3.14_

  - [x] 5.3 `src/components/admin/users/UserFretesBlock.tsx`
    - Paginação 10/página.
    - Embarcador: `fretes WHERE embarcador_id` com origin/destination/status/created_at.
    - Motorista: `frete_clicks WHERE motorista_id` join `fretes` com clicked_at.
    - Estado de erro isolado.
    - _Requirements: 3.10, 3.14_

  - [x] 5.4 `src/components/admin/users/UserRatingsBlock.tsx`
    - Média + lista de avaliações recebidas com `rating`, `comment`, `created_at`, `rater_name`.
    - Estado de erro isolado.
    - _Requirements: 3.11, 3.14_

  - [x] 5.5 `src/components/admin/users/UserChatMetadataBlock.tsx`
    - Lista de conversas com `total_messages`, `last_message_at`, `last_admin_reply_at`.
    - **Não exibe conteúdo** das mensagens.
    - Botão `Abrir conversa` desabilitado com tooltip `Disponível na spec admin-suporte`.
    - _Requirements: 3.12, 3.13, 3.14_

  - [x] 5.6 `src/components/admin/users/UserBanInfoBlock.tsx`
    - Visível somente quando `user.ban_reason !== null`.
    - Exibe `ban_reason`, `banned_at`, nome do `banned_by` (resolvido via join no `getUserDetail`).
    - _Requirements: 18.8_

- [ ] 6. Modais
  - [x] 6.1 `src/components/admin/users/EditUserModal.tsx`
    - Abas `Dados` (nome, email, phone, cpf/cnpj, company_name) e `Moderação` (visível só com `USER_TOGGLE_ACTIVE`).
    - Pré-preenche com `expectedUpdatedAt` capturado na abertura.
    - Validação local antes de submit; toast com mensagem amigável por code (`PHONE_ALREADY_USED`, `EMAIL_ALREADY_USED`, etc.).
    - Em `STALE_VERSION`: exibe banner com botão `Recarregar` que fecha o modal e força re-fetch do bundle.
    - `role="dialog"`, `aria-modal="true"`, foco inicial no botão `Cancelar`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 17.4, 20.4_

  - [x] 6.2 `src/components/admin/users/BanUserForm.tsx`
    - Renderizado dentro da aba `Moderação` do `EditUserModal`.
    - Textarea `ban_reason` (max 1000 chars), botão `Banir` (disparado `banUser`) ou `Desbanir` (disparado `unbanUser`).
    - Confirmação inline; UI bloqueia submit quando alvo é Master/self.
    - _Requirements: 18.5, 18.6, 18.7_

  - [x] 6.3 `src/components/admin/users/DeleteUserModal.tsx`
    - Dupla confirmação: input para digitar nome exato + checkbox `Estou ciente de que [N] fretes ativos serão cancelados` (visível quando `activeFretesCount > 0`).
    - Aviso destacado em vermelho `Esta ação é irreversível...`.
    - Submit chama `deleteUser(id, { confirmedName, cancelActiveFretes })` e redireciona para `/admin/users` em sucesso.
    - `role="dialog"`, foco inicial em `Cancelar`.
    - _Requirements: 6.3, 6.4, 6.9, 6.10, 6.11, 20.4_

  - [x] 6.4 `src/components/admin/users/ManageAdminModal.tsx`
    - Checkboxes para `SUPER_ADMIN`, `ADMIN`, `SUPORTE`, `FINANCEIRO`, `MODERADOR` refletindo papéis ativos.
    - Master_Admin: checkbox `SUPER_ADMIN` desabilitado com tooltip `Master_Admin: papel imutável.`; demais checkboxes ocultos.
    - Last_Super_Admin: `count_active_super_admins() === 1 && admin === único` ⇒ checkbox `SUPER_ADMIN` desabilitado com tooltip `Não é possível revogar o último SUPER_ADMIN.`.
    - Aviso quando `is_active = false`: `Este admin está desativado. Reative em [link] antes de promovê-lo.`; checkbox `SUPER_ADMIN` desabilitado.
    - Submit chama `grantRole`/`revokeRole` (de `roles.ts`) por diff.
    - _Requirements: 9.7, 9.8, 9.9, 9.10, 10.1, 10.2, 10.4, 11.7_

- [ ] 7. Páginas
  - [x] 7.1 `src/pages/admin/users/UsersListPage.tsx`
    - `useSearchParams` para sincronizar filtros com URL (`?type=&status=&q=&sort=&page=`); estado derivado via `parseUsersFiltersFromQuery`.
    - Compõe `UsersFilters` + `UsersTable` + `UsersBulkBar` + botão `Exportar CSV`.
    - Skeleton em `loading=true`; estado de erro com botão `Tentar novamente`.
    - Render Stealth 404 quando o admin não tem `USER_VIEW` (delegado ao `AdminGuard`; comportamento herdado).
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.8, 1.9, 1.10, 2.9, 2.10, 2.11, 14.1, 14.7, 16.1_

  - [x] 7.2 `src/pages/admin/users/UserDetailPage.tsx`
    - Path param `:id`; valida UUID antes de chamar `getUserDetail`; em inválido ou `NOT_FOUND` ou `user_type='admin'`, renderiza `Stealth_404`.
    - Compõe `UserDetailHeader` + 6 blocos do detalhe (cada um isolando seu estado de erro).
    - Gating de modais (`EditUserModal`, `DeleteUserModal`) via `useAdminPermission` + Master/self checks.
    - Após delete bem-sucedido, redireciona para `/admin/users` com toast.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.14, 4.6, 5.10, 6.11, 7.7, 8.7, 16.3, 16.4_

  - [x] 7.3 `src/pages/admin/users/AdminsListPage.tsx`
    - Lista via `listAdmins()`; render `Stealth_404` se admin não tem `ADMIN_ROLE_GRANT`.
    - Marca Master_Admin com badge `Master` + ícone de cadeado; marca self com badge `Você`.
    - Botão `Gerenciar` por linha que abre `ManageAdminModal`.
    - Subscribe via `subscribeRoleChanges` (de `roles.ts`) para atualização Realtime.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.11, 16.2_

  - [ ]* 7.4 Permission visibility test CP-4 em `src/__tests__/admin/users/permissionVisibility.property.test.ts`
    - **Property CP-4: Permission_Matrix decide visibilidade dos botões**
    - Para todo conjunto de papéis `R` e todo `Target_User u`, a presença/ausência dos botões de ação em `User_Detail_Page` casa com `hasPermissionForRoles(R, action)`, exceto que botões destrutivos no Master_Admin e self-actions no próprio admin estão sempre ocultos.
    - Snapshot por papel × ação.
    - **Validates: Requirements 4.3, 6.2, 11.6**

- [ ] 8. Wiring de rotas
  - [x] 8.1 Atualizar `src/components/admin/AdminLayoutRoute.tsx`
    - Adicionar 3 rotas filhas dentro do bloco `<AdminGuard><AdminShell>...`: `users`, `users/admins` (antes de `:id`), `users/:id`.
    - Importar `UsersListPage`, `AdminsListPage`, `UserDetailPage` de `src/pages/admin/users/`.
    - **Atenção à ordem**: `users/admins` precisa vir antes de `users/:id` no react-router, senão `:id = "admins"` casa primeiro.
    - _Requirements: 1.1, 3.1, 9.1_

  - [ ]* 8.2 Test de roteamento em `src/__tests__/admin/users/routing.test.tsx`
    - Garante que `users/admins` casa com `AdminsListPage` e não com `UserDetailPage` (regressão da ordem das rotas).
    - _Requirements: 9.1_

- [ ] 9. Checkpoint intermediário
  - [x] 9.1 Ensure all tests pass, ask the user if questions arise
    - Rodar `npx tsc --noEmit` (zero erros).
    - Rodar `npx vitest --run` com pelo menos os tests obrigatórios verdes (3.11 CP-1 + 3.12 CP-2).
    - Rodar `npm run build` (build limpa).

- [ ] 10. Validação fim a fim e migração
  - [ ]* 10.1 Roteiro E2E manual em `docs/admin-users-e2e.md`
    - Sequência: aplicar migration 031 → login admin → `/admin/users` (filtros, busca, sort, paginação, export CSV) → `/admin/users/:id` (6 blocos, ações destrutivas, edição com STALE_VERSION simulado) → `/admin/users/admins` (grant/revoke, Last_Super_Admin protegido, Master imutável) → bulk action com Master/self na seleção.
    - Casos negativos: SUPORTE acessando `/admin/users/admins` ⇒ Stealth 404; SUPORTE tentando DELETE via cliente Supabase ⇒ 0 linhas afetadas.

  - [~] 10.2 Aplicar migration `031_admin_users.sql` em Supabase de desenvolvimento
    - Executar via psql ou Supabase Studio.
    - Rodar bloco `-- VERIFY` e validar todos os SELECTs retornando esperado (3 colunas, 4 triggers, 3 RPCs, 12 policies).
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 19.7_

  - [ ]* 10.3 Smoke test do trigger ↔ service parity (CP-12) em `src/__tests__/admin/users/triggerServiceParity.test.ts`
    - **Property CP-12: Trigger SQL e Service concordam sobre Master_Admin**
    - Integração: gated por env var `RUN_SUPABASE_INTEGRATION=1`; em ambiente local conectado ao Supabase, executa cada mutação destrutiva em Master_Admin via cliente Supabase **bypassing** o service e valida que a trigger SQL falha com `master_admin_immutable`.
    - Skipa silenciosamente quando a env var não está setada.
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.8**

  - [x] 10.4 Checkpoint final
    - `npx tsc --noEmit` zero erros.
    - `npm run build` limpa.
    - `npx vitest --run` todas as suítes verdes (opcionais skipadas se não implementadas; obrigatórias 3.11 e 3.12 verdes).
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marcadas com `*` são opcionais (testes de propriedade adicionais, smoke tests, roteiros manuais e docs auxiliares). O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Sub-tasks 3.11 (CP-1, Master imutável) e 3.12 (CP-2, toggle idempotente) **NÃO** levam asterisco — são property tests obrigatórios conforme `requirements.md` § Padrões de Sucesso.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N) e os requisitos que ela valida.
- Cada checkpoint serve como ponto de validação incremental antes de avançar.
- Dependências da `admin-foundation` (Provider, Guard, Shell, Sidebar, hooks, services) são reusadas sem modificação, exceto `AdminLayoutRoute` que recebe 3 rotas filhas (task 8.1).
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.

# Implementation Plan: admin-foundation

## Overview

Plano incremental para entregar a fundação do painel administrativo (`/admin/*`) do FreteGO. Cada task referencia requisitos específicos do `requirements.md` e propriedades (CP-N) do `design.md`. As tasks são executadas em ordem; sub-tasks marcadas com `*` são opcionais (testes de propriedade, smoke tests e polimento).

Convenções:
- Todas as decisões de modelagem (SQL, contratos TS, fluxos) já estão fixadas no `design.md`. As tasks só convertem aquele design em código.
- O login do app comum continua usando telefone (`{phone}@example.com`). O painel admin usa **username** dedicado (coluna nova `users.admin_username`) e o usuário Supabase Auth é criado com email sintético `{username}@admin.fretego.local`.
- Stack: TypeScript + React + Supabase + fast-check + Vitest (já em uso no projeto).

## Tasks

- [ ] 1. Setup de banco, crypto e contratos base
  - [x] 1.1 Criar migration `supabase/migrations/030_admin_foundation.sql`
    - Envolver tudo em `BEGIN; ... COMMIT;` e usar `IF NOT EXISTS` / `CREATE OR REPLACE` para idempotência.
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superuser boolean NOT NULL DEFAULT false`.
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_username text UNIQUE` (nullable; usado só para login admin; app comum permanece em telefone).
    - Criar tabelas `admin_roles`, `admin_mfa_secrets`, `admin_audit_logs` com colunas, FKs, constraints e índices conforme §4.2 do design.
    - Habilitar RLS e criar policies para cada tabela (incluindo imutabilidade dos audit logs: SEM UPDATE/DELETE para qualquer role).
    - Trigger `BEFORE UPDATE` em `admin_mfa_secrets` para `updated_at = NOW()`.
    - Bloco `-- BOOTSTRAP` comentado documentando a promoção manual inicial.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 1.2 Criar 6 funções `SECURITY DEFINER` na migration
    - `log_admin_action(p_admin_id, p_action, p_target_type, p_target_id, p_before, p_after, p_ip, p_ua) RETURNS uuid`
    - `set_mfa_secret(p_admin_id, p_secret bytea, p_backup_codes jsonb) RETURNS void`
    - `regenerate_backup_codes(p_admin_id, p_codes jsonb) RETURNS void`
    - `consume_backup_code(p_admin_id, p_code_hash text) RETURNS jsonb` (retorna `{ok, reason?}`, atualiza `used_at` apenas no primeiro consumo).
    - `validate_admin_session(p_admin_id) RETURNS jsonb` (retorna `{isValid, reason?, roles[]}`; checa `is_superuser`, `is_active`, papéis ativos).
    - `is_admin_with_permission(p_action text) RETURNS boolean` (espelha a `Permission_Matrix` para uso em policies).
    - SQL exato conforme §4.2.1–4.2.6.
    - _Requirements: 4.10, 6.5, 7.7, 8.1, 8.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 13.10, 17.6, 21.4_

  - [x] 1.3 Adicionar `VITE_ADMIN_MFA_KEY` em `.env.example`
    - Comentário documentando: chave AES-256-GCM em base64, gerada com `openssl rand -base64 32`, **nunca** commitada, rotação documentada em `RECOVERY.md`.
    - _Requirements: 17.5, 18.5_

  - [x] 1.4 Implementar `src/utils/adminCrypto.ts`
    - `encryptTotpSecret(plain: string): Promise<Uint8Array>` e `decryptTotpSecret(cipher: Uint8Array): Promise<string>` (AES-256-GCM via WebCrypto, IV aleatório por chamada, prefixo IV no buffer).
    - `formatBackupCode(c: string): string` (insere hífens a cada 4 chars: `ABCDEFGHIJ` → `ABCD-EFGH-IJ`).
    - `parseBackupCode(s: string): string` (aceita com/sem hífen, lower/upper, retorna sempre uppercase sem hífens).
    - `isValidBase32(s: string): boolean` e helpers de geração de secret (32 bytes random → base32).
    - _Requirements: 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7_

  - [ ]* 1.5 Property tests para `adminCrypto.ts` em `src/__tests__/admin/adminCrypto.property.test.ts`
    - **Property CP-6: Round-trip de cifragem do TOTP_Secret** — para toda string base32 válida, `decryptTotpSecret(encryptTotpSecret(s)) === s`.
    - **Property CP-7: Round-trip de backup code format** — para toda string `[A-Z0-9]{10}`, `parseBackupCode(formatBackupCode(c)) === c`.
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4**

  - [ ]* 1.6 Smoke test de idempotência da migration
    - Script ou doc rápido em `supabase/migrations/_test_idempotency_030.sql` que aplica a migration 2x e verifica que a segunda execução não falha e não duplica dados.
    - _Requirements: 21.2, 21.3, 21.6_

- [ ] 2. Permission_Matrix e helpers de papel
  - [x] 2.1 Implementar `src/services/admin/permissions.ts`
    - Constante `Permission_Matrix: Record<AdminRole, Set<AdminAction>>` (5 papéis × ações de §5).
    - `hasPermission(role: AdminRole, action: AdminAction): boolean`.
    - `hasPermissionForRoles(roles: AdminRole[], action: AdminAction): boolean` = `roles.some(r => hasPermission(r, a))`.
    - Função pura, sem efeitos colaterais, sem leitura de runtime.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ]* 2.2 Property tests da matriz em `src/__tests__/admin/permissions.property.test.ts`
    - **Property CP-3: Determinismo de hasPermission** — para todo `(role, action)`, chamadas repetidas retornam o mesmo booleano.
    - **Property CP-4: União de permissões** — `hasPermissionForRoles(R, a) === R.some(r => hasPermission(r, a))`.
    - **Property CP-14: Deny by default** — para toda string `action` fora do enum `AdminAction`, `hasPermission(role, action) === false` em todo papel.
    - **Validates: Requirements 8.1, 8.2, 8.5, 8.7, 8.9**

  - [x] 2.3 Implementar `src/services/admin/roles.ts`
    - `listAdmins()`, `grantRole(userId, role)`, `revokeRole(userId, role)` (chamando RPCs ou tabela `admin_roles` com RLS).
    - `subscribeRoleChanges(callback)` via Supabase Realtime no canal `admin_roles` (filtrado por `user_id`).
    - Toda mutação passa por `executeAdminMutation` (depende da task 5.1 — deixar import e chamar; matricial fica funcional ao final da task 5).
    - _Requirements: 7.1, 7.4, 7.5, 9.6, 13.10_

- [ ] 3. Auth admin (login, sessão, validação, lockout)
  - [x] 3.1 Implementar `src/services/admin/auth.ts`
    - `loginAdmin({ username, password }): Promise<LoginResult>` — converte para email sintético `{username.toLowerCase()}@admin.fretego.local`, chama `supabase.auth.signInWithPassword`, valida `is_superuser`, papéis ativos e retorna estado `MFA_REQUIRED` ou `OK`.
    - `validateAdminSession(): Promise<{ isValid: boolean; reason?: string; roles: AdminRole[] }>` — chama RPC `validate_admin_session`.
    - `getAdminSession()`, `setAdminSession(s)`, `clearAdminSession()` — leitura/escrita em `localStorage.fretego_admin_session` com formato §4.3.
    - `logoutAdmin()` — chama `supabase.auth.signOut` (escopo admin) e limpa sessão.
    - Tempo mínimo de resposta de 500ms em **toda** falha de login (anti-timing).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 13.1, 13.2, 13.3, 13.4, 13.7, 13.8, 13.9, 13.10, 16.1, 16.2_

  - [x] 3.2 Implementar `src/services/admin/bruteForce.ts`
    - Wrapper que delega ao `bruteForceProtector` existente usando chave `admin:username:{username.toLowerCase()}`.
    - `recordFailure`, `recordSuccess`, `isLocked`, `getStats24h` (para Req 19).
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 16.5_

  - [ ]* 3.3 Property test de lockout em `src/__tests__/admin/bruteForce.property.test.ts`
    - **Property CP-5: Lockout bloqueia mesmo com credencial correta** — após N≥5 falhas em <30min, `loginAdmin` retorna `ACCOUNT_LOCKED` mesmo com senha+TOTP corretos por ≥30min.
    - Mock de tempo via `vi.useFakeTimers()`.
    - **Validates: Requirements 15.1, 15.2, 15.3**

  - [x] 3.4 Implementar `src/hooks/useAdminSession.ts`
    - Lê/grava `lastActivityAt` em eventos de mouse, teclado e foco.
    - Listener de `storage` events para detectar logout em outra aba.
    - Expõe `session`, `roles`, `lastActivityAt`, `clear()`.
    - _Requirements: 13.1, 13.2, 13.5, 13.6, 13.7_

  - [ ]* 3.5 Property test de invalidação de sessão em `src/__tests__/admin/session.property.test.ts`
    - **Property CP-13: Sessão admin invalida ao desativar Super_Admin** — para toda sessão ativa, setar `users.is_active = false` faz `validateAdminSession()` retornar `{ isValid: false, reason: 'inactive' }`.
    - Mock de banco / RPC.
    - **Validates: Requirements 13.9, 13.10**

- [ ] 4. MFA (TOTP + backup codes)
  - [x] 4.1 Implementar `src/services/admin/mfa.ts`
    - `generateTotpSecret(): string` (32 bytes random → base32).
    - `generateTotp(secret, t?): string` (HMAC-SHA1, 6 dígitos, RFC 6238, step 30s).
    - `verifyTotp(secret, code, now?): boolean` (tolerância ±30s, rejeita ±60s).
    - `generateBackupCodes(n=10): string[]` (10 códigos `[A-Z0-9]{10}`).
    - `setupMfa(adminId, secret, backupCodes)` → cifra secret com `encryptTotpSecret`, hashea cada backup com bcrypt (`src/utils/passwordHash.ts`), chama RPC `set_mfa_secret`.
    - `verifyMfa(adminId, input)` — tenta TOTP; se falhar, normaliza com `parseBackupCode` e chama RPC `consume_backup_code`.
    - `regenerateBackupCodes(adminId)` — gera novos, hashea, chama RPC `regenerate_backup_codes`, dispara audit log.
    - _Requirements: 4.1–4.11, 5.1–5.9, 6.1–6.6, 17.4, 17.5, 18.1–18.7_

  - [ ]* 4.2 Property test TOTP em `src/__tests__/admin/totp.property.test.ts`
    - **Property CP-10: TOTP tolerância de janela** — para todo `secret` e `t ∈ {now-30, now, now+30}`, `verifyTotp(secret, generateTotp(secret, t), now) === true`; para `t = now ± 60`, retorna `false`.
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 4.3 Property test backup code em `src/__tests__/admin/backupCodes.property.test.ts`
    - **Property CP-9: Idempotência de consumo** — primeira chamada a `consumeBackupCode` retorna `{ok: true}` e marca `used_at`; segunda retorna `{ok: false, reason: 'already_used'}` sem alterar nada.
    - **Validates: Requirements 4.10, 6.4**

  - [x] 4.4 Componentes `src/components/admin/MfaSetupForm.tsx` e `MfaVerifyForm.tsx`
    - `MfaSetupForm`: gera secret, exibe QR code (`otpauth://`), aceita 1º TOTP, exibe 10 backup codes uma única vez com botão "copiei e guardei".
    - `MfaVerifyForm`: input único que aceita TOTP de 6 dígitos OU backup code (com ou sem hífen), botão "verificar".
    - Usar serviços da task 4.1.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.5, 5.6, 5.7, 5.8_

- [ ] 5. Audit log
  - [x] 5.1 Implementar `src/services/admin/audit.ts`
    - `serializeAuditData(o): JsonValue` e `deserializeAuditData(j): unknown` (round-trip JSON seguro).
    - `logAdminAction({ action, targetType, targetId, before, after, ip?, userAgent? })` — chama RPC `log_admin_action`.
    - `executeAdminMutation<T>(action, payload, mutate: () => Promise<T>): Promise<T>` — preferencialmente envolve `log_admin_action` + `mutate` em uma RPC dedicada por ação; transitoriamente segue padrão "log → mutate → rollback-log on fail" (§6.4).
    - Helpers de leitura: `listAuditLogs({ filters, page, pageSize })`, `exportAuditLogsCSV({ filters })` (também loga ação `AUDIT_EXPORT`).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 12.7, 12.8, 16.1, 16.2_

  - [ ]* 5.2 Property test de serialização JSON em `src/__tests__/admin/audit.property.test.ts` (suite "serialize")
    - **Property CP-8: Round-trip JSON de audit data** — para todo objeto JSON-serializável (gerado com `fc.jsonValue()`), `deserializeAuditData(serializeAuditData(o))` é deep-equal a `o`.
    - **Validates: Requirements 11.7**

  - [ ]* 5.3 Property test do invariante mutação ↔ log em `src/__tests__/admin/audit.property.test.ts` (suite "invariant")
    - **Property CP-2: Toda mutação admin gera audit log** — para toda chamada de `executeAdminMutation(action, payload)` bem-sucedida, existe exatamente 1 inserção em `admin_audit_logs` com `action` correspondente; em falha, há 0 ou exatamente 1 log de `_ROLLBACK`.
    - Mock do cliente Supabase (counters por tabela).
    - **Validates: Requirements 11.1, 11.2, 11.6**

  - [ ]* 5.4 Teste de imutabilidade RLS em `src/__tests__/admin/audit.property.test.ts` (suite "immutability")
    - **Property CP-12: Audit log é imutável** — para todo registro inserido, qualquer UPDATE/DELETE com cliente Supabase em qualquer role admin retorna erro RLS e o registro permanece inalterado.
    - Integration test contra Supabase local (ou mock que reproduz erro de policy).
    - **Validates: Requirements 10.5, 10.6**

- [ ] 6. Provider, Guard, Shell e Stealth 404
  - [x] 6.1 Criar `src/pages/NotFoundPage.tsx`
    - 404 padrão do app (atualmente inexistente). Header global, ilustração/mascote, mensagem neutra, link para `/`.
    - Usado tanto no catch-all global (`*`) quanto reexportado pelo Stealth.
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

  - [x] 6.2 Criar `src/components/admin/Stealth404.tsx`
    - Re-export literal do `<NotFoundPage />` (mesmo componente, não cópia, para garantir CP-11 por construção).
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [x] 6.3 Implementar `src/components/admin/AdminProvider.tsx`
    - Context expondo: `session`, `user`, `roles`, `permissions`, `sessionTimeRemainingMs`, `logout()`, `refreshRoles()`.
    - Subscribe Realtime em `admin_roles` (via `roles.subscribeRoleChanges`) e atualiza estado.
    - Limpa sessão e dispara redirect quando todos os papéis são revogados.
    - _Requirements: 9.6, 13.7, 13.10, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 6.4 Implementar `src/components/admin/AdminGuard.tsx`
    - Em todo `useEffect([pathname])`: `validate_admin_session()` → checa em ordem: sessão admin válida → `is_superuser` → `is_active` → `roles.length > 0` → `mfaVerifiedThisSession`.
    - Falha em qualquer etapa → renderiza `<Stealth404 />`.
    - Usuário autenticado bloqueado também loga `ADMIN_STEALTH_BLOCK` (não-autenticado é omitido por design).
    - _Requirements: 2.1, 2.5, 5.9, 7.7, 13.9, 13.10, 20.7_

  - [x] 6.5 Implementar `src/components/admin/AdminShell.tsx`, `AdminSidebar.tsx`, `AdminHeader.tsx`, `SessionTimer.tsx`
    - Layout dark próprio (sidebar fixa desktop, drawer mobile).
    - Sidebar filtra itens via `useAdminPermission`.
    - Header exibe nome, papéis, badge "MODO ADMIN" e `SessionTimer`.
    - Preserva scroll da rota anterior.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [x] 6.6 Implementar `src/components/admin/AdminLayoutRoute.tsx`
    - Wrapper: `<AdminProvider><AdminGuard><AdminShell><Outlet /></AdminShell></AdminGuard></AdminProvider>` com sub-Routes internas para `/admin/login`, `/admin/mfa-setup`, `/admin/mfa-verify`, etc. (§3.3).
    - Rotas públicas (`/admin/login`, `/admin/mfa-setup`, `/admin/mfa-verify`) ficam fora do `AdminGuard` mas dentro do `AdminProvider`.
    - _Requirements: 20.1, 20.2_

  - [x] 6.7 Implementar `src/hooks/useAdminPermission.ts`
    - `useAdminPermission(action: AdminAction): { allowed: boolean; reason?: string }`.
    - Lê papéis do `AdminProvider` e usa `hasPermissionForRoles`.
    - Reativo ao Realtime (atualiza quando papéis mudam).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 6.8 Implementar `src/hooks/useSessionTimeout.ts`
    - Countdown 1s baseado em `lastActivityAt`.
    - Modal de aviso aos 5min restantes; modal "sessão expirada" + redirect aos 0min.
    - _Requirements: 13.4, 13.5, 13.6, 14.6_

  - [ ]* 6.9 Snapshot test do Stealth em `src/__tests__/admin/stealth404.test.tsx`
    - **Property CP-1: Stealth 404 para não-Super_Admin** — para todo `u` não Super_Admin e toda rota `/admin/*` (≠ `/admin/login`), `AdminGuard(u, r)` renderiza `Stealth_404`.
    - **Property CP-11: Stealth 404 idêntica à 404 padrão** — snapshot do HTML (mesmo title, mesmo `<main>`, mesmas classes root) para rotas em `/admin/*` e rotas inexistentes fora de `/admin/`.
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

- [ ] 7. Checkpoint
  - [x] 7.1 Ensure all tests pass, ask the user if questions arise
    - Rodar `npx vitest --run` e `npx tsc --noEmit`.
    - Validar que todas as tasks 1–6 implementadas (não-opcionais) compilam e testam verdes.

- [ ] 8. Páginas admin
  - [x] 8.1 `src/pages/admin/AdminLoginPage.tsx`
    - Input `username` (não telefone), input `password`, botão "Entrar".
    - Usa `loginAdmin`, `bruteForceProtector` admin e tempo mínimo 500ms de falha.
    - Redireciona para `/admin/mfa-setup` (1º acesso) ou `/admin/mfa-verify` conforme estado.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 15.1, 15.4, 15.5, 15.6_

  - [x] 8.2 `src/pages/admin/AdminMfaSetupPage.tsx`
    - Renderiza `MfaSetupForm`. Após sucesso, marca `mfaVerifiedThisSession=true` e navega para `/admin`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [x] 8.3 `src/pages/admin/AdminMfaVerifyPage.tsx`
    - Renderiza `MfaVerifyForm`. Bloqueia qualquer outra rota admin enquanto não verificado.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 8.4 `src/pages/admin/AdminAuditPage.tsx`
    - Lista paginada de logs com filtros (admin, data, ação, target).
    - Botão "Exportar CSV" que dispara `exportAuditLogsCSV` (gera log `AUDIT_EXPORT`).
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 8.5 `src/pages/admin/AdminDashboardPage.tsx` (placeholder)
    - Placeholder mínimo com cards de alertas de segurança de Req 19 (lockouts, login failures 24h, card neutro quando não há eventos).
    - Conteúdo completo do dashboard fica para a spec `admin-dashboard`.
    - _Requirements: 15.7, 16.5, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

- [ ] 9. Wiring de rotas
  - [x] 9.1 Atualizar `src/App.tsx`
    - Adicionar `<Route path="/admin/*" element={<AdminLayoutRoute />} />`.
    - Adicionar catch-all global `<Route path="*" element={<NotFoundPage />} />` ao final do `<Routes>`.
    - Imports e ordem de rotas conforme §3.3.
    - _Requirements: 2.1, 2.6, 20.1, 20.2_

  - [x] 9.2 Garantir que rotas internas funcionam
    - `/admin/login`, `/admin/mfa-setup`, `/admin/mfa-verify`, `/admin/audit`, `/admin` (dashboard placeholder) renderizam dentro do `AdminLayoutRoute`.
    - `/admin/login` e `mfa-*` ficam fora do `AdminGuard` mas dentro do `AdminProvider`.
    - _Requirements: 20.1, 20.2, 20.3_

- [ ] 10. Bootstrap admin master e recovery
  - [x] 10.1 Criar `supabase/scripts/bootstrap_admin_master.sql`
    - Idempotente (`ON CONFLICT DO NOTHING` em todas as inserções).
    - Insere em `auth.users` o usuário `Bruno Henrique` com email sintético `nexus_vortex99@admin.fretego.local` e senha `K9#v!2Wx@m$7Q&zL1%tR_B` cifrada via `crypt(senha, gen_salt('bf'))` (extensão `pgcrypto`).
    - Insere em `public.users`: `name='Bruno Henrique'`, `phone=NULL`, `admin_username='Nexus_Vortex99'`, `is_superuser=true`, `is_active=true`, `user_type='admin'`, FK `auth_user_id` para o registro acima.
    - Insere em `admin_roles` o papel `SUPER_ADMIN` com `granted_by` apontando para o próprio usuário (auto-bootstrap) e `revoked_at=NULL`.
    - Documentação inline explicando: rodar uma única vez via psql com role `postgres`, em seguida o admin master ainda precisa fazer setup de MFA no primeiro login.
    - _Requirements: 1.6, 7.1, 7.2_

  - [x] 10.2 Criar `.kiro/specs/admin-foundation/RECOVERY.md`
    - Procedimentos: (a) perda de MFA do admin master; (b) lockout do admin master; (c) comprometimento da chave `VITE_ADMIN_MFA_KEY`; (d) recriação do usuário em ambiente novo via `bootstrap_admin_master.sql`; (e) troubleshooting de sessão inválida em runtime.
    - Cada procedimento com SQL exato a rodar e checks de verificação.
    - _Requirements: 6.6, 17.5, 18.5, 21.6_

- [ ] 11. Validação fim a fim
  - [ ]* 11.1 Roteiro de teste E2E manual em `docs/admin-foundation-e2e.md`
    - Sequência: aplicar migration → rodar bootstrap → login com `Nexus_Vortex99` → MFA setup → dashboard → logout → relogin → MFA verify → acesso a `/admin/audit` → tentativa de acesso por usuário comum (deve cair em Stealth 404).
    - Inclui casos negativos: 6 senhas erradas → lockout; revogar último papel → próxima navegação cai em Stealth 404.

  - [x] 11.2 Checkpoint final
    - Rodar `npx tsc --noEmit` (zero erros).
    - Rodar `npm run build` (build limpa).
    - Rodar `npx vitest --run` (todas as suítes verdes; opcionais skipadas se não implementadas).
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marcadas com `*` são opcionais (testes de propriedade, smoke tests, roteiros manuais). O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N) e os requisitos que ela valida.
- Cada checkpoint serve como ponto de validação incremental antes de avançar.
- O conteúdo real do dashboard (métricas, gráficos) e os CRUDs administrativos são specs subsequentes (`admin-dashboard`, `admin-users`, etc.) que dependem desta fundação.
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.

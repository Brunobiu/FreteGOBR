# Security Hardening — Design

## R1 — Guard de colunas sensíveis em `users`

### Decisão de arquitetura
Usar um **trigger BEFORE UPDATE** (`users_guard_sensitive_columns`) em vez de
`REVOKE` por coluna. Motivo: admins compartilham a role `authenticated` e
editam colunas de moderação (`is_active`, `ban_reason`) via PostgREST direto;
um REVOKE por coluna bloquearia o admin junto. O trigger distingue contexto e
papel com precisão.

### Detecção de contexto
- `current_user` = `authenticated` ou `anon` ⇒ chamada veio do PostgREST
  (cliente). É aqui que aplicamos o guard.
- Dentro de uma função `SECURITY DEFINER` cujo owner é `postgres`, o
  `current_user` durante a execução é `postgres` ⇒ guard é ignorado (fluxos
  legítimos de pagamento/trial/revisão passam).
- `service_role` (backend/edge functions) ⇒ ignorado.

### Regras do trigger (somente quando `current_user IN ('authenticated','anon')`)
1. Colunas SOMENTE-SISTEMA: se `NEW.col IS DISTINCT FROM OLD.col` para qualquer
   uma, `RAISE EXCEPTION permission_denied`.
   Conjunto: `user_type, trial_ends_at, subscription_status, is_subscribed,
   documents_blocked, email_verified, terms_accepted_at, terms_version,
   password_hash, admin_username, is_superuser`.
   (`is_superuser` já tem `protect_is_superuser`; mantemos por defesa em
   profundidade — o novo guard roda e barra antes.)
2. Colunas de MODERAÇÃO (`is_active, ban_reason, banned_at, banned_by`): se
   mudarem, exigir `is_admin_with_permission('USER_TOGGLE_ACTIVE')` OU
   `is_admin_with_permission('USER_EDIT')`; senão `permission_denied`.
3. Demais colunas (`name, email, phone, cpf, profile_photo_url,
   last_activity_at, session_version, created_at, updated_at, id`): livres
   (a política RLS `auth.uid() = id` já garante que é a própria linha).

### Ordem de triggers
Nome `users_guard_sensitive_columns` (alfabético antes de
`users_master_admin_immutable_update` e `users_protect_is_superuser`? triggers
BEFORE rodam em ordem alfabética do nome). Ordem não é crítica aqui porque
qualquer um que lançar exceção aborta. Mantemos os existentes intactos.

### Idempotência / segurança da migration
- `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` antes de criar.
- `SET search_path = public` no header da função.
- Função `SECURITY DEFINER` owner `postgres` (default ao criar via migration).

## Estratégia de rollback (R1)
`DROP TRIGGER users_guard_sensitive_columns ON public.users;` +
`DROP FUNCTION users_guard_sensitive_columns();`
Volta ao comportamento anterior (inseguro) sem afetar dados. Documentado em
`077_..._rollback.sql`.

## Estratégia de testes (R1)
- **SQL antes/depois (produção, transação com ROLLBACK)**: simular
  `SET ROLE authenticated; SET request.jwt.claims ...` não é trivial via MCP;
  então validamos pela via mais segura: tentar o UPDATE como `postgres`
  (passa, esperado) e provar que a RPC de pagamento ainda altera. O bloqueio
  ao cliente é garantido pela lógica `current_user IN ('authenticated','anon')`
  — verificável com `SET LOCAL ROLE authenticated` numa transação.
- **Property/unit (repo)**: nenhuma lógica TS pura nova; o guard é SQL.
  Adicionar teste de fumaça documentando o invariante em
  `src/__tests__/security/`.
- Build/typecheck inalterados (mudança é só SQL).

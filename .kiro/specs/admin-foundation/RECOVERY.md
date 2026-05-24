# Recovery Procedures — admin-foundation

Procedimentos operacionais para situacoes de emergencia no painel admin.
Todos requerem acesso ao banco com role `postgres` ou `service_role`.

## A. Perda do app autenticador (TOTP) do admin master

### Caso 1: ainda tem backup codes

Use um dos 10 codigos no campo de "Codigo do app ou backup code" da tela
de verificacao MFA. Apos entrar, va em Configuracoes -> MFA e regenere os
codigos.

### Caso 2: perdeu app E backup codes

Reset MFA via SQL e reconfigurar no proximo login:

```sql
-- Apaga MFA do admin master; ele voltara ao fluxo de mfa-setup no proximo login
DELETE FROM admin_mfa_secrets
WHERE user_id = (SELECT id FROM users WHERE admin_username = 'Nexus_Vortex99');
```

Em seguida acesse `/admin/login`, faca login normal e o sistema redireciona
para `/admin/mfa-setup` para nova configuracao.

## B. Lockout do admin master

5 falhas em janela curta -> lockout de 30min. Para desbloquear na hora:

```sql
DELETE FROM account_lockouts
WHERE phone = 'admin:username:nexus_vortex99';

DELETE FROM login_attempts
WHERE phone = 'admin:username:nexus_vortex99';
```

Em seguida limpar tambem o cache em memoria recarregando o app.

## C. Comprometimento da chave VITE_ADMIN_MFA_KEY

Se houver suspeita de vazamento da chave que cifra TOTP secrets:

1. Gerar nova chave: `openssl rand -base64 32`
2. Atualizar `.env` com nova `VITE_ADMIN_MFA_KEY`
3. Forcar re-setup de MFA em todos os admins:

```sql
DELETE FROM admin_mfa_secrets;
-- Cada admin sera redirecionado a /admin/mfa-setup no proximo login
```

4. Auditar logs em `admin_audit_logs` desde a data suspeita
5. Notificar todos os admins ativos

## D. Recriar admin master em ambiente novo

Apos aplicar todas as migrations:

```bash
psql $DATABASE_URL -f supabase/scripts/bootstrap_admin_master.sql
```

Verifique com:

```sql
SELECT u.name, u.admin_username, u.is_superuser, u.is_active,
       array_agg(ar.role) FILTER (WHERE ar.revoked_at IS NULL) AS roles
FROM users u
LEFT JOIN admin_roles ar ON ar.user_id = u.id
WHERE u.admin_username = 'Nexus_Vortex99'
GROUP BY u.id, u.name, u.admin_username, u.is_superuser, u.is_active;
```

Esperado: `is_superuser=true`, `is_active=true`, `roles={SUPER_ADMIN}`.

## E. Sessao invalida em runtime apesar de credenciais corretas

Sintoma: usuario faz login, MFA, mas cai em Stealth 404.

Diagnostico:

```sql
SELECT u.is_active, u.is_superuser,
       (SELECT array_agg(role) FROM admin_roles
         WHERE user_id = u.id AND revoked_at IS NULL) AS roles
FROM users u WHERE admin_username = 'Nexus_Vortex99';
```

- `is_active=false` -> normalize com `UPDATE users SET is_active=true WHERE ...`
- `is_superuser=false` -> nao deveria ocorrer em master; investigue trigger e reentre via bootstrap
- `roles=NULL` -> insira papel:

```sql
INSERT INTO admin_roles (user_id, role, granted_by)
SELECT id, 'SUPER_ADMIN', id FROM users WHERE admin_username='Nexus_Vortex99';
```

Em seguida force logout admin no navegador (DevTools -> Application ->
localStorage -> remover `fretego_admin_session`) e relogue.

## F. Trocar a senha do admin master via SQL

```sql
UPDATE auth.users
   SET encrypted_password = crypt('NOVA_SENHA_FORTE', gen_salt('bf')),
       updated_at = NOW()
 WHERE email = 'nexus_vortex99@admin.fretego.local';
```

Lembre de atualizar tambem o arquivo `logins` na raiz (gitignored).

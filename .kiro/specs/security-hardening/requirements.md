# Security Hardening — Requisitos

Auditoria final pré-produção do FreteGO. Documento vivo: cada finding vira um
requisito com critérios de aceite testáveis (EARS). Correções só após SPEC.

Severidade: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo/ruído.

---

## R1 🔴 — Escalonamento de privilégio e bypass financeiro via UPDATE direto em `users`

**Contexto/evidência (confirmado no banco de produção):**
- Role `authenticated` possui `UPDATE` em nível de tabela sobre `public.users`
  (todas as colunas).
- Política RLS de UPDATE `users_update_policy` = `auth.uid() = id` (sem
  restrição de colunas).
- Triggers de proteção no UPDATE cobrem apenas `is_superuser`
  (`protect_is_superuser`) e a linha do Master Admin. Nenhum protege
  `subscription_status`, `is_subscribed`, `trial_ends_at`, `user_type`,
  `documents_blocked`, `email_verified`, `ban_reason`, `is_active`.

**Exploit:** motorista autenticado faz PATCH direto na API REST do Supabase na
própria linha definindo `is_subscribed=true`, `subscription_status='active'`,
`trial_ends_at` no futuro distante, ou `documents_blocked=false` — obtendo
assinatura paga, trial infinito e burlando bloqueios, sem pagamento e sem admin.

**EARS:**
- QUANDO um usuário autenticado (role `authenticated`, via PostgREST) tentar
  alterar QUALQUER coluna sensível da própria linha em `users`, o sistema DEVE
  rejeitar a alteração com erro `permission_denied`.
- Colunas sensíveis SOMENTE-SISTEMA (alteráveis apenas em contexto
  `SECURITY DEFINER`/backend): `user_type`, `trial_ends_at`,
  `subscription_status`, `is_subscribed`, `documents_blocked`, `email_verified`,
  `terms_accepted_at`, `terms_version`, `password_hash`, `admin_username`,
  `is_superuser`.
- Colunas sensíveis de MODERAÇÃO (alteráveis por admin ou backend):
  `is_active`, `ban_reason`, `banned_at`, `banned_by`.
- QUANDO uma RPC `SECURITY DEFINER` (owner `postgres`) ou o backend
  (`service_role`) alterar essas colunas, o sistema DEVE permitir (fluxos
  legítimos: pagamento, trial, revisão de documento, ban/unban admin).
- QUANDO o usuário alterar colunas de perfil próprias (`name`, `email`,
  `phone`, `cpf`, `profile_photo_url`, `last_activity_at`, `session_version`),
  o sistema DEVE permitir normalmente.

**Critérios de aceite:**
1. PATCH direto de `is_subscribed`/`subscription_status`/`trial_ends_at` pelo
   próprio usuário falha (erro), e o valor permanece o original.
2. `subscription_mark_paid`/`admin_extend_trial`/`admin_review_document`
   continuam funcionando (alteram as colunas via RPC).
3. Edição de perfil (nome/telefone/cpf/email/foto) continua funcionando.
4. Ban/unban e toggle ativo pelo admin continuam funcionando.
5. Login continua atualizando `last_activity_at`.

---

## Findings em investigação (recon em andamento)

- R2 🟡 `companies`, `company_embarcadores`, `asaas_webhook_events`,
  `support_ticket_attempts` com RLS habilitado e ZERO policies — confirmar se
  são acessadas só por backend/definer (fechado por padrão = ok) ou se quebram
  funcionalidade / expõem algo.
- R3 🟡 `users_insert_policy` / `motoristas_insert_policy` /
  `embarcadores_insert_policy` com `WITH CHECK (true)` — avaliar se o INSERT de
  cadastro pode forjar campos (ex: `is_superuser`, `user_type`).
- R4 ⚪ `function_search_path_mutable` em funções utilitárias/trigger — endurecer
  `SET search_path` onde fizer sentido.
- R5 ⚪ Buckets públicos com SELECT amplo (listagem) — avaliar exposição.
- R6 🟡 Reset de `email` direto pelo usuário sem reverter `email_verified`.
- R7 — Isolamento em `documents`, `motoristas`, `chat_messages`, `notifications`,
  `subscriptions` (validar policies por leitura/escrita cruzada).

Cada finding será detalhado e corrigido individualmente, com teste antes/depois.

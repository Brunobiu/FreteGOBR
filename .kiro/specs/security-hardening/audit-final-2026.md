# Auditoria Final Pré-Produção — FreteGO (2026)

Complemento à spec existente de `security-hardening`. Registra os findings da
auditoria de hardening final (isolamento entre usuários, bypass financeiro,
escalonamento de privilégio, RLS, exposição de dados) e o status de cada um.

Severidade: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo/ruído.

Método: nada é alterado em produção sem antes (1) provar o risco com evidência
do banco e (2) testar a correção em transação com ROLLBACK. O relatório do
Supabase advisor é PISTA, não verdade — a maioria dos WARN (anon/authenticated
pode executar RPC `SECURITY DEFINER`; tabela visível no GraphQL) já é mitigada
por `auth.uid()`/`is_admin_with_permission` dentro das funções.

---

## R1 🔴 RESOLVIDO — Escalonamento de privilégio + bypass financeiro em `users`

**Evidência:** role `authenticated` tinha `UPDATE` em nível de tabela em
`public.users`; RLS de UPDATE era só `auth.uid() = id` (sem restrição de
coluna); nenhum trigger protegia colunas financeiras/privilégio.

**Exploit:** PATCH direto na API REST na própria linha setando
`is_subscribed=true`, `subscription_status='active'`, `trial_ends_at` futuro,
`documents_blocked=false` ⇒ assinatura grátis, trial infinito, burla de
bloqueio. Sem pagamento, sem admin.

**Correção:** Migration 077 — trigger `users_guard_sensitive_columns`
(**SECURITY INVOKER**, para `current_user` refletir o chamador real):
- Só atua quando `current_user IN ('authenticated','anon')` (PostgREST).
- Bloqueia mudança de colunas somente-sistema: `user_type, trial_ends_at,
  subscription_status, is_subscribed, documents_blocked, email_verified,
  terms_accepted_at, terms_version, password_hash, admin_username, is_superuser`.
- Colunas de moderação (`is_active, ban_reason, banned_at, banned_by`) só por
  admin (`is_admin_with_permission`).
- RPCs `SECURITY DEFINER` (owner `postgres`) e `service_role` passam (fluxos de
  pagamento/trial/revisão/ban intactos).

**Validação (transação + ROLLBACK, sem persistir):**
- ✅ Cliente bloqueado em `is_subscribed`/`subscription_status`/`documents_blocked`.
- ✅ Update de perfil (name/phone/cpf/email/foto) ainda passa (1 linha).
- ✅ Contexto de sistema (`postgres`) ainda altera colunas financeiras.
- ✅ 86 testes de segurança do repo passando.

**Lição de implementação:** a primeira versão usou `SECURITY DEFINER`, o que
fez `current_user` ser sempre `postgres` dentro do trigger e o guard nunca
disparar. Corrigido para `SECURITY INVOKER`.

**Rollback:** `077_..._rollback.sql` (drop trigger + função).

---

## R3 🔴 RESOLVIDO — Forja de privilégio/financeiro no INSERT de cadastro (`users`)

**Evidência:** `users_insert_policy` = `WITH CHECK (true)` e o único trigger de
INSERT relevante (`users_set_trial_defaults`) só preenche `trial_ends_at`.
Nenhuma sanitização de colunas sensíveis.

**Exploit (provado em transação, rollback):** um usuário no fluxo de cadastro
(role `authenticated`, com sessão recém-criada) faz o INSERT da própria linha
incluindo `is_superuser=true, subscription_status='active', is_subscribed=true`
— e o registro nasce assim. Pior que R1: `is_superuser=true` é exatamente o que
`admin/auth.ts` (`adminLogin`/`validate_admin_session`) checa no gate de acesso
ao painel; `subscription_status='active'` dá assinatura grátis.

**Correção:** Migration 078 — trigger `users_guard_insert` (**SECURITY INVOKER**)
que, quando `current_user IN ('authenticated','anon')`:
- pina `id := auth.uid()` (anon sem uid ⇒ rejeita);
- valida `user_type IN ('motorista','embarcador')` (bloqueia `admin`);
- força defaults seguros: `is_superuser=false`, `admin_username=null`,
  `is_subscribed=false`, `subscription_status='trial'`, `documents_blocked=false`,
  `is_active=true`, `ban_reason/banned_at/banned_by=null`,
  `trial_ends_at=null` (deixa `users_set_trial_defaults` recomputar);
- `email_verified` é deixado como o cliente envia (forjá-lo é baixa severidade —
  apenas marca email como verificado, sem ganho financeiro/privilégio; o fluxo
  real de verificação usa `signup_email_verifications`). Tratado como R6.

**Validação:** INSERT do cliente com colunas forjadas ⇒ valores sobrescritos
para defaults seguros; cadastro legítimo (motorista/embarcador) segue
funcionando.

**Rollback:** `078_..._rollback.sql`.

## Próximos findings (recon em andamento)

- R2 🟡 `companies`, `company_embarcadores`, `asaas_webhook_events`,
  `support_ticket_attempts`: RLS ON, 0 policies. Confirmar acesso só por
  backend/definer (default-deny = ok) vs. rota cliente.
- R6 🟡 Troca de email pelo cliente — R1 impede mudar `email_verified`; mapear
  o fluxo completo de troca de email.
- R7 Isolamento de leitura/escrita cruzada: `documents`, `motoristas`,
  `chat_messages`, `conversations`, `notifications`, `subscriptions`,
  `frete_likes`, `avaliacoes`.
- R5 ⚪ Buckets públicos com listagem ampla.
- R4 ⚪ `function_search_path_mutable` em utilitárias/trigger.

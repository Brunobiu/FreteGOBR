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

## Próximos findings (recon em andamento)

- R2 🟡 `companies`, `company_embarcadores`, `asaas_webhook_events`,
  `support_ticket_attempts`: RLS ON, 0 policies. Confirmar acesso só por
  backend/definer (default-deny = ok) vs. rota cliente.
- R3 🟡 INSERT com `WITH CHECK (true)` em `users`/`motoristas`/`embarcadores`:
  o guard R1 cobre UPDATE; validar que o cadastro (INSERT) não forja
  `user_type`/`is_superuser`/colunas financeiras na criação.
- R6 🟡 Troca de email pelo cliente — R1 impede mudar `email_verified`; mapear
  o fluxo completo de troca de email.
- R7 Isolamento de leitura/escrita cruzada: `documents`, `motoristas`,
  `chat_messages`, `conversations`, `notifications`, `subscriptions`,
  `frete_likes`, `avaliacoes`.
- R5 ⚪ Buckets públicos com listagem ampla.
- R4 ⚪ `function_search_path_mutable` em utilitárias/trigger.

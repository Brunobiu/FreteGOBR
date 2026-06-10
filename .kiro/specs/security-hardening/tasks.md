# Security Hardening — Tarefas

Auditoria final pré-produção. Cada item: investigar (read-only) → SPEC →
corrigir → testar antes/depois → validar regressão.

## Fase 1 — Críticos

- [x] R1 🔴 Guard de colunas sensíveis em `users` (escalonamento/bypass financeiro)
  - [x] Migration 077 (`users_guard_sensitive_columns`, SECURITY INVOKER)
  - [x] Aplicada no banco
  - [x] Teste: cliente bloqueado em is_subscribed/subscription_status/documents_blocked
  - [x] Teste: perfil (name/phone/cpf/email/foto) ainda atualiza
  - [x] Teste: contexto de sistema (RPC definer) ainda altera colunas financeiras
  - [ ] Rodar suíte de testes do repo (regressão)
  - [ ] Commit + push

## Fase 2 — Em investigação (read-only primeiro)

- [ ] R2 Tabelas com RLS sem policy (`companies`, `company_embarcadores`,
      `asaas_webhook_events`, `support_ticket_attempts`): confirmar se são
      backend-only (default-deny = ok) ou se há rota cliente.
- [ ] R3 Policies `WITH CHECK (true)` em INSERT de `users`/`motoristas`/
      `embarcadores`: verificar se o cadastro pode forjar `user_type`/
      `is_superuser`/colunas financeiras na CRIAÇÃO (o guard R1 é só UPDATE).
- [ ] R6 Reset de `email` pelo cliente sem reverter `email_verified`
      (R1 já bloqueia mudar email_verified; validar fluxo de troca de email).
- [ ] R7 Isolamento de leitura/escrita: `documents`, `motoristas`,
      `chat_messages`, `conversations`, `notifications`, `subscriptions`,
      `frete_likes`, `avaliacoes` (tentar acesso cruzado).
- [ ] R5 Buckets públicos com listagem ampla (`avatars`, `company-logos`,
      `commodity_icons`, `anuncios_images`): avaliar exposição real.
- [ ] R4 `function_search_path_mutable`: endurecer `SET search_path` nas
      funções utilitárias/trigger sinalizadas.

## Notas de método
- Nada é alterado em produção sem antes provar o risco e testar a correção
  em transação com ROLLBACK.
- O relatório do Supabase advisor é tratado como PISTA, não verdade: a maioria
  dos WARN (anon/authenticated pode executar RPC definer; tabela visível no
  GraphQL) é esperada e já mitigada por `auth.uid()`/`is_admin_with_permission`
  dentro das funções. Validar caso a caso.

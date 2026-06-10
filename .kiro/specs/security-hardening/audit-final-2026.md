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

## R2 ⚪ VERIFICADO — Tabelas com RLS sem policy (default-deny correto)

`companies`, `company_embarcadores`, `asaas_webhook_events`,
`support_ticket_attempts` têm RLS ON e 0 policies. **Não é vulnerabilidade:**
RLS habilitado + nenhuma policy = deny total para `authenticated`/`anon`.
- Nenhuma é referenciada no código cliente (grep vazio).
- Prova: como cliente (`authenticated`), `SELECT count(*)` retornou 0 em todas;
  `support_ticket_attempts` tem 1 linha real (visível só como `postgres`),
  confirmando que o deny está ativo, não que a tabela está vazia.
São acessadas apenas por RPC `SECURITY DEFINER`/backend. **Ação:** nenhuma;
manter default-deny (não adicionar policy nem GRANT amplo).

## R8 🔴 RESOLVIDO — RPCs financeiras executáveis por qualquer usuário (bypass + sabotagem)
**Evidência (banco):** `subscription_mark_paid`, `subscription_mark_past_due`,
`subscription_suspend`, `subscription_reactivate` são `SECURITY DEFINER`,
recebem `p_user_id` arbitrário, **não checam `auth.uid()` nem admin nem segredo
de webhook**, e têm `EXECUTE` concedido a `anon` E `authenticated` (a 057 fez
`REVOKE ALL FROM PUBLIC`, mas o default privilege do Supabase re-concedeu a
anon/authenticated).

**Exploits:**
- `subscription_mark_paid('<meu_id>')` ⇒ assinatura paga grátis (active,
  is_subscribed=true, ciclo avançado).
- `subscription_suspend('<id_de_outro>')` / `subscription_mark_past_due(...)`
  ⇒ suspende/bloqueia a conta de qualquer outro usuário (sabotagem/DoS de conta).

**Chamadores legítimos:** apenas o webhook Asaas (edge function, `service_role`)
e o cron `run_billing_notifications` (definer, owner postgres). Nenhuma chamada
do frontend (grep confirmou). `cancel_my_subscription` é a única voltada ao
usuário e já tem guard `auth.uid()`.

**Correção:** Migration 079 — `REVOKE EXECUTE ... FROM anon, authenticated,
PUBLIC` nas 4 RPCs de transição, mantendo `service_role` e `postgres`. Defesa em
profundidade: bloquear execução quando `current_user IN ('authenticated','anon')`.

**Rollback:** `079_..._rollback.sql` (re-concede — NÃO recomendado).

## R4 ✅ RESOLVIDO — `search_path` pinado nas funções SECURITY DEFINER próprias

Migration 080: `ALTER FUNCTION ... SET search_path = public` nas 7 funções
DEFINER do projeto sem search_path (`caller_conversa_com_embarcador/_motorista`,
`get_conversation_peer`, `get_likers_of_frete`, `notify_new_message`,
`shares_conversation_with`, `toggle_frete_like`). Fecha o risco de sequestro via
search_path. Funções internas do PostGIS não são nossas (não tocadas).
Verificado: 0 funções DEFINER próprias sem search_path; chat segue funcionando.

## R5 ✅ VERIFICADO — Storage buckets

- Buckets sensíveis **privados** (`public:false`): `documents` (CNH/CRLV, MIME
  pdf/jpeg/png, 10MB) e `chat-attachments`. RLS por pasta do dono
  (`foldername[1] = auth.uid()`) + admin. Prova: cliente vê só os próprios 14
  objetos em `documents`, 0 de terceiros.
- Buckets públicos só com asset de exibição (`avatars`, `company-logos`,
  `commodity_icons`, `anuncios_images`, `community_profile`). "Listing" público
  é baixo risco aqui. ⚪ Hardening opcional: definir mime/size limit nos buckets
  `avatars`/`community_profile`/`company-logos` (hoje null). Não bloqueia.

## R6 ✅ RESOLVIDO — Troca de email não revertia verificação

Migration 081: estende `users_guard_sensitive_columns` — quando o cliente troca
`email`, `email_verified` é forçado a `false`. O cliente continua impedido de
SUBIR `email_verified` para `true` (só o fluxo de verificação via RPC definer
faz isso). Verificado: trocar email ⇒ email_verified=false; cliente não
consegue setar true; guard financeiro intacto. 97 testes passando.

## R11 ✅ RESOLVIDO — Impersonação de "Suporte" no chat (`is_admin` controlado pelo cliente)

**Evidência:** `chat.ts > sendMessage` recebe `isAdmin` e insere direto em
`chat_messages.is_admin`; a RLS de INSERT só valida `sender_id=auth.uid()`, não
o valor de `is_admin`. Um usuário comum numa conversa de suporte podia inserir
mensagem com `is_admin=true` e se passar por "Suporte FreteGO" (phishing — ex:
pedir senha). A tabela `messages` (motorista↔embarcador) não tem `is_admin`.

**Correção:** Migration 082 — trigger BEFORE INSERT `chat_messages_set_is_admin`
sobrescreve `is_admin` com a verdade do servidor (`users.is_superuser` ou
`user_type='admin'` do remetente). Cliente não decide mais.

**Validação (rollback):** usuário comum inserindo `is_admin=true` ⇒ gravado como
`false`. Impersonação bloqueada.

---

# RESUMO FINAL DA AUDITORIA

| # | Achado | Sev | Status |
|---|--------|-----|--------|
| R1 | UPDATE direto em `users` (escalonamento/bypass) | 🔴 | ✅ corrigido (077) |
| R3 | INSERT forja privilégio no cadastro | 🔴 | ✅ corrigido (078) |
| R8 | RPCs financeiras executáveis pelo cliente | 🔴 | ✅ corrigido (079) |
| R11 | Impersonação de Suporte no chat | 🟠 | ✅ corrigido (082) |
| R4 | search_path em RPCs definer | ⚪ | ✅ corrigido (080) |
| R6 | troca de email não revertia verificação | 🟡 | ✅ corrigido (081) |
| R2 | tabelas RLS sem policy | ⚪ | ✅ verificado (seguro) |
| R5 | storage buckets | ⚪ | ✅ verificado (privados ok) |
| R7 | isolamento entre usuários | — | ✅ verificado (sólido) |
| R8b | webhook Asaas + edges | — | ✅ verificado (auth ok) |
| R9 | RPCs admin | — | ✅ verificado (guard ok) |
| R10 | status active prematuro | 🟡 | 📋 registrado (cosmético) |

**3 críticos + 1 alto + 2 médios/baixos corrigidos; 5 áreas verificadas.**

## Pendências NÃO-código (responsabilidade do usuário / operacional)
- `ASAAS_WEBHOOK_TOKEN`, `EDGE_SHARED_SECRET`, `SERVICE_ROLE_KEY` setados e
  fortes em produção (são as chaves que protegem pagamento/edges).
- Habilitar "Leaked Password Protection" no Supabase Auth (advisor) — opcional.
- R10 (cosmético): decidir se `create-subscription` deve gravar `pending` em vez
  de `active` antes do webhook confirmar.
- Hardening opcional R5: mime/size limit nos buckets públicos sem limite.

## R8b ✅ VERIFICADO — Webhook Asaas (autenticidade + idempotência) e demais edges

Agora que o pagamento só é destravado por `service_role`, auditei a edge
`asaas-webhook` (a única porta que confirma pagamento):
- **Autenticidade:** valida header `asaas-access-token` contra
  `ASAAS_WEBHOOK_TOKEN` com comparação de tempo constante (`safeEq`); 401 em
  divergência; **fail-closed** se o secret não estiver setado. POST forjado sem
  o token é rejeitado.
- `verify_jwt: false` é correto (Asaas não envia JWT Supabase); a auth é o token.
- **Idempotência:** INSERT em `asaas_webhook_events` com `asaas_event_id` UNIQUE;
  duplicado ⇒ 200 sem efeito.
- Usa `SERVICE_ROLE_KEY` (escreve ignorando RLS) — correto.
**Ação:** nenhuma. ⚠️ Operacional: garantir que `ASAAS_WEBHOOK_TOKEN` esteja
realmente setado no ambiente de produção (sem ele, fail-closed = nenhum
pagamento confirma; com valor fraco = risco). Não dá pra ler o valor pelo MCP.

`asaas-create-subscription`: valida JWT do usuário, fixa
`externalReference = authUser.id` (impede redirecionar confirmação para outro),
exige `user_type='motorista'`. Seguro.

**Demais edges (`verify_jwt:false`):** todas exigem `Authorization: Bearer
<SERVICE_ROLE_KEY>` (ou `EDGE_SHARED_SECRET`), 401 caso contrário:
- `send-push-notification` ✅ (chamada via pg_net/trigger com service-role).
- `send-verification-email` ✅ (service-role OU edge-shared-secret).
- `meta-capi-forward`, `assistant-monitor`: mesmo padrão Bearer-secret; não são
  caminho financeiro/privilégio. Auditoria detalhada de baixa prioridade.
- `assistant-ai`, `meta-marketing-read`, `asaas-create-subscription`:
  `verify_jwt:true` (exigem JWT de usuário).

## R10 🟡 — `create-subscription` grava `subscriptions.status='active'` antes do pagamento

**Não é falha de segurança** (o gate de acesso `motorista_can_interact` lê
`users.subscription_status`/`is_subscribed`, que essa função NÃO altera — só o
webhook altera após confirmação real). Porém é incorreção de dado: um checkout
PIX/boleto ainda `pending` aparece como assinatura `active` em `subscriptions`
(pode enganar UI/`list_my_charges`). Sugestão: gravar `status='past_due'` ou
um estado `pending` até o webhook confirmar. Decisão do usuário; não bloqueia.

## R9 ✅ VERIFICADO — RPCs administrativas têm guard interno

As 15 RPCs admin sinalizadas pelo advisor (`admin_delete_user`,
`admin_delete_frete`, `admin_extend_trial`, `admin_force_logout`,
`admin_notify_user`, `rpc_create_broadcast`, `admin_blacklist_*`,
`admin_list_*`, `admin_dashboard_metrics`, `admin_review_document`) **todas têm
`is_admin_with_permission(...)` por dentro**. Mesmo com EXECUTE para
`authenticated`, um não-admin recebe `permission_denied`.
- Prova: chamada de `admin_extend_trial` por usuário comum (motorista de teste)
  ⇒ bloqueada (`42501`). Os WARN do advisor para essas funções são ruído.
**Ação:** nenhuma.

## R7 ✅ VERIFICADO — Isolamento entre usuários (read/write cruzado)

Auditadas as policies e testado acesso cruzado real como cliente
(`authenticated`, JWT do motorista de teste), tudo em transação rollback:

- `documents` (CNH, CRLV, etc.): vê só os próprios (0 de outros; 14 próprios).
  Admin via `is_admin_with_permission('USER_VIEW')`.
- `subscriptions` / `subscription_charges`: SELECT só `user_id=auth.uid()`;
  escrita `USING/CHECK false` (`*_no_dml`) — cliente NUNCA muta, só RPC definer.
- `notifications`, `motorista_pis`, `motorista_references`, `device_tokens`:
  0 linhas de outros usuários.
- `conversations` / `messages` / `chat_messages`: escopados aos participantes
  (`motorista_id`/`embarcador_id`/`user_id = auth.uid()`). Teste: 0 mensagens e
  0 conversas de terceiros visíveis.
- Público por design (baixo risco, intencional): `avaliacoes` (reputação) e
  `frete_likes` (curtidas) têm SELECT `USING (true)`. Sem PII sensível exposta.

**Conclusão:** isolamento entre usuários sólido nas tabelas de dados pessoais e
financeiros. Nenhuma ação corretiva necessária.

## Em investigação (próxima sessão)

- R6 🟡 Troca de email pelo cliente — R1 impede mudar `email_verified`; mapear
  o fluxo completo de troca de email (garantir que trocar email reverta o
  status verificado, hoje só via PATCH de `email`).
- R5 ⚪ Buckets públicos com listagem ampla (`avatars`, `company-logos`,
  `commodity_icons`, `anuncios_images`).
- R4 ⚪ `function_search_path_mutable` em utilitárias/trigger.
- RPCs financeiras (`subscription_mark_paid`/`_suspend`/`_reactivate`): validar
  que só webhook/admin podem chamar (têm guard interno?).

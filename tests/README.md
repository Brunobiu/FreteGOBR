# Testes — FreteGO

Guia de execução das suítes de teste. Spec completa em
`.kiro/specs/testes/`. Governança em `.kiro/steering/testing-governance.md`.

## Estrutura

```
src/__tests__/            # código puro: unit + property (pre-commit + CI)
  _helpers/               # geradores e assertions canônicas compartilhados
tests/                    # depende de ambiente externo (só CI)
  integration/            # fluxos ponta a ponta com Supabase (branch efêmero)
  contract/               # snapshot de contrato Zod
  e2e/                    # Playwright (desktop + mobile)
  security/               # injeção, RLS, rate limit, secret scan
  performance/            # k6 (carga/stress)
  coverage.config.ts      # Critical_Modules e thresholds
```

## Comandos

### Unit + property (rápido, local)

```bash
npm run test            # watch mode
npm run test:run        # uma execução (CI)
npm run test:run -- --coverage   # com cobertura
```

### Cobertura de Critical_Modules

```bash
npm run test:run -- --coverage
npx tsx scripts/check-coverage.ts   # falha se algum módulo crítico < threshold
```

### Type-check e build

```bash
npx tsc --noEmit
npm run build
```

### Rodar um arquivo específico

```bash
npx vitest run src/__tests__/calculoFrete.invariants.property.test.ts
```

## Convenções

- Property-based com fast-check; ver `.kiro/steering/testing-governance.md`.
- `fc.stringOf` não existe — usar `fc.string({...}).filter(...)`.
- PII (phone/CPF/CNPJ/email): `fc.constantFrom` de templates fixos válidos
  (ver `src/__tests__/_helpers/generators.ts`).
- Assertions de governança: reusar `_helpers/` (`expectPermissionDenied`,
  `expectAntiEnumeration`, `expectNoSecrets`).

## Status das fases (spec `testes`)

- Fase 0 (fundação): ✅ helpers, geradores, coverage check
- Fase 1 (unitários): ✅ financeiro, comissão, RBAC, parsing, CSV, concorrência
- Fases 2–7 (integração, segurança, E2E, performance, pipeline): pendentes —
  exigem branch Supabase efêmero e secrets de CI.
- Fase 8 (governança): ✅ steering + template de PR

## Regression_Suite — feature Assinaturas e Pagamento (Asaas)

Testes incorporados à suíte de regressão (rodam no pre-commit + CI):

- `src/__tests__/cp1_subscription_plans.property.test.ts` — catálogo de planos
  (Property 1: totais fixos 39,90 / 104,70 / 179,40 e determinismo).
- `src/__tests__/cp3_access_state.property.test.ts` — máquina de estados de
  acesso (Property 2 determinismo + Property 3 invariante de suspensão).
- `src/__tests__/cp4_asaas_webhook.property.test.ts` — mapeamento evento→ação
  e idempotência do webhook (Property 4).
- `src/__tests__/cp5_billing_notifier.property.test.ts` — seleção do
  Billing_Notifier (Property 5: janela de trial + suspensão por grace).
- `src/__tests__/trialBadge.example.test.tsx` — render do selo (FREE·N dias /
  PRO / oculto).
- `src/__tests__/likeButtonSuspended.example.test.tsx` — bloqueio de interação
  do motorista suspenso (aviso pt-BR + CTA), trial/ativo interage.
- `src/__tests__/adminSubscriptions.example.test.tsx` — filtros do painel
  admin (round-trip), erro tipado e gating Stealth_404 sem FINANCEIRO_VIEW.

Núcleo puro (espelho TS da autoridade SQL): `src/utils/subscriptionPlans.ts`,
`src/utils/trialStatus.ts` (Critical_Module, ≥85%), `src/utils/asaasWebhook.ts`,
`src/utils/billingNotifier.ts`.

Documentação operacional da feature: `docs/assinaturas-asaas.md`.

## Regression_Suite — feature Frete Comunidade

Testes incorporados à suíte de regressão (rodam no pre-commit + CI). Núcleo
puro + property-based (Properties 1–7 do design) + UI/serviço.

Property tests (núcleo puro, `src/__tests__/`):

- `cp1_community_sheet_roundtrip.property.test.ts` — round-trip do
  Modelo_Planilha (Property 1: gerar CSV → parsear reproduz linhas).
- `cp2_community_template_validation.property.test.ts` — Template_Validation
  exata (Property 2: cabeçalho divergente ⇒ INVALID_TEMPLATE).
- `cp3_community_row_validation.property.test.ts` — validação de linha
  determinística e completa (Property 3).
- `cp4_community_dedup.property.test.ts` — dedup por tupla completa, simétrico,
  idempotente e estável (Property 4).
- `cp5_community_expiry.property.test.ts` — Auto_Expiracao: visível sse
  now < ref+5d, reset reabre janela, idempotência (Property 5).
- `cp6_community_phone_deeplink.property.test.ts` — normalização de telefone
  idempotente + WhatsApp_Deep_Link com domínio + null quando inválido (Property 6).
- `cp7_community_city_precondition.property.test.ts` — City_Resolution é
  pré-condição de publicação (Property 7).

UI e serviço:

- `src/__tests__/admin/comunidade/communityAdminUI.test.tsx` — gating
  Stealth_404, preview editável, botão Publicar, contagem de duplicados.
- `src/__tests__/admin/comunidade_service.test.ts` — `mapError` (códigos →
  pt-BR canônico), filtros round-trip, validação de foto (MIME/limite).
- `src/__tests__/communityDriverUI.test.tsx` — card/modal comunidade vs normal,
  botão WhatsApp (deep-link), sem telefone oculta o botão, não-regressão do Chat.

Núcleo puro (espelho TS da autoridade SQL): `src/utils/communitySheet.ts`,
`src/utils/communityDedup.ts`, `src/utils/communityExpiry.ts`,
`src/utils/communityFrete.ts`.

Migrations: `061_frete_comunidade.sql` (colunas + perfil + dedup index),
`062_frete_comunidade_rls.sql` (expiração + flag no feed),
`063_frete_comunidade_rpcs.sql` (perfil, listagem, publicação, cron).

Documentação operacional da feature: `docs/frete-comunidade.md`.

## Regression_Suite — feature Central de Suporte Inteligente

Testes incorporados à suíte de regressão (rodam no pre-commit + CI). Núcleo
puro + property-based (CP1–CP5 obrigatórias; CP7*–CP10* opcionais) + serviço +
UI. Qualquer falha (inclusive flaky pós-retry) bloqueia merge/deploy.

Property tests (núcleo puro, `src/__tests__/admin/suporte/`):

- `cp1_exclusao_mutua.property.test.ts` — exclusão mútua IA×humano (Property 1):
  nenhuma mensagem de IA persiste sob `responder_mode='human'`; flip humano é
  atômico (model-based sobre `responderModeReducer`).
- `cp2_transicoes_status.property.test.ts` — máquina de estados (Property 2):
  `isValidTransition` ⇔ `to ∈ STATUS_TRANSITIONS[from]`; `closed` terminal.
- `cp3_permission_denied.property.test.ts` — precedência de `permission_denied`
  (Property 3) sobre validação simultânea (no `mapPostgresError` + no service).
- `cp4_idempotencia_handoff.property.test.ts` — idempotência de Handoff/
  Return_To_AI (Property 4): `f(f(x)) == f(x)`, `_SKIPPED`.
- `cp5_priority_classifier.property.test.ts` — classificação determinística de
  prioridade (Property 5): crítico ⇒ 3; senão `true`⇒1, `false`⇒2.
- `cp7_filtro_listagem.property.test.ts` (opcional) — filtro/ordenação/paginação.
- `cp8_answerable_signal.property.test.ts` (opcional) — `confidence >= threshold`.
- `cp9_kb_exposicao.property.test.ts` (opcional) — FAQ exposta à IA sse publicada.
- `cp10_validacao_faq.property.test.ts` (opcional) — validações de FAQ/threshold.

Unit/serviço/UI:

- `pureFunctions.unit.test.ts` + `coverageHelpers.unit.test.ts` — exemplos/edge
  da máquina de estados, classificador, validações, guards e Context_Builder.
- `permissions_suporte.unit.test.ts` — delta da Permission_Matrix (FAQ_VIEW a
  SUPORTE; FAQ_EDIT/SUPORTE_AI_CONFIG só ADMIN/SUPER_ADMIN).
- `suporte_service.test.ts` — `mapPostgresError`, `derivePlanoLabel`, `_SKIPPED`
  sem audit positivo, audit positivo em mutação real, `AI_LOCKED`/`STALE_VERSION`.
- `suporteUI.test.tsx` — gating Stealth404, lista compacta (sem `<h1>`, default
  10, "Sem plano", "Crítico"), "Retornar para IA" gated por SUPORTE_REPLY,
  validação de FAQ bloqueando envio + erro pt-BR.

Integração (`tests/suporte/`, só CI — branch Supabase efêmero):

- `rls_isolation.test.ts` — RLS de `support_kb_entries`/`support_ai_config`;
  gating de `support_admin_list_tickets` + `SUPORTE_VIEW_DENIED` persistido.
- `ai_mutual_exclusion.test.ts` — exclusão mútua server-side (CP1): claim
  idempotente, `insert_ai_reply` resolve, `AI_LOCKED` sob humano, handoff
  `ALREADY_HUMAN`.
- `migration_schema.test.ts` — amplificação `status` 3→5, colunas novas,
  singleton `support_ai_config`.

Núcleo puro (espelho TS da autoridade SQL) — Critical_Modules em
`tests/coverage.config.ts`: `src/services/admin/suporte/{statusMachine,
priorityClassifier,validation,responderModeReducer,listFilter,knowledgeBase}.ts`.

Migrations: `115_suporte_inteligente.sql` (amplifica `support_tickets` 3→5
estados + `responder_mode`/`priority_level`; `author_kind`; `support_kb_entries`;
`support_ai_config`; RBAC `FAQ_VIEW`/`FAQ_EDIT`/`SUPORTE_AI_CONFIG`; RLS; trigger
de reabertura) e `115b_suporte_inteligente_rpcs.sql` (RPCs `SECURITY DEFINER` +
`support_ai_claims`), cada uma com par `_rollback` documentado.

Edge Function: `supabase/functions/support-ai-reply` (reusa a
Provider_Abstraction de `admin-assistant`; chave no Vault, nunca no frontend).

## Regression_Suite — feature Cliente 360 (Pesquisa Global + Visão 360)

Testes incorporados à suíte de regressão (rodam no pre-commit + CI). Núcleo
puro + property-based (CP1–CP8 obrigatórias; CP9* opcional) + serviço + UI.
Qualquer falha (inclusive flaky pós-retry) bloqueia merge/deploy.

Property tests (`src/__tests__/admin/cliente-360/`):

- `cp1_busca_determinismo.property.test.ts` — determinismo e ordenação total da
  busca (Property 1): ordem estrita `match_rank ASC → name ASC → id ASC`,
  idempotência e invariância a permutação da entrada (`runSearch`).
- `cp2_busca_isolamento.property.test.ts` — isolamento (Property 2): nenhum
  `Search_Result` com `user_type='admin'`; caller sem `USER_VIEW`/`auth.uid()`
  nulo ⇒ `permission_denied`.
- `cp3_sanitizacao_fronteiras.property.test.ts` — sanitização (Property 3):
  escape lossless de `% _ \` (sem curinga ativo), `<2` não-UUID ⇒ vazio, clamp
  de `p_limit` em `[1,50]`.
- `cp4_degradacao_parcial.property.test.ts` — degradação parcial por bloco
  (Property 4): falha de bloco != Source propaga só `errors[bloco]`; gated sem
  permissão é omitido; o assembler nunca lança.
- `cp5_precedencia_permission_denied.property.test.ts` — precedência (Property 5)
  de `permission_denied` sobre validação simultânea (modelo da ordem do servidor
  + `mapPostgresError`).
- `cp6_notas_isolamento.property.test.ts` — notas nunca expostas a não-admin
  (Property 6): leitura por anon/cliente/admin sem `USER_NOTE_VIEW` ⇒ 0 linhas.
- `cp7_notas_idempotencia_versionamento.property.test.ts` — idempotência e
  versionamento (Property 7): `STALE_VERSION` sem mutar; N remoções ⇒ 1
  `USER_NOTE_DELETE` + (N−1) `_SKIPPED`; erro != inexistência propaga.
- `cp8_privacidade_por_bloco.property.test.ts` — privacidade por bloco
  (Property 8): bloco presente ⇔ permissão; ausência ⇒ chave `undefined`; grant
  de notas só `SUPER_ADMIN`/`ADMIN`.
- `cp9_login_correlacao.property.test.ts` (opcional) — correlação de login por
  telefone normalizado; vazio sem telefone; invariância a máscara.

Unit/serviço/UI:

- `pureFunctions.unit.test.ts` — exemplos/edge de `normalizeQuery`/`escapeIlike`/
  `assignMatchRank`/`compareSearchResults`/`clampSearchLimit`/correlação.
- `permissions_notes.unit.test.ts` — delta da Permission_Matrix (`USER_NOTE_VIEW`/
  `USER_NOTE_EDIT` só `SUPER_ADMIN`/`ADMIN`).
- `cliente360_service.test.ts` — `mapPostgresError` (sem vazar PII),
  `validateNoteBody`, `globalSearch` (reordenação), CRUD de notas, Source_Block
  `NOT_FOUND`, omitido vs vazio vs erro no assembler.
- `buscaUI.test.tsx` — Topbar gated por `USER_VIEW`, debounce/dropdown/teclado;
  SearchPage gating/`?q=`/estado vazio.
- `cliente360UI.test.tsx` — estados dos blocos, `NotaEditor` bloqueando envio
  inválido + erro pt-BR, omissão de blocos gated na `User_Detail_Page`.

Integração (`tests/admin/cliente360/`, só CI — branch Supabase efêmero):

- `notes_rls.integration.test.ts` — RLS de `admin_user_notes` (CP-6): anon/dono/
  outro/SUPORTE ⇒ 0 linhas; ADMIN lê; escrita direta negada.
- `financial_login_security_definer.integration.test.ts` — `admin_user_financial_history`/
  `admin_user_login_history` sob `SECURITY DEFINER` sem afrouxar a RLS de
  `subscriptions`/`login_attempts`; isolamento entre contas.
- `notes_master_rbac.integration.test.ts` — Master_Admin imutável
  (`master_admin_immutable`) + grant de `USER_NOTE_VIEW`/`EDIT` (CP-8).
- `migration116_schema.integration.test.ts` — CHECK de `body` 1..5000, RLS
  bloqueia anon, trigger `updated_at`.

Núcleo puro (Critical_Modules em `tests/coverage.config.ts`):
`src/services/admin/cliente360/{search,ranking,loginCorrelation}.ts`. O service
`cliente360.ts` (wrappers de RPC) e a UI (`.tsx`) ficam fora do gate por ora.

Migration: `116_admin_cliente_360.sql` (tabela `admin_user_notes` + RLS admin-only;
re-asserção de `is_admin_with_permission` reconhecendo `USER_NOTE_VIEW`/`EDIT`;
RPCs `admin_global_search`/`admin_user_financial_history`/`admin_user_login_history`/
`admin_user_note_create`/`_update`/`_delete`) + par `_rollback` documentado.

## Regression_Suite — feature Central de Operação (Painel + Alertas + Logs)

Testes incorporados à suíte de regressão (rodam no pre-commit + CI). Núcleo
puro + property-based (CP1–CP10 obrigatórias; CP11* opcional) + serviço + UI.
Qualquer falha (inclusive flaky pós-retry) bloqueia merge/deploy.

Property tests (`src/__tests__/admin/operacao/`):

- `cp1_metrics_shape.property.test.ts` — determinismo das métricas (Property 1):
  `adaptOperationsBundle` total e estável; fonte ausente ⇒ `{value:null,
  available:false}` (nunca `0`); grupo em `errors` força seus KPIs a indisponíveis.
- `cp2_realtime_refresh.property.test.ts` — não-sobreposição do Realtime_Refresh
  (Property 2): `reduce` nunca emite `startFetch` com `inFlight`; pausa em aba
  oculta; piso de intervalo; manual zera o temporizador.
- `cp3_alert_evaluator.property.test.ts` — determinismo do Alert_Evaluator
  (Property 3): mesmo snapshot ⇒ mesmo conjunto; severidade fixada por
  `ALERT_SEVERITY_MAP`; fonte ausente ⇒ zero alertas do tipo.
- `cp4_reconcile_dedup.property.test.ts` — dedup/idempotência da reconciliação
  (Property 4): `reconcile` não reabre chave ativa; reaplicar ⇒ `toOpen` vazio.
- `cp5_auto_resolve.property.test.ts` — auto-resolução consistente (Property 5):
  `toResolve` é exatamente o conjunto das chaves ativas sem situação.
- `cp6_ack_resolve_reducer.property.test.ts` — idempotência/versionamento de
  ack/resolve (Property 6, model-based `applyAlertOp`): `_SKIPPED`/`STALE_VERSION`
  sem mutar; `RESOLVED` terminal; N acks ⇒ 1 transição + N−1 `_SKIPPED`.
- `cp7_permission_precedence.property.test.ts` — precedência de `permission_denied`
  (Property 7) sobre validação simultânea, em qualquer papel (modelo da ordem do
  servidor + `mapOperacaoError`).
- `cp8_isolation_no_leak.property.test.ts` — isolamento e não-vazamento
  (Property 8): `sanitizeAlertDetailView`/`buildLogSummary`/`adaptOperationsBundle`
  nunca emitem PII/segredos (`expectNoSecrets`); guard sem permissão ⇒ recusa sem
  dados.
- `cp9_ordering.property.test.ts` — ordenação total determinística (Property 9):
  `compareAlerts`/`compareLogs` antissimétricas/transitivas/estáveis.
- `cp10_log_event_map.property.test.ts` — totalidade do Log_Event_Map
  (Property 10): `resolveActionCodes` total/determinística; `LOGOUT`/
  `CLIENT_CREATED` ⇒ `[]`.

Unit/serviço/UI:

- `pureFunctions.unit.test.ts` — exemplos/edge dos seis módulos puros.
- `permissions_operacao.unit.test.ts` — delta da Permission_Matrix (`ALERT_VIEW`/
  `ALERT_ACK`/`ALERT_RESOLVE`/`LOG_VIEW`).
- `operacao_service.test.ts` — `mapOperacaoError` (precedência, sem vazar erro
  cru), `getOperationsMetrics` (adaptação/degradação/`permission_denied`
  preservado), `listAlerts`/`listLogs` (mapeamento + sanitização + rótulo
  canônico), ack/resolve (audit positivo só em mutação real; `_SKIPPED` sem
  audit; `STALE_VERSION`/`INVALID_STATE_TRANSITION`; audit-fail-não-bloqueia via
  `expectMutationSucceedsDespiteAuditFailure`), `triggerEvaluate`.
- `operacaoUI.test.tsx` — gating Stealth_404 (dashboard/alertas/logs); KPI
  `indisponível` ≠ 0; degradação parcial por grupo; visibilidade de
  Reconhecer/Resolver por permissão; filtro de logs inválido bloqueia "Aplicar" +
  erro pt-BR; paginação default 10; ausência de `<h1>`; logs somente-leitura +
  estado vazio; item "Operacao" na sidebar gated por `DASHBOARD_VIEW`.

Integração (`tests/admin/operacao/`, só CI — branch Supabase efêmero):

- `migration117_schema.integration.test.ts` — CHECK de `alert_type`/`severity`/
  `state`; índice único PARCIAL de dedup (1 ativo por situação; reabre após
  `RESOLVED`); RLS bloqueia anon; trigger `updated_at`.
- `alerts_rls_rbac.integration.test.ts` — RLS de `system_alerts` (anon/Cliente/
  SUPORTE/FINANCEIRO/MODERADOR ⇒ 0 linhas; ADMIN lê; escrita direta negada) +
  paridade `is_admin_with_permission` das 4 ações novas (só SUPER_ADMIN/ADMIN).
- `operacao_rpcs_gating.integration.test.ts` — admin lê
  metrics/alerts_list/logs_list; Cliente ⇒ `permission_denied` (42501) em todas as
  RPCs; isolamento (Cliente não lê `system_alerts`).
- `alerts_lifecycle.integration.test.ts` — `admin_alerts_evaluate` abre/dedup/
  auto-resolve (`ALERT_GENERATED` persistido); ack/resolve com versionamento;
  `_SKIPPED` (`ALERT_ACK_SKIPPED`/`ALERT_RESOLVE_SKIPPED`) + audit positivo
  `ALERT_ACK` persistidos; `STALE_VERSION`/`INVALID_STATE_TRANSITION`; ack não
  toca `users` (Master_Admin imutável por construção).

Núcleo puro (Critical_Modules em `tests/coverage.config.ts`):
`src/services/admin/operacao/{metricsShape,realtimeRefresh,alertEvaluator,
alertLifecycle,ordering,logEventMap}.ts`. O service `operacao.ts` (wrappers de
RPC) e a UI (`.tsx`) ficam fora do gate por ora.

Migration: `117_admin_central_operacao.sql` (tabela `system_alerts` + índice
único parcial de dedup + RLS admin-only; re-asserção de `is_admin_with_permission`
reconhecendo `ALERT_VIEW`/`ALERT_ACK`/`ALERT_RESOLVE`/`LOG_VIEW`; RPCs
`admin_operations_metrics`/`admin_alerts_list`/`admin_logs_list`/
`admin_alerts_evaluate`/`admin_alert_acknowledge`/`admin_alert_resolve`; agendamento
`pg_cron` defensivo) + par `_rollback` documentado.

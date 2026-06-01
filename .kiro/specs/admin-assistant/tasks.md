# Implementation Plan — Assistente de IA do Painel Admin (`admin-assistant`)

## Overview

Plano de implementação incremental do módulo **Assistente** (`/admin/assistant`), organizado em
épicos. Cada task é coding-only e referencia critérios de aceitação (`requirements.md`, Reqs X.Y)
e/ou propriedades de correção (`design.md`, CP-N). A ordem de construção segue o design: banco
(migration 047 + RBAC) → captura global de erros → lógica pura do service → classificador →
abstração de provedor → wrappers → Edge Functions → UI/roteamento → integração/smoke.

Cada prompt constrói sobre o anterior e termina integrando o que foi feito; não há código órfão.
A lógica pura (canônica em `src/services/admin/`) é o alvo dos testes de propriedade (Vitest +
fast-check); as Edge Functions (Deno) honram o mesmo contrato determinístico.

Convenções herdadas (não redocumentar — ver `project-conventions.md` e `admin-patterns.md`):
- TypeScript strict; pt-BR em UI/comentários; identifiers, action codes e error codes em inglês.
- Migration idempotente com `BEGIN/COMMIT`, `DO $check$` defensivo, `-- VERIFY` final, par rollback.
- RPCs `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO authenticated`; gating via `is_admin_with_permission`; path negativo grava
  `ASSISTANT_VIEW_DENIED`.
- Mutações via `executeAdminMutation`; versionamento otimista (`updated_at` + `STALE_VERSION`).
- Padrão compacto pós-cleanup (sem `<h1>` grande); degradação parcial via `Promise.allSettled`.
- Segredos apenas no Vault + Edge Function; nunca no frontend nem em colunas legíveis.
- fast-check: `vi.mock` hoisted → spies via `(globalThis as Record<string, unknown>).__spy`; sem
  `fc.stringOf`; `fc.constantFrom` para amostras de domínio fechado; mínimo 100 iterações.
- **Property tests CP-1..CP-25 são obrigatórios e NÃO levam asterisco.** Testes complementares
  (exemplo/edge/integração/smoke) são opcionais e levam `*`.
- Sem novas dependências npm (Claude via `fetch` na Edge Function).

## Tasks

- [x] 1. Migration 047 e RBAC server-side
  - [x] 1.1 Adicionar permissões `ASSISTANT_VIEW`/`ASSISTANT_EDIT` em `src/services/admin/permissions.ts`
    - Acrescentar `'ASSISTANT_VIEW'` e `'ASSISTANT_EDIT'` ao array `ADMIN_ACTIONS`.
    - Acrescentar as duas ações ao conjunto `ADMIN_DENY` para que o ramo `ADMIN: (a) => ALL.has(a) && !ADMIN_DENY.has(a)` negue ambas a `ADMIN`.
    - `SUPER_ADMIN: () => true` já concede; `FINANCEIRO`/`SUPORTE`/`MODERADOR` negam por allowlist.
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 1.2 Criar scaffold de `supabase/migrations/047_admin_assistant.sql` + `is_admin_with_permission`
    - Cabeçalho com objetivo e dependências; envolver todo o conteúdo em um único `BEGIN; ... COMMIT;`.
    - Bloco `DO $check$` validando presença da migration 030 (`is_admin_with_permission`, `admin_audit_logs`) e da extensão `supabase_vault` (042b); `RAISE EXCEPTION` clara se ausentes.
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission`: preservar corpo existente e incluir `'ASSISTANT_VIEW','ASSISTANT_EDIT'` na lista de exclusão do ramo `ADMIN` (`p_action NOT IN (...)`); ramo `SUPER_ADMIN` cobre as duas; anônimo (`auth.uid()` nulo) retorna falso.
    - _Requirements: 2.3, 2.4, 14.3, 15.1, 15.2, 15.4_

  - [x] 1.3 Criar tabelas + índices + RLS Owner_Only_Gate (idempotente)
    - `CREATE TABLE IF NOT EXISTS` para `error_logs`, `assistant_conversations`, `assistant_messages` (`role` CHECK `IN ('user','assistant','system')`), `assistant_critical_events` (com `dedup_key text NOT NULL` + `UNIQUE (dedup_key)`), `assistant_config` (registro único `id boolean PK DEFAULT true CHECK (id)`; `active_provider` default `claude`; thresholds `CHECK >= 1`; `cron_interval_minutes CHECK BETWEEN 1 AND 5`; `whatsapp_toggle default false`; sem colunas de segredo).
    - `CREATE INDEX IF NOT EXISTS`: `error_logs(occurred_at DESC)`, `(error_type, occurred_at DESC)`; `assistant_messages(conversation_id, created_at ASC)`.
    - `ENABLE ROW LEVEL SECURITY` em todas; `DROP POLICY IF EXISTS` antes de `CREATE POLICY`: `SELECT/INSERT/UPDATE/DELETE` sob `is_admin_with_permission('ASSISTANT_VIEW')` (escrita de config sob `ASSISTANT_EDIT`); `error_logs` somente leitura sob `ASSISTANT_VIEW`, sem policy de insert direto (insert só pela RPC controlada).
    - _Requirements: 3.10, 6.6, 7.1, 14.7, 15.5_

  - [x] 1.4 RPC `rpc_assistant_ingest_errors(p_batch jsonb)` (exceção controlada)
    - `SECURITY DEFINER`, `search_path=public`; aceita `authenticated` (sem `is_admin_with_permission`), pois a ingestão funciona para qualquer sessão; `affected_user_id` nulo quando sem sessão.
    - Valida cada item: `error_type` no domínio fechado (`react_render`,`window_error`,`unhandled_rejection`,`console_error`,`request_failure`); item inválido é rejeitado (não a transação).
    - Limite anti-flood por chamada (ignora itens além de N, marca `throttled`). Retorna `{ inserted, rejected, throttled }`.
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
    - _Requirements: 3.5, 3.6, 3.9, 3.10, 14.7_

  - [x] 1.5 RPCs `rpc_assistant_get_config()` e `rpc_assistant_update_config(p_patch jsonb, p_expected_updated_at)`
    - `get_config`: gated `ASSISTANT_VIEW`; retorna config + `is_set` por provider (derivado da existência do segredo no Vault), sem valor bruto.
    - `update_config`: gated `ASSISTANT_EDIT`; valida thresholds inteiros `>= 1` e `cron_interval_minutes` em `1..5` (inválido ⇒ `RAISE` tipado, sem persistir); update otimista `WHERE updated_at = p_expected_updated_at`, `ROW_COUNT=0` ⇒ `STALE_VERSION`.
    - Path negativo grava `ASSISTANT_VIEW_DENIED` (`before` nulo, `after = {user_id, reason}`) e aborta; `REVOKE`/`GRANT`.
    - _Requirements: 7.4, 10.5, 10.6, 14.3, 14.4_

  - [x] 1.6 RPCs `rpc_assistant_set_secret(p_provider, p_raw)` e `rpc_assistant_clear_secret(p_provider)` (Vault)
    - `set_secret`: gated `ASSISTANT_EDIT`; grava o valor bruto no Vault sob nome `assistant_provider_key_<provider>`; audit apenas metadados não sensíveis (`ASSISTANT_PROVIDER_KEY_UPDATED`).
    - `clear_secret`: gated `ASSISTANT_EDIT`; apaga do Vault (`is_set=false`); audit `ASSISTANT_PROVIDER_KEY_CLEARED`.
    - Nunca retornam o valor bruto; path negativo `ASSISTANT_VIEW_DENIED`; `REVOKE`/`GRANT`.
    - _Requirements: 7.3, 7.5, 14.1, 14.6_

  - [x] 1.7 RPCs de conversa/mensagem: `list_conversations`, `load_conversation`, `post_message`
    - `rpc_assistant_list_conversations()`: gated `ASSISTANT_VIEW`; sumários `ORDER BY updated_at DESC`.
    - `rpc_assistant_load_conversation(p_id)`: gated `ASSISTANT_VIEW`; mensagens `ORDER BY created_at ASC`.
    - `rpc_assistant_post_message(p_conversation_id, p_role, p_content)`: gated `ASSISTANT_VIEW`; valida `role` no domínio fechado (fora ⇒ `RAISE`); insere e toca `updated_at` da conversa; cria conversa quando `p_conversation_id` nulo.
    - Path negativo `ASSISTANT_VIEW_DENIED`; `REVOKE`/`GRANT`.
    - _Requirements: 5.5, 5.7, 6.1, 6.2, 6.3_

  - [x] 1.8 RPCs `rpc_assistant_persist_critical_event(p_event jsonb)` e `rpc_assistant_get_status()`
    - `persist_critical_event`: invocável por service-role/monitor; `INSERT ... ON CONFLICT (dedup_key) DO NOTHING` (dedup idempotente); preenche `conversation_id`/`notified_at`.
    - `get_status`: gated `ASSISTANT_VIEW`; retorna ativo/inativo (derivado de `is_set` do `active_provider`), `active_provider`+`model` e últimos `assistant_critical_events`.
    - `REVOKE`/`GRANT`; path negativo `ASSISTANT_VIEW_DENIED` no `get_status`.
    - _Requirements: 7.6, 7.7, 12.7, 12.8_

  - [x] 1.9 Seed de config + agendamento `pg_cron` idempotente + bloco `-- VERIFY`
    - `INSERT INTO assistant_config (...) VALUES (...) ON CONFLICT (id) DO NOTHING` com `active_provider='claude'`, `whatsapp_toggle=false`, thresholds e `cron_interval_minutes` válidos (não sobrescreve existente).
    - `pg_cron` idempotente: `cron.unschedule('assistant_monitor_job')` condicional + `cron.schedule(...)` invocando `assistant-monitor` via `net.http_post`; URL/service key lidos do Vault (padrão 042b).
    - Bloco `-- VERIFY` permanentemente comentado com SELECTs de smoke manual.
    - _Requirements: 12.1, 13.1, 15.3, 15.6, 15.7, 15.8, 15.10_

  - [x] 1.10 Criar `supabase/migrations/047_admin_assistant_rollback.sql`
    - Documenta `cron.unschedule` + `DROP` reverso de RPCs, policies, tabelas e funções (ordem reversa de dependência); não auto-aplicado.
    - _Requirements: 15.9_

  - [x] 1.11 Property test CP-1 (Owner_Only_Gate)
    - `src/__tests__/admin/assistant/cp1Rbac.property.test.ts`. Tag `// Feature: admin-assistant, Property 1`.
    - **Property 1:** para todo `AdminRole` e ação em `{ASSISTANT_VIEW, ASSISTANT_EDIT}`, `hasPermission(role, action)` é verdadeiro sse `role === 'SUPER_ADMIN'`. `roleGen = fc.constantFrom(...)`; `numRuns: 100`.
    - **Validates: Requirements 1.4, 1.5, 2.1, 2.2**

  - [x] 1.12 Property test CP-2 (deny-by-default fora do domínio)
    - Mesmo arquivo `cp1Rbac.property.test.ts` (bloco/describe distinto). Tag `// Feature: admin-assistant, Property 2`.
    - **Property 2:** para todo `AdminRole` e toda string fora de `ADMIN_ACTIONS`, `hasPermission(role, str)` é falso. `numRuns: 100`.
    - **Validates: Requirements 2.5**

- [x] 2. Global_Error_Capture (frontend)
  - [x] 2.1 Criar `src/services/admin/errorCapture.ts` — núcleo (draft + fila + captura segura)
    - Tipos `ErrorType`, `ErrorLogDraft`, `CaptureConfig`.
    - `buildErrorDraft(input)`: produz `{ occurredAt (ISO), errorType (domínio), route, message, stack: string|null, affectedUserId: string|null }`; não falha sem sessão.
    - `captureError(draft)`: enfileira; nunca lança; guard global de reentrância (`__assistantCaptureReentrant`); fila com `maxQueue` (descarta excedente em silêncio).
    - _Requirements: 3.5, 3.6, 3.7, 3.8_

  - [x] 2.2 `installGlobalErrorCapture(cfg?)` — boundary, handlers, intercepts, flush
    - `AppErrorBoundary` (superset de `components/ErrorBoundary.tsx`) que chama `captureError({ errorType: 'react_render' })` em `componentDidCatch`.
    - `window` handlers: `error` → `window_error`; `unhandledrejection` → `unhandled_rejection`.
    - Intercept de `console.error` (chama original + enfileira `console_error`, com guard anti-recursão).
    - Wrapper de `window.fetch`/Supabase: `!response.ok`/rejeição → `request_failure`, **excluindo** o endpoint da `Error_Ingest_RPC`.
    - `flush()` agrupa até `maxBatchSize` e chama `ingestErrorLogs(batch)` no máximo a cada `flushIntervalMs` (throttle por timer); todo o caminho em `try/catch` mudo. Retorna função de teardown.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8_

  - [x] 2.3 Bootstrap da captura em `main.tsx`/`App.tsx`
    - Chamar `installGlobalErrorCapture()` uma única vez no bootstrap e envolver a árvore do `App` com `AppErrorBoundary`.
    - _Requirements: 3.1, 3.2_

  - [x] 2.4 Property test CP-3 (forma/domínio do Error_Log)
    - `src/__tests__/admin/assistant/cp3ErrorDraft.property.test.ts`. Tag `// Feature: admin-assistant, Property 3`.
    - **Property 3:** `buildErrorDraft` sempre produz `occurredAt` ISO, `errorType` no domínio fechado, `route`, `affectedUserId` (string|null sem falhar sem sessão) e `stack` (string|null). `errorTypeGen = fc.constantFrom(...)`; `numRuns: 100`.
    - **Validates: Requirements 3.5, 3.6**

  - [x] 2.5 Property test CP-4 (batching/throttling respeitam limites)
    - `src/__tests__/admin/assistant/cp4Batching.property.test.ts` com `vi.useFakeTimers()`. Tag `// Feature: admin-assistant, Property 4`.
    - **Property 4:** para qualquer sequência de capturas e config válida, nenhum lote excede `maxBatchSize`, a fila nunca retém mais que `maxQueue` (excedentes descartados), total enviado ≤ total enfileirado. `numRuns: 100`.
    - **Validates: Requirements 3.7**

  - [x] 2.6 Property test CP-5 (captura silenciosa, sem throw, sem reentrância)
    - `src/__tests__/admin/assistant/cp5SilentCapture.property.test.ts`. Tag `// Feature: admin-assistant, Property 5`.
    - **Property 5:** para qualquer entrada e sink que lança, `captureError`/`flush` nunca propagam exceção e nunca reentram (guard impede laço). Sink que lança exposto via `(globalThis as Record<string, unknown>).__ingestSpy`. `numRuns: 100`.
    - **Validates: Requirements 3.8**

  - [ ]* 2.7 Testes de exemplo da captura (boundary/window/console/fetch)
    - Vitest + Testing Library: cada mecanismo enfileira um draft do tipo correto; endpoint de ingestão excluído do wrapper.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Assistant_Service — tipos e helpers puros (`src/services/admin/assistant.ts`)
  - [x] 3.1 Tipos e domínios fechados
    - `AiProvider`, `ChatRole`, `CriticalEventType`, `Severity`, reuso de `ErrorType`; interfaces `AssistantConfigView`, `ConfigPatch`, `ConfigResult`, `AssistantStatus`, `ConversationSummary`, `ChatMessage`, `Highlight`, `CriticalEvent`, `SendResult`, `DetectedEvent`.
    - _Requirements: 5.5, 7.1, 9.2_

  - [x] 3.2 Validadores de domínio fechado
    - `isValidChatRole`, `assertChatRole` (lança fora do domínio), `isValidProvider`, `isValidErrorType`, `isValidThreshold` (inteiro ≥ 1), `isValidCronInterval` (inteiro 1..5).
    - _Requirements: 5.5, 7.1, 10.5, 10.6_

  - [x] 3.3 Helpers de segredo/config
    - `maskApiKey(raw)` (nunca retorna o bruto nem o contém como substring para tamanhos relevantes); `getConfigView(...)` (apenas `is_set` + máscara); `buildConfigAudit(patch)` (omite valores brutos de segredo); `computeActive(config)` (verdadeiro sse `is_set` do `active_provider`).
    - _Requirements: 7.4, 7.5, 7.7, 14.5_

  - [x] 3.4 Helpers de highlight/histórico/ingestão
    - `summarizeHighlight(ev)` (categoria/resumo/severidade/timestamp não vazios; sem link quando conversa ausente; não lança); `sortHighlights(list)` (DESC por timestamp); `normalizeHistory(msgs)` (ASC por `created_at`); `partitionErrorBatch(items)` (`inserted + rejected === total`, rejeita tipos fora do domínio).
    - _Requirements: 3.9, 3.10, 4.1, 4.4, 5.7, 6.5_

  - [x] 3.5 Helpers de evento crítico
    - `buildCriticalMessage(event)` (texto com o quê/onde(`scope`)/sugestão; puro, sem remediação); `dedupNewEvents(already, batch)` (nunca retorna `dedup_key` já em `already`; idempotente); `whatsappDispatch(event, { whatsappToggle })` (`{ sent: false }` no-op quando toggle off).
    - _Requirements: 12.4, 12.7, 13.3, 13.4_

  - [x] 3.6 Property test CP-9 (domínio fechado do papel)
    - `src/__tests__/admin/assistant/cp9ChatRole.property.test.ts`. Tag `// Feature: admin-assistant, Property 9`.
    - **Property 9:** `isValidChatRole(s)` verdadeiro sse `s ∈ {user,assistant,system}`; `assertChatRole` retorna o papel no domínio e lança fora dele. `roleMsgGen = fc.constantFrom(...)`; `numRuns: 100`.
    - **Validates: Requirements 5.5**

  - [x] 3.7 Property test CP-13 (domínio fechado de AI_Provider)
    - `src/__tests__/admin/assistant/cp13Provider.property.test.ts`. Tag `// Feature: admin-assistant, Property 13`.
    - **Property 13:** `isValidProvider(s)` verdadeiro sse `s ∈ {claude,gemini,grok,llama}`. `numRuns: 100`.
    - **Validates: Requirements 7.1**

  - [x] 3.8 Property test CP-21 (validação de threshold inteiro ≥ 1)
    - `src/__tests__/admin/assistant/cp21ThresholdValidation.property.test.ts`. Tag `// Feature: admin-assistant, Property 21`.
    - **Property 21:** `isValidThreshold(n)` verdadeiro sse `n` é inteiro ≥ 1; `updateConfig` rejeita fora do intervalo antes de persistir. `numRuns: 100`.
    - **Validates: Requirements 10.5**

  - [x] 3.9 Property test CP-22 (validação do intervalo do cron 1..5)
    - `src/__tests__/admin/assistant/cp22CronValidation.property.test.ts`. Tag `// Feature: admin-assistant, Property 22`.
    - **Property 22:** `isValidCronInterval(n)` verdadeiro sse `n` é inteiro em `[1,5]`. `numRuns: 100`.
    - **Validates: Requirements 10.6**

  - [x] 3.10 Property test CP-11 (não-vazamento de segredo)
    - `src/__tests__/admin/assistant/cp11SecretLeak.property.test.ts`. Tag `// Feature: admin-assistant, Property 11`.
    - **Property 11:** para chave bruta não vazia e qualquer `ConfigPatch`, `getConfigView` retorna só `is_set`+máscara e `buildConfigAudit` não inclui o bruto; `maskApiKey(raw) !== raw` e não contém o bruto como substring (tamanhos relevantes). `numRuns: 100`.
    - **Validates: Requirements 7.4, 7.5, 14.5**

  - [x] 3.11 Property test CP-12 (atividade depende da chave)
    - `src/__tests__/admin/assistant/cp12Active.property.test.ts`. Tag `// Feature: admin-assistant, Property 12`.
    - **Property 12:** `computeActive(config)` verdadeiro sse `is_set` do `active_provider`. `providerGen = fc.constantFrom(...)`; `numRuns: 100`.
    - **Validates: Requirements 7.7**

  - [x] 3.12 Property test CP-6 (ingestão particiona pelo domínio fechado)
    - `src/__tests__/admin/assistant/cp6IngestDomain.property.test.ts`. Tag `// Feature: admin-assistant, Property 6`.
    - **Property 6:** `partitionErrorBatch` aceita exatamente itens com `error_type` no domínio e rejeita os demais; `inserted + rejected === total`; nenhum tipo inválido aceito. `numRuns: 100`.
    - **Validates: Requirements 3.9, 3.10**

  - [x] 3.13 Property test CP-7 (highlights ordenados DESC)
    - `src/__tests__/admin/assistant/cp7HighlightsOrder.property.test.ts`. Tag `// Feature: admin-assistant, Property 7`.
    - **Property 7:** `sortHighlights` produz permutação não-crescente por timestamp. `numRuns: 100`.
    - **Validates: Requirements 4.1**

  - [x] 3.14 Property test CP-8 (derivação de Highlight a partir de Critical_Event)
    - `src/__tests__/admin/assistant/cp8HighlightDerive.property.test.ts`. Tag `// Feature: admin-assistant, Property 8`.
    - **Property 8:** `summarizeHighlight(ev)` retorna categoria/resumo/severidade/timestamp não vazios; conversa ausente ⇒ view sem link, sem lançar. `numRuns: 100`.
    - **Validates: Requirements 4.4, 6.5**

  - [x] 3.15 Property test CP-10 (histórico ordenado ASC)
    - `src/__tests__/admin/assistant/cp10HistoryOrder.property.test.ts`. Tag `// Feature: admin-assistant, Property 10`.
    - **Property 10:** `normalizeHistory` ordena mensagens de forma não-decrescente por `created_at`. `numRuns: 100`.
    - **Validates: Requirements 5.7**

  - [ ] 3.16 Property test CP-23 (mensagem automática descreve o quê/onde/sugestão)
    - `src/__tests__/admin/assistant/cp23CriticalMessage.property.test.ts`. Tag `// Feature: admin-assistant, Property 23`.
    - **Property 23:** `buildCriticalMessage(event)` inclui o que aconteceu, `scope` e sugestão; pura, sem remediação. `numRuns: 100`.
    - **Validates: Requirements 12.4**

  - [ ] 3.17 Property test CP-24 (deduplicação idempotente)
    - `src/__tests__/admin/assistant/cp24Dedup.property.test.ts`. Tag `// Feature: admin-assistant, Property 24`.
    - **Property 24:** `dedupNewEvents(already, batch)` nunca retorna `dedup_key` já em `already`; `dedup(dedup(x)) === dedup(x)`. `numRuns: 100`.
    - **Validates: Requirements 12.7**

  - [ ] 3.18 Property test CP-25 (WhatsApp_Dispatcher no-op com toggle off)
    - `src/__tests__/admin/assistant/cp25WhatsappNoop.property.test.ts`. Tag `// Feature: admin-assistant, Property 25`.
    - **Property 25:** `whatsappDispatch(event, { whatsappToggle: false })` retorna `{ sent: false }` sem realizar envio. `numRuns: 100`.
    - **Validates: Requirements 13.3, 13.4**

- [x] 4. Event_Classifier (módulo puro compartilhado)
  - [x] 4.1 Criar `src/services/admin/assistantClassifier.ts` — `classifyEvents`
    - Interfaces `ThresholdConfig`, `ClassifierSignals`, `DetectedEvent`; `classifyEvents(signals, thresholds)` pura/determinística.
    - Regras: só tipos de `Critical_Event_Type`; `newSignups`/`postedFretes` nunca disparam; thresholds bicondicional (`count >= threshold`); `failed_login_burst` avaliado por IP (`scope = ip:<addr>`, sem somar IPs); `unauthorized_access_attempt`/`payment_failure` disparam em `> 0`; `dbPerformanceDrop` dispara em `true`; cada evento com `type`/`severity`/`summary`.
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 4.2 Property test CP-15 (determinismo)
    - `src/__tests__/admin/assistant/cp15Determinism.property.test.ts`. Tag `// Feature: admin-assistant, Property 15`.
    - **Property 15:** duas invocações consecutivas com mesma entrada produzem resultados iguais. `numRuns: 100`.
    - **Validates: Requirements 9.1**

  - [x] 4.3 Property test CP-16 (saída tipada e completa)
    - `src/__tests__/admin/assistant/cp16ClassifierShape.property.test.ts`. Tag `// Feature: admin-assistant, Property 16`.
    - **Property 16:** todo `DetectedEvent` tem `type` no domínio e `type`/`severity`/`summary` não vazios. `numRuns: 100`.
    - **Validates: Requirements 9.2, 9.6**

  - [x] 4.4 Property test CP-17 (eventos comuns nunca disparam)
    - `src/__tests__/admin/assistant/cp17CommonNeverCritical.property.test.ts`. Tag `// Feature: admin-assistant, Property 17`.
    - **Property 17:** com sinais críticos ausentes, qualquer `newSignups`/`postedFretes` ⇒ lista vazia. `numRuns: 100`.
    - **Validates: Requirements 9.3**

  - [x] 4.5 Property test CP-18 (bicondicional por threshold)
    - `src/__tests__/admin/assistant/cp18Threshold.property.test.ts`. Tag `// Feature: admin-assistant, Property 18`.
    - **Property 18:** para `page_error_rate`/`request_failure_rate`, evento incluído sse `count >= threshold`. `thresholdGen = fc.integer({ min: 1, max: 1000 })`; `numRuns: 100`.
    - **Validates: Requirements 10.2, 10.3**

  - [x] 4.6 Property test CP-19 (agregação por IP independente)
    - `src/__tests__/admin/assistant/cp19PerIpAggregation.property.test.ts`. Tag `// Feature: admin-assistant, Property 19`.
    - **Property 19:** gera `failed_login_burst` (`scope` do IP) exatamente para IPs com contagem ≥ threshold; soma entre IPs nunca dispara. `ipGen`/`failedLoginsByIpGen` via `fc.constantFrom`/`fc.dictionary`; `numRuns: 100`.
    - **Validates: Requirements 11.2, 11.3, 11.4**

  - [x] 4.7 Property test CP-20 (sinais diretos disparam o tipo correspondente)
    - `src/__tests__/admin/assistant/cp20DirectSignals.property.test.ts`. Tag `// Feature: admin-assistant, Property 20`.
    - **Property 20:** `unauthorizedAccessCount > 0` ⇒ `unauthorized_access_attempt`; `paymentFailureCount > 0` ⇒ `payment_failure`; `dbPerformanceDrop` ⇒ `db_performance_drop`. `numRuns: 100`.
    - **Validates: Requirements 11.1, 11.5, 11.6**

- [x] 5. Provider_Abstraction (módulo compartilhado)
  - [x] 5.1 Criar `src/services/admin/assistantProvider.ts`
    - Interface `AiProviderClient` (`invoke(input, apiKey)`); `AiInvokeInput`/`AiInvokeResult` tipados; `ClaudeClient` (chama Anthropic via `fetch`, lê `model` da config, `{ ok: true, content, model }`; falha ⇒ `{ ok: false, error: 'provider_call_failed' }` sem fallback); stubs `gemini`/`grok`/`llama` ⇒ `{ ok: false, error: 'provider_not_implemented', provider }` sem tocar segredos; `selectProviderClient(provider)` retorna o cliente cujo id é o provider.
    - Módulo canônico reusado/espelhado pela Edge `assistant-ai`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 5.2 Property test CP-14 (seleção e resultado tipado)
    - `src/__tests__/admin/assistant/cp14ProviderSelect.property.test.ts` com `fetch` simulado via `(globalThis as Record<string, unknown>).__fetchSpy`. Tag `// Feature: admin-assistant, Property 14`.
    - **Property 14:** `selectProviderClient(provider)` retorna cliente cujo id é `provider`; `claude` ⇒ `{ ok: true }` (fetch simulado); `gemini`/`grok`/`llama` ⇒ `{ ok: false, error: 'provider_not_implemented' }` sem referenciar segredo. `numRuns: 100`.
    - **Validates: Requirements 8.2, 8.4, 8.5**

- [x] 6. Checkpoint — lógica pura e property tests verdes
  - Rodar `npx tsc --noEmit` (zero erros) e `npx vitest --run` (CP-1..CP-25 verdes).
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Service — wrappers RPC/Edge (`src/services/admin/assistant.ts`)
  - [x] 7.1 Wrappers de config/segredo/status
    - `getConfig()`, `updateConfig(patch, expectedUpdatedAt)` (via `executeAdminMutation`, `action` `ASSISTANT_CONFIG_UPDATED`/`ASSISTANT_WHATSAPP_TOGGLED` conforme patch; pré-valida thresholds/cron; trata `STALE_VERSION`), `setProviderKey(provider, rawKey)` (`ASSISTANT_PROVIDER_KEY_UPDATED`), `clearProviderKey(provider)` (`ASSISTANT_PROVIDER_KEY_CLEARED`), `getStatus()`.
    - `before`/`after` do audit omitem valores brutos de segredo.
    - _Requirements: 7.2, 7.3, 7.6, 10.4, 13.5, 14.5, 14.6_

  - [x] 7.2 Wrappers de chat/mural
    - `listConversations()`, `loadConversation(id)` (ASC via `normalizeHistory`), `sendMessage(conversationId, text)` (persiste `user` via RPC; loga `ASSISTANT_MESSAGE_SENT` sem PII bruta; invoca `assistant-ai`; persiste resposta `assistant` best-effort sem retry; preserva conversa em falha), `listHighlights()` (DESC via `sortHighlights`).
    - _Requirements: 4.1, 5.1, 5.3, 5.4, 5.6, 5.8, 6.4_

  - [ ]* 7.3 Testes de exemplo dos wrappers
    - Verificam que `updateConfig`/toggle/segredo disparam `executeAdminMutation` com a `action` correta e que `sendMessage` preserva a mensagem do usuário em erro do provedor.
    - _Requirements: 5.3, 5.4, 5.6, 7.2, 10.4, 13.5_

- [x] 8. Edge Functions
  - [x] 8.1 `supabase/functions/assistant-ai` — Provider_Abstraction + leitura do Vault
    - Interface comum espelhando `assistantProvider.ts`; `ClaudeClient` via `fetch`; `gemini`/`grok`/`llama` ⇒ `provider_not_implemented`; lê a chave do `Active_Provider` exclusivamente do Vault (`vault.decrypted_secrets`, nome `assistant_provider_key_<provider>`); ausente ⇒ `missing_api_key`; falha do Claude ⇒ `provider_call_failed` sem fallback. Nenhum erro expõe segredo.
    - _Requirements: 8.2, 8.3, 8.5, 8.7, 14.2_

  - [x] 8.2 `assistant-ai` — Context_Builder `buildContext`
    - Via service-role, consulta dados reais (contagens/amostras de `users`/`motoristas`/`embarcadores`, `fretes` ativos/sem aceite, `payments`, `error_logs`, `assistant_critical_events`) e monta bloco textual de contexto (sem máscara, decisão do dono) antes da chamada ao provedor.
    - _Requirements: 5.1, 5.2_

  - [x] 8.3 `supabase/functions/assistant-monitor` — coleta, classifica, persiste, publica
    - Invocada pelo `pg_cron` (Bearer service-role); coleta sinais recentes na janela; monta `ClassifierSignals`; roda `classifyEvents`; para cada Critical_Event não notificado (dedup por `dedup_key`): persiste via `rpc_assistant_persist_critical_event` (`ON CONFLICT DO NOTHING`), publica `Chat_Message` `assistant` (via `buildCriticalMessage`) + Highlight, loga `ASSISTANT_CRITICAL_EVENT_DETECTED`; Common_Event ⇒ não persiste/não publica/não chama IA; `WhatsApp_Dispatcher.dispatch` no-op com toggle off; `try/catch` por evento para nunca quebrar execuções futuras.
    - _Requirements: 9.4, 9.5, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 13.3, 13.4, 13.6_

  - [ ]* 8.4 Testes de integração das Edge Functions
    - Mocks/banco efêmero: Edge lê a chave só do Vault e é a única a usá-la (8.7/14.2); set/clear secret + audit (7.3/14.6); monitor coleta→classifica→persiste→publica/dedup/log (9.4/9.5/12.2/12.3/12.5/12.6/12.8); Context_Builder consulta as fontes (5.1/5.2).
    - _Requirements: 5.1, 5.2, 7.3, 8.7, 9.4, 9.5, 12.2, 12.3, 12.5, 12.6, 12.8, 14.2, 14.6_

- [x] 9. Frontend — componentes, página e roteamento
  - [x] 9.1 `src/components/admin/assistant/HighlightsFeed.tsx`
    - Read-only, ordem DESC; item com categoria/resumo/severidade/timestamp; clique navega à conversa referenciada; estado vazio informativo; highlight com conversa ausente sem link; erro isolado com `DashboardBlockError` + Tentar novamente.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.5_

  - [x] 9.2 `src/components/admin/assistant/AssistantChat.tsx`
    - Histórico ASC; input rotulado (`aria-label`); novas mensagens com `role="status"`; mensagem de falha amigável (`role="alert"`) preservando a mensagem do usuário; degradação se persistência da resposta falhar.
    - _Requirements: 5.3, 5.4, 5.6, 5.7, 16.1, 16.3_

  - [x] 9.3 `src/components/admin/assistant/AssistantSettings.tsx`
    - Seletor de `Active_Provider`; campo de chave exibindo só `is_set`+máscara; thresholds; intervalo cron; `WhatsApp_Toggle` (com aviso de inativo); `LGPD_Notice`; modo somente leitura sem `ASSISTANT_EDIT` (oculta Salvar). Controles compactos e rotulados.
    - _Requirements: 7.1, 7.2, 7.3, 7.8, 7.9, 10.4, 13.1, 13.2, 13.5, 16.1, 16.4_

  - [x] 9.4 `src/components/admin/assistant/AssistantStatus.tsx`
    - Ativo/inativo, `active_provider`+`model`, últimos Critical_Event; inativo quando `is_set=false` com orientação para configurar a chave.
    - _Requirements: 7.6, 7.7_

  - [x] 9.5 `src/pages/admin/assistant/AssistantPage.tsx`
    - Orquestra seções na ordem Mural → Chat → Configurações; sem `<h1>` grande; `Promise.allSettled` isolando falha do Mural; responsiva em coluna única `<768px`.
    - _Requirements: 1.7, 1.8, 4.7, 16.2_

  - [x] 9.6 Registro de rota + item da sidebar
    - `src/components/admin/AdminLayoutRoute.tsx`: rota filha `path="assistant"` renderizando `AssistantPage`, gated por `ASSISTANT_VIEW` (sem permissão ⇒ `Stealth_404`). `src/components/admin/AdminSidebar.tsx`: item `Assistente` → `/admin/assistant` com `permission: 'ASSISTANT_VIEW'`.
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [ ]* 9.7 Testes de exemplo/edge de UI
    - Registro de rota (1.1), render gated (1.2/1.6), Stealth404 sem permissão (1.3), ausência de `<h1>` (1.7), ordem das seções (1.8), mural read-only/navegação/vazio (4.2/4.3/4.5), modo leitura sem `ASSISTANT_EDIT` (7.8), LGPD_Notice (7.9), toggle inativo (13.2), acessibilidade (16.1–16.4), erro do provedor preserva mensagem (5.6), falha de persistência da resposta (5.4).
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 4.2, 4.3, 4.5, 5.4, 5.6, 7.8, 7.9, 13.2, 16.1, 16.2, 16.3, 16.4_

- [ ] 10. Integração e smoke (complementares)
  - [ ]* 10.1 Testes de integração server-side
    - `is_admin_with_permission` paridade + anônimo (2.3/2.4); `ASSISTANT_VIEW_DENIED` (5.9/14.4); RLS Owner_Only_Gate (6.6/14.7); `updated_at` touch ao postar mensagem (6.3); idempotência da migration (15.3) e do agendamento cron (15.8).
    - _Requirements: 2.3, 2.4, 5.9, 6.3, 6.6, 14.4, 14.7, 15.3, 15.8_

  - [ ]* 10.2 Smoke tests da migration e infraestrutura
    - Presença/forma da migration 047 (15.1/15.2/15.5/15.6/15.7/15.9/15.10), `DO $check$` (15.4), cron agendado (12.1), schema de thresholds/toggle (10.1/13.1), seam WhatsApp + Vault reservado (13.6/13.7).
    - _Requirements: 10.1, 12.1, 13.1, 13.6, 13.7, 15.1, 15.2, 15.4, 15.5, 15.6, 15.7, 15.9, 15.10_

- [x] 11. Checkpoint final
  - `npx tsc --noEmit` zero erros; `npm run build` limpa; `npx vitest --run` com CP-1..CP-25 verdes (complementares opcionais skipados se não implementados).
  - Aplicar `047_admin_assistant.sql` em ambiente dev e rodar o bloco `-- VERIFY` descomentado pontualmente.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks `1.11`, `1.12`, `2.4`–`2.6`, `3.6`–`3.18`, `4.2`–`4.7` e `5.2` cobrem as 25 propriedades de correção (CP-1..CP-25). São **obrigatórias** e **NÃO** levam asterisco, conforme `project-conventions.md` e a estratégia de testes do `design.md`.
- Sub-tasks marcadas com `*` (exemplo/edge/integração/smoke) são complementares e podem ser puladas para um MVP mais rápido; o agente de implementação não as executa automaticamente.
- Cada property test referencia uma única propriedade do `design.md` (CP-N), é tag-eado `// Feature: admin-assistant, Property N` e roda com `numRuns: 100` (fast-check + Vitest), seguindo o mapa Propriedade→arquivo do design.
- A lógica pura canônica vive em `src/services/admin/{assistant,assistantClassifier,assistantProvider}.ts` (alvo dos PBTs); as Edge Functions (Deno) honram o mesmo contrato determinístico sem nova dependência npm.
- Segredos só no Vault + Edge Function; o frontend nunca vê a chave bruta. Toda mutação passa por `executeAdminMutation`; RPCs gated com path negativo `ASSISTANT_VIEW_DENIED`.
- Migration 047 acompanha o par `047_admin_assistant_rollback.sql` (documentação, não auto-aplicado).
- O workflow de spec encerra após a criação deste `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.3", "1.11", "2.2", "3.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["1.4", "1.12", "2.3", "2.4", "2.5", "2.6", "3.3", "3.6", "3.7", "3.8", "3.9", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "5.2", "8.1"] },
    { "id": 3, "tasks": ["1.5", "2.7", "3.4", "3.10", "3.11", "8.2", "8.3"] },
    { "id": 4, "tasks": ["1.6", "3.5", "3.12", "3.13", "3.14", "3.15", "8.4"] },
    { "id": 5, "tasks": ["1.7", "3.16", "3.17", "3.18", "7.1"] },
    { "id": 6, "tasks": ["1.8", "7.2"] },
    { "id": 7, "tasks": ["1.9", "7.3", "9.1", "9.2", "9.3", "9.4"] },
    { "id": 8, "tasks": ["1.10", "9.5"] },
    { "id": 9, "tasks": ["9.6", "9.7"] },
    { "id": 10, "tasks": ["10.1", "10.2"] }
  ]
}
```

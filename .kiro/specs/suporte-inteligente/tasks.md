# Implementation Plan: Central de Suporte Inteligente (`suporte-inteligente`)

## Overview

Plano incremental e orientado a teste que constrói o `Support_Console` em `/admin/suporte`
**por cima** das tabelas de `notifications-hub` (041) e **reusando** a `Provider_Abstraction` de
`admin-assistant` (047) e a fundação de `admin-foundation` (030). Cada tarefa constrói sobre as
anteriores e termina com a fiação (wiring) na página e na sidebar — sem código órfão.

Ordem real de construção: **(1)** migration 115 (schema/RBAC/RLS/trigger) + rollback → **(2)** lógica
pura TS + propriedades CP1–CP5 → **(3)** RPCs `SECURITY DEFINER` (migration 115b) + rollback →
**(4)** Edge Function `support-ai-reply` → **(5)** service `suporte.ts` → **(6)** UI/página/sidebar →
**(7)** testes de integração (`tests/`) → **(8)** Regression_Suite + cobertura.

Convenções de marcação (`project-conventions`): **CP1–CP5 são obrigatórias e NÃO levam `*`**; itens
opcionais (CP6\*–CP12\*, smoke de migration, roteiro E2E manual) levam `*`. Idioma: texto pt-BR;
identifiers, action/error codes em inglês (UPPER_SNAKE).

Reuso obrigatório (nunca recriar): `executeAdminMutation` (`services/admin/audit.ts`),
`is_admin_with_permission` (030/047), `AdminGuard`/`Stealth_404`/`useAdminPermission`,
`Provider_Abstraction` (`services/admin/assistantProvider.ts` + chave no Vault),
tabelas/triggers/permissões do notifications-hub, helpers de teste em `src/__tests__/_helpers/`.

## Tasks

- [ ] 1. Migration 115 — amplificação de schema, RBAC, RLS e trigger (+ par rollback)
  - [ ] 1.1 Migration 115 (parte 1 — schema): criar `supabase/migrations/115_suporte_inteligente.sql`
    - `BEGIN; ... COMMIT;` + bloco `DO $check$` validando dependências `is_admin_with_permission` (030), `support_tickets`/`support_ticket_messages` (041) e `assistant_config` (047)
    - `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS` `responder_mode`/`priority_level`/`handoff_at`/`returned_to_ai_at` com defaults compatíveis (sem reescrita das linhas existentes)
    - amplificar o domínio de `status` 3→5 (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT support_tickets_status_check` com `open,in_progress,waiting_customer,resolved,closed`)
    - `author_kind` em `support_ticket_messages` (`'user'|'admin'|'ai'`, default `'user'`) + backfill não destrutivo a partir de `is_admin`
    - `CREATE TABLE IF NOT EXISTS support_kb_entries` e `support_ai_config` (singleton com seed `ON CONFLICT DO NOTHING`), índices `IF NOT EXISTS`, anexar `trg_set_updated_at` às duas
    - _Requirements: 3.1, 3.2, 5.1, 6.8, 13.1, 13.2, 13.3, 13.4_

  - [ ] 1.2 Migration 115 (parte 2 — RBAC + RLS + trigger): apenas append em `115_suporte_inteligente.sql`
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission(text)` **preservando** o corpo de 047 e acrescentando `FAQ_VIEW`/`FAQ_EDIT`/`SUPORTE_AI_CONFIG` (SUPORTE recebe só `FAQ_VIEW`; ADMIN via allow-all sem deny-list; SUPER_ADMIN wildcard); `auth.uid()` nulo ⇒ falso
    - RLS: `ENABLE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS` antes de `CREATE POLICY` em `support_kb_entries` (SELECT `FAQ_VIEW`, ALL `FAQ_EDIT`) e `support_ai_config` (SELECT `SUPORTE_VIEW`, ALL `SUPORTE_AI_CONFIG`); confirmar que as policies de `support_tickets`/`support_ticket_messages` de 041 seguem intactas
    - trigger `AFTER INSERT ON support_ticket_messages` que, quando `NEW.author_kind='user'` e `status ∈ {waiting_customer, resolved}`, transiciona para `in_progress` (não toca `closed`)
    - _Requirements: 3.10, 4.2, 4.3, 4.4, 4.5, 4.6, 11.1, 11.2, 11.3, 11.6_

  - [ ] 1.3 Par rollback `115_suporte_inteligente_rollback.sql` (documentado, não auto-aplicado)
    - reverter colunas/tabelas/policies/trigger e restaurar o `status_check` de 3 estados e o corpo de `is_admin_with_permission` de 047
    - bloco `-- VERIFY` comentado para conferência manual
    - _Requirements: 13.5, 13.6_

- [ ] 2. Núcleo de lógica pura (TS determinístico) e propriedades CP1–CP5
  - [ ] 2.1 `statusMachine.ts` — `Status_Transition` + `Status_Display_Map`
    - `src/services/admin/suporte/statusMachine.ts`: `TicketStatus`, `STATUS_TRANSITIONS`, `isValidTransition(from,to)` (`from===to` ⇒ false; `closed` terminal), `STATUS_DISPLAY_MAP` (rótulos pt-BR + marcadores)
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [ ] 2.2 Teste de propriedade CP2 — transições válidas e `closed` terminal
    - `src/__tests__/admin/suporte/cp2_transicoes_status.property.test.ts`, `numRuns: 100`, tag `// Feature: suporte-inteligente, Property 2`
    - **Property 2 (CP2): `isValidTransition(from,to)` verdadeiro sse `to ∈ STATUS_TRANSITIONS[from]`; `closed` ⇒ sempre falso**
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.6**

  - [ ]* 2.3 Teste de propriedade CP6 — `Status_Display_Map` total (opcional)
    - `cp6_status_display_map.property.test.ts`
    - **Property 6\* (CP6): para todo `TicketStatus`, o render retorna exatamente rótulo+marcador definidos**
    - **Validates: Requirements 2.4, 3.3**

  - [ ] 2.4 `priorityClassifier.ts` — `Priority_Classifier`
    - `src/services/admin/suporte/priorityClassifier.ts`: `classifyPriority(answerableSignal, criticalCategory)` puro e total em `{1,2,3}`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 2.5 Teste de propriedade CP5 — classificação determinística de prioridade
    - `cp5_priority_classifier.property.test.ts`, geradores `fc.boolean()` + `fc.option(fc.constantFrom('financeiro','tecnico','administrativo'), { nil: null })`
    - **Property 5 (CP5): mesmas entradas ⇒ mesmo nível; `Critical_Category` ⇒ 3; senão `true`⇒1, `false`⇒2**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.10**

  - [ ] 2.6 `validation.ts` — validações puras espelhadas no backend
    - `src/services/admin/suporte/validation.ts`: `validateFaqQuestion` (3–300), `validateFaqAnswer` (1–5000), `isValidCategory`, `isValidConfidenceThreshold` ([0,1] finito), `deriveAnswerableSignal(confidence, threshold)` (`>=`)
    - _Requirements: 5.2, 6.4, 6.8, 12.2_

  - [ ]* 2.7 Teste de propriedade CP8 — `Answerable_Signal` por threshold (opcional)
    - `cp8_answerable_signal.property.test.ts`, `confidenceGen = fc.double({ min: 0, max: 1, noNaN: true })`
    - **Property 8\* (CP8): `deriveAnswerableSignal` verdadeiro sse `confidence >= threshold`**
    - **Validates: Requirements 6.4, 6.5**

  - [ ]* 2.8 Teste de propriedade CP10 — validação de FAQ/config IA (opcional)
    - `cp10_validacao_faq.property.test.ts`, `safeText` via `generators.ts` (nunca `fc.stringOf`)
    - **Property 10\* (CP10): aceita sse pergunta∈[3,300], resposta∈[1,5000], categoria no domínio e threshold∈[0,1]**
    - **Validates: Requirements 5.2, 6.8, 12.2**

  - [ ] 2.9 `responderModeReducer.ts` — modelo testável da exclusão mútua IA×humano
    - `src/services/admin/suporte/responderModeReducer.ts`: `TicketModel`, `Op` (`customer_message`/`ai_reply_attempt`/`human_reply`/`handoff`/`return_to_ai`), `applyOp(state, op)` espelhando a semântica das RPCs (`ai_reply_attempt` sob `human` ⇒ `AI_LOCKED` sem persistir; `human_reply` sob `ai` ⇒ flip atômico antes de aceitar)
    - _Requirements: 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2_

  - [ ] 2.10 Teste de propriedade CP1 — exclusão mútua IA×humano
    - `cp1_exclusao_mutua.property.test.ts`, model-based sobre `fc.array(opGen)`, corpo via `safeText`
    - **Property 1 (CP1): nenhuma mensagem `author_kind='ai'` persiste enquanto `responder_mode='human'`; toda resposta humana iniciada em `ai` faz flip atômico antes de aceitar**
    - **Validates: Requirements 7.1, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2**

  - [ ] 2.11 Teste de propriedade CP4 — idempotência de Handoff/Return_To_AI
    - `cp4_idempotencia_handoff.property.test.ts`
    - **Property 4 (CP4): Handoff em `human` (ou Return_To_AI em `ai`) não altera estado além da 1ª aplicação e retorna `_SKIPPED`; `f(f(x))==f(x)`**
    - **Validates: Requirements 7.5, 9.4**

  - [ ] 2.12 Espelho frontend da Permission_Matrix em `permissions.ts`
    - `src/services/admin/permissions.ts`: acrescentar `FAQ_VIEW`/`FAQ_EDIT`/`SUPORTE_AI_CONFIG` a `ADMIN_ACTIONS`; `FAQ_VIEW` a `SUPORTE_PERMS`; **não** incluir as três em `ADMIN_DENY`; manter deny-by-default (`hasPermission` ⇒ false fora do enum)
    - _Requirements: 4.2, 4.3, 4.6_

  - [ ]* 2.13 Teste de propriedade CP11 — RBAC determinístico e deny-by-default (opcional)
    - `cp11_rbac_matrix.property.test.ts`
    - **Property 11\* (CP11): `hasPermission` corresponde à matriz (FAQ_VIEW: SUPORTE/ADMIN/SUPER_ADMIN; FAQ_EDIT/SUPORTE_AI_CONFIG: só ADMIN/SUPER_ADMIN) e nega qualquer ação fora do domínio**
    - **Validates: Requirements 4.3, 4.6**

  - [ ] 2.14 Testes unitários (exemplo/edge) das funções puras
    - cobrir `statusMachine` (transições e display map), `priorityClassifier`, `validation`; incluir caso negativo de transição inválida (base de `INVALID_STATUS_TRANSITION`) e rejeições de validação com mensagem pt-BR
    - _Requirements: 3.3, 3.6, 5.2, 5.3, 6.8_

- [ ] 3. Checkpoint — lógica pura verde
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Garantir que CP1–CP5 (e opcionais habilitadas) passam. Ensure all tests pass, ask the user if questions arise.

- [ ] 4. RPCs `SECURITY DEFINER` (migration 115b) + par rollback
  - [ ] 4.1 RPCs de status e prioridade — criar `supabase/migrations/115b_suporte_inteligente_rpcs.sql`
    - `support_change_status(p_ticket_id, p_target_status, p_expected_updated_at)` e `support_set_priority(p_ticket_id, p_level, p_expected_updated_at)` com máquina de estados em PL/pgSQL espelhando `statusMachine`; `FOR UPDATE`; mesmo estado ⇒ `_SKIPPED ALREADY_<STATUS>`/`ALREADY_LEVEL_<n>`; transição fora do conjunto ⇒ `INVALID_STATUS_TRANSITION`; `closed` terminal; `expected_updated_at` divergente ⇒ `STALE_VERSION`
    - postura padrão: `SET search_path=public`, `auth.uid()` nulo ⇒ `permission_denied`, gating `SUPORTE_REPLY` com log negativo `SUPORTE_VIEW_DENIED`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`
    - _Requirements: 3.6, 3.7, 3.8, 3.9, 10.9, 11.6, 11.7_

  - [ ] 4.2 RPCs de exclusão mútua e fluxo IA↔humano — append em `115b_suporte_inteligente_rpcs.sql`
    - `support_handoff_to_human` (set `responder_mode=human`, `handoff_at=NOW()`, mensagem de aviso pt-BR **best-effort** que não bloqueia o handoff, transição p/ `in_progress` salvo `closed`; idempotente `ALREADY_HUMAN`)
    - `support_return_to_ai` (set `responder_mode=ai`, `returned_to_ai_at=NOW()`, preserva mensagens; idempotente `ALREADY_AI`)
    - `support_insert_human_reply` (se `mode=ai`, Handoff atômico antes de inserir; `author_kind='admin'`)
    - `support_claim_ai_reply` (service-role; `mode=human`/IA off ⇒ `BLOCKED`; claim idempotente por `idempotency_key`) e `support_insert_ai_reply` (service-role; reconfere `mode=ai` sob lock ⇒ senão `AI_LOCKED`; `author_kind='ai'`, `is_admin=true`, `author_id=NULL`; `status→resolved`, `priority=1`)
    - todas com `FOR UPDATE`; grants `service_role` nas RPCs do Edge; audit `SUPORTE_HANDOFF`/`SUPORTE_RETURN_TO_AI`/`SUPORTE_AI_REPLY` sem segredos
    - _Requirements: 6.1, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.2, 8.3, 8.4, 8.5, 9.2, 9.3, 9.4, 9.5_

  - [ ] 4.3 RPCs de CRUD da FAQ, config da IA e leituras gated — append em `115b_suporte_inteligente_rpcs.sql`
    - `support_create_faq`/`support_update_faq`/`support_delete_faq` (gating `FAQ_EDIT`; validação ranges/domínio; `STALE_VERSION`; `_SKIPPED ALREADY_REMOVED`; mensagem **canônica anti-enumeração** em duplicidade)
    - `support_update_ai_config` (gating `SUPORTE_AI_CONFIG`; valida `confidence_threshold ∈ [0,1]`; `STALE_VERSION`)
    - `support_admin_list_tickets` (gating `SUPORTE_VIEW`) e `support_list_faq` (gating `FAQ_VIEW`) com filtros/paginação server-side, ordenação `created_at DESC`, log negativo `SUPORTE_VIEW_DENIED`/`FAQ_VIEW_DENIED` antes de abortar (precedência sobre validação) e backstop por RLS
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 4.7, 4.8, 5.2, 5.3, 5.4, 5.5, 6.8, 11.7, 12.5_

  - [ ] 4.4 Par rollback `115b_suporte_inteligente_rpcs_rollback.sql` (documentado, não auto-aplicado)
    - `DROP FUNCTION IF EXISTS` de todas as RPCs desta entrega
    - _Requirements: 13.5, 13.7_

- [ ] 5. Edge Function `support-ai-reply` (reuso da `Provider_Abstraction`)
  - [ ] 5.1 Seletor puro de FAQ publicada + Context_Builder (módulo testável)
    - `src/services/admin/suporte/knowledgeBase.ts`: `selectPublishedFaq(entries)` (inclui sse `publication_state='publicada'`) e montagem do contexto (FAQ publicada + histórico do Atendimento) como funções puras importáveis pelo Vitest e reusadas pela Edge
    - _Requirements: 5.7, 6.2_

  - [ ]* 5.2 Teste de propriedade CP9 — exposição da KB à IA (opcional)
    - `cp9_kb_exposicao.property.test.ts`
    - **Property 9\* (CP9): o contexto inclui uma `FAQ_Entry` sse `publication_state='publicada'`**
    - **Validates: Requirements 5.7, 6.2**

  - [ ] 5.3 Orquestração da Edge `support-ai-reply`
    - `supabase/functions/support-ai-reply/index.ts`: recebe `{ ticketId, idempotencyKey }`; `support_claim_ai_reply` sob lock (`BLOCKED`⇒`support_handoff_to_human` e encerra; `DUPLICATE`⇒no-op; `ALLOW`⇒segue); Context_Builder (5.1); lê `Active_Provider` de `assistant_config` + `confidence_threshold`/`support_model` de `support_ai_config`; lê a chave no **Vault** (`assistant_provider_key_<provider>`) via service-role; invoca `selectProviderClient(provider)` da `Provider_Abstraction` (sem nova abstração)
    - `Answerable_Signal = confidence >= threshold && grounded`: verdadeiro ⇒ `support_insert_ai_reply`; falso/`provider_not_implemented`/`provider_call_failed`/`missing_api_key`/parsing inválido ⇒ `support_handoff_to_human` + log estruturado **sem segredos** (degradação controlada), preservando Atendimento e mensagens
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.7, 6.9, 12.4_

- [ ] 6. Service layer `src/services/admin/suporte.ts`
  - [ ] 6.1 Tipos, mapeamento de erros e leituras
    - `src/services/admin/suporte.ts`: tipos (`MutationResult`, linhas DB→tipos), `SuporteError`/`mapPostgresError` reusando o padrão de `tickets.ts` (`42501`→`PERMISSION_DENIED`, `STALE_VERSION`, `INVALID_STATUS_TRANSITION`, `AI_LOCKED`, `INVALID_INPUT`) com mensagens pt-BR; leituras (`list_tickets`/`list_faq`/`ai_config`) com derivação de nome/e-mail/WhatsApp/plano (guest ⇒ `Sem plano`) e **degradação parcial** via `Promise.allSettled`; negar leitura quando `auth.uid()` nulo
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.9, 12.1_

  - [ ] 6.2 Wrappers de mutação via `executeAdminMutation`
    - append em `suporte.ts`: `changeStatus`/`setPriority`/`handoff`/`returnToAi`/`insertHumanReply`/`createFaq`/`updateFaq`/`deleteFaq`/`updateAiConfig`, cada um envolvendo a RPC em `executeAdminMutation` (audit-by-construction, action codes UPPER_SNAKE, `before`/`after`); propagar `expected_updated_at`; `_SKIPPED` tratado como toast neutro (não erro)
    - _Requirements: 3.8, 5.2, 5.4, 5.5, 6.8, 7.4, 9.3, 10.9, 11.7_

  - [ ] 6.3 Função pura de filtro/ordenação/paginação
    - `src/services/admin/suporte/listFilter.ts`: aplica `Support_Filter` (status, prioridade, `responder_mode`, intervalo de datas, busca), ordena por `created_at DESC` e pagina em `{10,50,100}` — reusada pela UI e por CP7
    - _Requirements: 2.5, 2.6, 2.7, 2.10_

  - [ ] 6.4 Teste de propriedade CP3 — precedência de `permission_denied`
    - `cp3_permission_denied.property.test.ts` com `authAssertions.expectRejectsPermissionDenied`; mock da RPC lançando `permission_denied` mesmo com input inválido e papel sem permissão (incl. `ADMIN`)
    - **Property 3 (CP3): ação protegida sem permissão ⇒ `permission_denied`, com precedência sobre erros de validação simultâneos, independente do papel**
    - **Validates: Requirements 4.8, 9.6, 11.3**

  - [ ]* 6.5 Teste de propriedade CP7 — filtro/ordenação/paginação (opcional)
    - `cp7_filtro_listagem.property.test.ts`
    - **Property 7\* (CP7): todo item retornado satisfaz todos os critérios ativos; página ≤ `pageSize`; ordenação inicial não-crescente por `created_at`**
    - **Validates: Requirements 2.5, 2.6, 2.7**

  - [ ]* 6.6 Teste de propriedade CP12 — não-vazamento de chave/PII (opcional)
    - `cp12_nao_vazamento.property.test.ts` com `logAssertions.expectNoSecrets`/`expectStructuredLog`
    - **Property 12\* (CP12): saídas para logs e `admin_audit_logs` não contêm a chave do provedor nem PII bruta**
    - **Validates: Requirements 6.6, 11.9**

  - [ ] 6.7 Testes de cenários de falha do service (caminhos negativos)
    - `STALE_VERSION` → refetch; `INVALID_STATUS_TRANSITION` mantém status; `AI_LOCKED`; `_SKIPPED` (status/handoff/return/FAQ delete); anti-enumeração em duplicidade (`antiEnumeration.CANONICAL_MESSAGES`); degradação parcial de bloco agregado
    - _Requirements: 3.6, 3.9, 5.5, 7.5, 8.3, 9.4, 12.1, 12.5_

- [ ] 7. Checkpoint — backend + service verdes
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Confirmar CP1–CP5 + CP3 e cenários de falha do service. Ensure all tests pass, ask the user if questions arise.

- [ ] 8. UI — componentes, página `/admin/suporte` e sidebar (padrão compacto)
  - [ ] 8.1 Badges e lista compacta
    - `src/components/admin/suporte/`: `SuporteStatusBadge` (usa `STATUS_DISPLAY_MAP`), `SuportePriorityBadge` (marcador de alta prioridade no Nível 3), `SuporteTicketTable` (desktop) e `SuporteTicketCard` (mobile single-column) exibindo data, hora, nome, e-mail, WhatsApp, plano (guest ⇒ `Sem plano`), prioridade e status
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 10.8_

  - [ ] 8.2 Filtros em popover + paginação
    - `SuporteFiltersPopover` acionado por botão com ícone `SlidersHorizontal`; **dispara busca só no botão "Aplicar"** (alterar valores sem aplicar mantém a última busca); paginação `10/50/100` (default `10`), reusando `listFilter`
    - _Requirements: 1.7, 1.8, 2.5, 2.7, 2.10_

  - [ ] 8.3 Detalhe do atendimento e fluxo humano
    - `SuporteTicketDetail`: thread, seletor de status (transições válidas), resposta humana e botão **"Retornar para IA"** gated por `SUPORTE_REPLY` e visível só quando `responder_mode='human'`; **sem inserção em tempo real** (novo Atendimento só após refresh manual)
    - _Requirements: 2.8, 7.1, 9.1, 9.6_

  - [ ] 8.4 CRUD da Base de Conhecimento (FAQ)
    - `FaqPanel`/`FaqTable`/`FaqEditorModal`: criar/editar/remover gated por `FAQ_EDIT`, somente-leitura para `FAQ_VIEW`; **validação no frontend espelhando o backend** (`validation.ts`), bloqueando o envio e exibindo mensagem pt-BR — única condição de bloqueio; popover + paginação
    - _Requirements: 5.6, 5.8, 12.2, 12.3, 12.7_

  - [ ] 8.5 Painel de configuração da Support_AI
    - `SupportAiConfigPanel`: habilitar/desabilitar IA, `confidence_threshold` (slider 0–1) e modelo, gated por `SUPORTE_AI_CONFIG`; validação frontend de `confidence_threshold ∈ [0,1]` espelhando o backend
    - _Requirements: 6.8, 12.2, 12.3_

  - [ ] 8.6 Página, rota, AdminGuard/Stealth_404 e sidebar (wiring)
    - `src/pages/admin/suporte/SuporteListPage.tsx` orquestrando lista + filtros + paginação + detalhe + FAQ + config; registrar a rota `/admin/suporte` sob `AdminGuard` (`SUPORTE_VIEW` ⇒ senão `Stealth_404`); item `Suporte` em `AdminSidebar` gated por `SUPORTE_VIEW`; sem `<h1>` grande
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [ ] 8.7 Testes de UI (render gated e comportamento)
    - render gated (`Stealth_404` sem `SUPORTE_VIEW`, sidebar item, ausência de `<h1>`, popover, paginação default 10), guest `Sem plano`, botão "Retornar para IA" oculto sem `SUPORTE_REPLY`, formulário inválido bloqueado + erro pt-BR
    - _Requirements: 1.3, 1.6, 1.8, 2.3, 9.6, 12.3_

- [ ] 9. Testes de integração (`tests/`, branch Supabase efêmero — CI)
  - [ ] 9.1 RLS e isolamento entre usuários
    - `tests/security/`: owner não vê tickets/mensagens de outro; admin só com `SUPORTE_VIEW`; FAQ SELECT só `FAQ_VIEW`, mutação só `FAQ_EDIT`; sem INSERT/UPDATE/DELETE direto fora das RPCs
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [ ] 9.2 Gating de RPCs, log negativo e paridade da matriz
    - `SUPORTE_VIEW_DENIED`/`FAQ_VIEW_DENIED` persistidos em `admin_audit_logs` (`before=NULL`, `after={user_id,reason}`); precedência de `permission_denied`; paridade `is_admin_with_permission` ↔ matriz para as ações novas; caller anônimo ⇒ falso
    - _Requirements: 4.4, 4.5, 4.7, 4.8, 11.6, 11.7_

  - [ ] 9.3 Exclusão mútua e idempotência server-side
    - sequências concorrentes sob `FOR UPDATE`: `AI_LOCKED` (IA sob `human` não persiste), flip atômico `ai→human` no `insert_human_reply`, `_SKIPPED` em Handoff/Return repetidos
    - _Requirements: 7.5, 7.6, 8.2, 8.3, 8.4, 8.5, 9.4_

  - [ ] 9.4 Edge/Vault e degradação para handoff
    - `support-ai-reply` lê a chave no Vault e é a **única** a tocá-la (nunca chega ao frontend); provedor indisponível/não-implementado ⇒ `support_handoff_to_human` sem perda de dados; log sem segredos
    - _Requirements: 6.3, 6.9, 11.9, 12.4_

  - [ ] 9.5 Master imutável e audit persistido
    - mutações com alvo `Nexus_Vortex99` abortam antes do touch; toda mutação admin desta spec persiste audit em `admin_audit_logs`; falha de audit não bloqueia a mutação
    - _Requirements: 11.7, 11.8_

  - [ ] 9.6 Idempotência da migration e compatibilidade de status
    - reaplicar `115`/`115b` não causa erro; bloco `DO $check$` falha sem dependências; linhas legadas em `open`/`in_progress`/`resolved` permanecem válidas após a amplificação 3→5
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 9.7 Smoke da migration (opcional)
    - presença/forma de `115`/`115b` + pares rollback; `DO $check$`; `GRANT`/`REVOKE` sem `anon`; seed de `support_ai_config`; postura de segurança das RPCs
    - _Requirements: 13.1, 13.5, 13.7_

- [ ] 10. Regression_Suite, cobertura e documentação técnica
  - [ ] 10.1 Incorporar à Regression_Suite e manter cobertura
    - registrar os testes unit/property/falha/integração desta spec na suíte; atualizar `tests/coverage.config.ts` (Critical_Modules de `suporte/`: `statusMachine`, `priorityClassifier`, `validation`, `responderModeReducer`, `listFilter`) mantendo o threshold; JSDoc técnico nos módulos puros e nas RPCs
    - _Requirements: 12.6_

  - [ ]* 10.2 Roteiro de verificação E2E manual (opcional)
    - documentar um roteiro manual de verificação (gating/Stealth_404, fluxo IA→handoff→Return_To_AI, FAQ CRUD, config IA) como artefato de QA, sem substituir os testes automatizados
    - _Requirements: 12.6_

- [ ] 11. Checkpoint final — suíte completa verde
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run lint` e a verificação de cobertura. Garantir o checklist de `testing-governance` completo. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são **opcionais** e podem ser puladas para um MVP mais rápido. **CP1–CP5
  não são opcionais** (obrigatórias em spec do painel) e por isso não levam `*`; CP6\*–CP12\*, o smoke
  de migration (9.7) e o roteiro E2E manual (10.2) são os únicos itens `*`.
- Cada tarefa referencia cláusulas granulares de Requirements; tarefas de propriedade citam o número
  da Property/CP e o `Validates: Requirements ...` da propriedade no design.
- Property tests em `src/__tests__/admin/suporte/cp<N>_<nome>.property.test.ts`, `numRuns >= 100`,
  reusando os helpers canônicos de `src/__tests__/_helpers/` (`generators`, `authAssertions`,
  `antiEnumeration`, `logAssertions`); integração e smoke em `tests/`.
- Reuso explícito (não recriar): `executeAdminMutation`, `is_admin_with_permission`,
  `AdminGuard`/`Stealth_404`/`useAdminPermission`, `Provider_Abstraction`
  (`assistantProvider.ts` + Vault) e as tabelas/triggers/permissões do notifications-hub.
- Cobertura do checklist `testing-governance`: **unit** (2.14) + **property CP1–CP5** (2.2, 2.5, 2.10,
  2.11, 6.4); **cenários de falha** `INVALID_STATUS_TRANSITION`/`STALE_VERSION`/`AI_LOCKED`/provedor→
  handoff/`permission_denied` com precedência/anti-enumeração (6.7, 9.2, 9.3, 9.4); **validações
  frontend E backend** (2.6 puro, 4.3 backend, 8.4/8.5 frontend); **Regression_Suite** (10.1);
  **documentação técnica** (10.1).
- Divisão de migrations conforme o design: `115` (schema/RBAC/RLS/trigger) e `115b` (RPCs), cada uma
  com par `_rollback` documentado e não auto-aplicado; `116/117/118` permanecem reservados.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.4", "2.6", "2.9", "2.12", "5.1", "6.3"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.5", "2.7", "2.8", "2.10", "2.11", "2.13", "2.14", "5.2", "6.5"] },
    { "id": 2, "tasks": ["1.3", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.3", "5.3", "9.3"] },
    { "id": 5, "tasks": ["4.4", "6.1", "9.1", "9.2", "9.4", "9.6"] },
    { "id": 6, "tasks": ["6.2", "8.1", "8.2", "9.7"] },
    { "id": 7, "tasks": ["6.4", "6.6", "6.7", "8.3", "8.4", "8.5", "9.5"] },
    { "id": 8, "tasks": ["8.6"] },
    { "id": 9, "tasks": ["8.7"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["10.2"] }
  ]
}
```

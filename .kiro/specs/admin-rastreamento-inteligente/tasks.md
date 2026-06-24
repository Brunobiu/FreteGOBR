# Implementation Plan — Rastreamento Inteligente (PatGo) (`admin-rastreamento-inteligente`)

## Overview

Plano incremental e ordenado por dependências para o `Tracking_Module` (`/admin/rastreamento`).
A abordagem entrega **primeiro o núcleo puro determinístico** (funções totais, sem I/O), já com seus
testes unit + property (fast-check, ≥100 runs; projeto usa 200) na convenção
`cp<N>_<nome>.property.test.ts` em `src/__tests__/admin/rastreamento/`, reusando os helpers canônicos
de `src/__tests__/_helpers/`. Em seguida vêm a **migration 124** (idempotente, defensiva, com par
rollback), a **Edge Function** de ingestão, a **Permission_Matrix**, a **camada de serviço** (wrappers
finos com `executeAdminMutation`, delegação ao `Job_Worker` do whatsapp-automation e personalização via
`AI_Edge_Function` do admin-assistant com fallback de template), a **UI compacta** e os testes de
UI/serviço/integração. Fecha com Critical_Modules, Regression_Suite e documentação.

Decisão de escopo aprovada: **"Módulo focado + reuso"** — não duplicar nem quebrar whatsapp-automation
(092–114), admin-assistant (047), suporte-inteligente (115), admin-cliente-360 (116), central-operacao
(117) e ia-supervisora (118).

Decisão confirmada pelo dono: o sinal de "pico de abandono" (Req 14.1) é publicado em `system_alerts`
por **ampliação ADITIVA e não-destrutiva** do CHECK de `system_alerts.alert_type` (acréscimo de
`ABANDONMENT_SPIKE` à união dos valores atuais), **revertida no rollback** — exatamente como o
`design.md` §Migration 124 (5) especifica. Nenhuma tabela/RPC/política de 092–118 é recriada.

Aderência integral aos steerings `testing-governance`, `project-conventions` e `admin-patterns`.
Regra-mãe: **nenhuma feature conclui sem testes completos** (unit + property + cenários de
falha/negativos + validação no frontend E no backend + Regression_Suite + documentação). As 14
propriedades obrigatórias (CP1–CP12 + privacidade + precedência) **não** são marcadas com `*`.

## Tasks

- [x] 1. Fundação: domínios fechados, permissões e geradores de teste
  - [x] 1.1 Criar `src/services/admin/rastreamento/domain.ts`
    - Domínios fechados como `as const` + tipos derivados: `JOURNEY_EVENT_TYPES`, `JOURNEY_SURFACES`,
      `FUNNEL_ORDER` (ordenado), `ABANDONMENT_CAUSES`, `ABANDONMENT_PRECEDENCE`, `RISK_BANDS`,
      `RISK_CATEGORIES`, `RECOVERY_SCENARIOS`, `SUPPRESSION_REASONS`, `CONTACT_STATUSES`,
      `TIME_WINDOWS`. Fonte única de verdade no front; espelha os CHECK da migration 124.
    - _Requirements: 3.1, 3.5, 5.1, 6.6, 7.1, 8.1, 9.3, 11.1_
  - [x] 1.2 Estender `src/services/admin/permissions.ts` (Permission_Matrix)
    - Acrescentar `RASTREAMENTO_VIEW` e `RASTREAMENTO_MANAGE` ao `ADMIN_ACTIONS`, concedidas apenas a
      `SUPER_ADMIN` (wildcard) e `ADMIN` (allow-all menos deny-list); negadas por construção a
      `SUPORTE`/`FINANCEIRO`/`MODERADOR` (deny-by-default). Sem novo ramo de papel.
    - _Requirements: 2.1, 2.2_
  - [x] 1.3 Escrever `permissions_rastreamento.unit.test.ts`
    - Validar concessão por papel das duas ações novas e deny-by-default (inclui negação a `ADMIN`
      quando a checagem falha) — `src/__tests__/admin/rastreamento/`.
    - _Requirements: 2.1, 2.2, 2.8_
  - [x] 1.4 Criar geradores locais `src/__tests__/admin/rastreamento/_generators.ts`
    - Arbitraries fast-check para `JourneyEvent`, `JourneySummary`, `RiskFactors`, `StageCounts`
      (não-crescentes), `RecoveryTrigger`/`RecoveryHistoryItem`/`AntiSpamConfig`, `AtRiskRow` e
      `TrackingFilterInput`, reusando `validPhone`/`validEmail`/`safeText`/`uuidLike` de
      `_helpers/generators.ts`. Sem `fc.stringOf`; PII só via `fc.constantFrom`.
    - _Requirements: 17.4_

- [x] 2. Núcleo puro: resumo de jornada, causa do abandono e score de risco
  - [x] 2.1 Implementar `journeySummary.ts` (`buildJourneySummary(events, nowMs)`)
    - Derivação determinística (etapa atual, dias desde último acesso, falhas/tentativas frustradas
      recentes, recusas de frete, estado de conversão, último evento relevante). "Agora" injetado, sem
      `Date.now()` interno. Define `JourneyEvent` e `JourneySummary`.
    - _Requirements: 5.1, 6.5_
  - [x] 2.2 Escrever `journeySummary.unit.test.ts`
    - Casos concretos e bordas (sem eventos, falhas múltiplas, conversão parcial) + determinismo de
      reexecução. Reusa `_generators.ts`.
    - _Requirements: 5.1, 6.5_
  - [x] 2.3 Implementar `abandonmentClassifier.ts` (`classifyAbandonmentCause(summary, inactivityDays)`)
    - Função pura, total e determinística; resolve causas concorrentes por `ABANDONMENT_PRECEDENCE`
      (ordem total fixa); retorna `UNKNOWN` quando nada se aplica. Exibe a coluna "CAUSA PROVÁVEL DA
      PERDA".
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
  - [x] 2.4 Property test CP1 — `cp1_abandonment_classifier.property.test.ts`
    - **Property 1 (CP1): Abandonment_Cause_Classifier — totalidade + determinismo + precedência total**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9**
    - Toda saída pertence ao domínio fechado; mesma entrada ⇒ mesma causa; precedência total. Reusa
      `_generators.ts`. Anotar `// Feature: admin-rastreamento-inteligente, Property 1`.
  - [x] 2.5 Implementar `riskScore.ts` (`calculateRiskScore` + `deriveRiskBand` + `RISK_WEIGHTS`)
    - Soma ponderada de `Risk_Factor` com pesos fixos não-negativos, **clampada** a `[0,100]`
      (inteiro). `deriveRiskBand` total: `[0,24]`/`[25,49]`/`[50,74]`/`[75,100]`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 2.6 Property test CP2 — `cp2_risk_score_bounds.property.test.ts`
    - **Property 2 (CP2): Risk_Score — limites + determinismo**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.5**
  - [x] 2.7 Property test CP3 — `cp3_risk_score_monotonic.property.test.ts`
    - **Property 3 (CP3): Risk_Score — monotonicidade não-decrescente**
    - **Validates: Requirements 6.3, 6.5**
  - [x] 2.8 Property test CP4 — `cp4_risk_band_total.property.test.ts`
    - **Property 4 (CP4): Risk_Band — função total + monotonicidade**
    - **Validates: Requirements 6.6, 6.7**

- [x] 3. Núcleo puro: derivação de etapa e métricas do funil
  - [x] 3.1 Implementar `stageDerivation.ts` (`deriveFunnelStage(events)`)
    - Mapeia o conjunto de `Journey_Event` ao `Funnel_Stage` mais avançado alcançado (respeita
      `FUNNEL_ORDER`); invariante à ordem de entrada e idempotente.
    - _Requirements: 8.2, 4.3_
  - [x] 3.2 Property test CP5 — `cp5_stage_derivation.property.test.ts`
    - **Property 5 (CP5): Stage_Derivation — domínio fechado + determinismo**
    - **Validates: Requirements 8.2, 4.3**
  - [x] 3.3 Implementar `funnelMetrics.ts` (`computeFunnelMetrics(counts)`)
    - `Stage_Conversion_Rate(etapa)=cont(seg)/cont(etapa)` (0 se denom 0); `Stage_Abandonment_Rate=
      1-conversion` quando denom>0; `overall/retention/churn/activation` em `[0,1]`. Determinístico.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 3.4 Property test CP6 — `cp6_funnel_monotonic.property.test.ts`
    - **Property 6 (CP6): Conversion_Funnel — monotonicidade do funil**
    - **Validates: Requirements 8.1, 8.3**
  - [x] 3.5 Property test CP7 — `cp7_funnel_metrics_bounds.property.test.ts`
    - **Property 7 (CP7): Funnel_Metrics — limites + complemento + determinismo**
    - **Validates: Requirements 8.4, 8.5, 8.6, 8.7**

- [x] 4. Núcleo puro: motor de regras, lista em risco, recuperação e exportação
  - [x] 4.1 Implementar `recoveryRuleEngine.ts` (`decideRecovery(trigger, history, cfg)` + `Anti_Spam_Guard`)
    - Função pura/determinística que produz `Recovery_Decision` (`DISPATCH` com `Recovery_Scenario`/
      `template_key` ou `SUPPRESS` com `Suppression_Reason`). Anti-spam: `Min_Delay` (~10min p/
      `NEW_SIGNUP_WELCOME`), `Cooldown` 24–72h, `Max_Per_Window`, `Dedup` por `message_hash`,
      `No_Concurrent` (1 ativa por usuário) e **1 mensagem por evento crítico**.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.11_
  - [x] 4.2 Property test CP8 — `cp8_recovery_engine_determinism.property.test.ts`
    - **Property 8 (CP8): Recovery_Rule_Engine — determinismo + domínio fechado**
    - **Validates: Requirements 9.1, 9.2, 9.3**
  - [x] 4.3 Property test CP9 — `cp9_anti_spam_guard.property.test.ts`
    - **Property 9 (CP9): Anti_Spam_Guard — invariantes de supressão + idempotência**
    - **Validates: Requirements 9.4, 9.5, 9.6, 9.7, 9.11**
  - [x] 4.4 Implementar `atRiskList.ts` (`filterAndSortAtRisk(rows, filter)`)
    - Resultado é subconjunto da entrada; toda linha satisfaz todos os filtros ativos; ordenação total
      (`risk_score` DESC, desempate `user_id` ASC); faixa `min>max` ⇒ conjunto vazio sem erro. Define
      `AtRiskRow` e `TrackingFilterInput`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 13.3, 13.9_
  - [x] 4.5 Property test CP10 — `cp10_at_risk_list.property.test.ts`
    - **Property 10 (CP10): At_Risk_List — filtragem (subconjunto) + ordenação total**
    - **Validates: Requirements 7.3, 7.5, 13.3, 13.9**
    - Reusa `validPhone` em `phone_masked` mascarado (sem PII bruta).
  - [x] 4.6 Implementar `recoveryPerformance.ts` (`computeRecoveryRate` + `canTransitionContactStatus`)
    - `Recovery_Rate = CONVERTED/CONTACTED` (0 se `CONTACTED=0`), em `[0,1]`; `Contact_Status` só avança
      `AT_RISK → CONTACTED → REPLIED → CONVERTED`, nunca retrocede.
    - _Requirements: 11.1, 11.2, 11.3, 11.6_
  - [x] 4.7 Property test CP11 — `cp11_recovery_rate.property.test.ts`
    - **Property 11 (CP11): Recovery_Rate — limites + progressão monotônica de Contact_Status**
    - **Validates: Requirements 11.2, 11.3, 11.6**
  - [x] 4.8 Implementar `csvExport.ts`, `messageTemplates.ts` e `trackingFilter.ts`
    - `csvExport.ts`: `buildRastreamentoCsvFilename` (`rastreamento_<YYYYMMDD>_<HHmm>.csv`) e
      `exportAtRiskCsv` reusando `toCsv`/`parseCsv` de `whatsapp/csv` (BOM, `;`, escape RFC 4180,
      `\r\n`, truncamento 10000). `messageTemplates.ts`: `DEFAULT_TEMPLATES` por `Recovery_Scenario`
      (pt-BR, sem PII; fallback de degradação). `trackingFilter.ts`: re-export `escapeIlike`/
      `normalizeQuery` de `cliente360/search` (sanitização de `ILIKE`).
    - _Requirements: 7.11, 10.5, 12.6, 13.5_
  - [x] 4.9 Property test CP12 — `cp12_csv_roundtrip.property.test.ts`
    - **Property 12 (CP12): CSV Export — round-trip**
    - **Validates: Requirements 7.11**
    - `parseCsv(toCsv(rows))` reproduz as linhas lógicas (campos com `;`, `"`, `\n`, `\r`).
  - [x] 4.10 Property test CP13 (privacidade) — `cp13_no_pii_leak.property.test.ts`
    - **Property 13 (transversal — privacidade): nenhuma saída vaza PII bruta ou segredo**
    - **Validates: Requirements 3.6, 3.7, 4.6, 10.4, 12.3, 15.6**
    - Serializa saídas do núcleo (`Journey_Summary`/`Recovery_Decision`/contexto mínimo de IA/linha de
      log) e aplica `expectNoSecrets`/`expectStructuredLog` de `_helpers/logAssertions.ts`.

- [x] 5. Checkpoint — núcleo puro verde
  - Garantir que todos os testes passem (tsc + `vitest --run` dos arquivos de `admin/rastreamento/` +
    lint). Tirar dúvidas com o usuário se surgirem.

- [x] 6. Migration 124 (`124_admin_rastreamento_inteligente.sql`) + par rollback
  - [x] 6.1 Esqueleto, guarda defensiva e RBAC
    - `BEGIN; … COMMIT;`; bloco `DO $check$` que aborta sem `is_admin_with_permission`/`admin_audit_logs`
      (030), `whatsapp_dispatch_jobs`/`whatsapp_dispatch_recipients` (092), `system_alerts` (117),
      extensão `supabase_vault` (042b)/`assistant_config` (047), `admin_global_search` (116).
      `CREATE OR REPLACE FUNCTION is_admin_with_permission(text)` **preservando o corpo vigente** e
      reconhecendo `RASTREAMENTO_VIEW`/`RASTREAMENTO_MANAGE` **por construção**. Função idempotente
      `*_touch_updated_at` para trigger.
    - _Requirements: 2.3, 2.4, 16.1, 16.2, 16.3_
  - [x] 6.2 Tabelas, índices e RLS admin-only
    - `journey_events`, `tracking_visitor_identities`, `recovery_attempts`, `tracking_ai_config` com
      CHECK de domínio fechado, índices (inclui `uq_recovery_active_per_user WHERE active` e
      `uq_recovery_per_critical_event`), trigger `updated_at`. `ENABLE ROW LEVEL SECURITY`;
      `DROP POLICY IF EXISTS` antes de `CREATE POLICY`. `SELECT` somente sob `RASTREAMENTO_VIEW`; DML
      direto sempre negado; `journey_events` **sem** policy de insert (ingestão só por RPC); nenhuma
      leitura a `anon`; nenhum acesso cruzado entre usuários.
    - _Requirements: 3.1, 15.4, 15.5, 16.3_
  - [x] 6.3 RPCs `SECURITY DEFINER`, espelho SQL do motor, composição com `system_alerts`, pg_cron e VERIFY
    - Todas com `SET search_path = public`, `auth.uid() IS NULL ⇒ permission_denied`, gating
      `is_admin_with_permission` com log negativo `RASTREAMENTO_VIEW_DENIED` (`before=NULL`,
      `after={user_id,reason}`), validação de input, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO
      authenticated`. Ingestão write-only (`rpc_tracking_ingest_event`) concedida também a `anon`
      (caso anônimo explícito), valida domínio fechado (item fora ⇒ `INVALID_EVENT_TYPE` sem derrubar
      válidos), rate-limit por `visitor_id`/origem, não retorna jornada (anti-enum).
      `rpc_tracking_correlate_visitor`; leituras gated (`_timeline`, `_at_risk_list` com
      `page_size ∈ {10,50,100}` + ILIKE escapado, `_funnel`, `_recovery_performance`, `_get_config`);
      mutações (`_mark_contacted` idempotente `_SKIPPED ALREADY_CONTACTED`, `_trigger_recovery`,
      `_update_ai_config` com `STALE_VERSION`); `rpc_tracking_scan_recovery` (service_role) e
      `rpc_tracking_publish_alert`. Espelho SQL do `Recovery_Rule_Engine`/`Anti_Spam_Guard` como
      autoridade server-side. **Ampliação ADITIVA e não-destrutiva** de `system_alerts.alert_type`
      (DROP CHECK + ADD com a união dos valores atuais + `ABANDONMENT_SPIKE`), idempotente — confirmada
      pelo dono. Agendamento `pg_cron` defensivo (não falha sem a extensão). Bloco `-- VERIFY`
      comentado ao fim (evento fora do domínio ⇒ `INVALID_EVENT_TYPE`; leitura sem permissão ⇒
      `RASTREAMENTO_VIEW_DENIED`; `mark_contacted` idempotente; `trigger_recovery` em cooldown ⇒
      `SUPPRESS WITHIN_COOLDOWN`).
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 3.8, 3.9, 3.10, 7.4, 7.8, 7.9, 9.8, 9.9, 9.10, 12.4, 12.5, 14.1, 14.5, 15.1, 15.2, 15.3, 16.4, 16.7_
  - [x] 6.4 Par `124_admin_rastreamento_inteligente_rollback.sql` (documentado, não auto-aplicado)
    - `DROP` das RPCs/policies/tabelas novas, `unschedule` do pg_cron, **restauração do CHECK original**
      de `system_alerts.alert_type` e reversão da re-asserção de `is_admin_with_permission` para a
      versão anterior à 124. Não toca objetos de 092–118 além da restauração do CHECK ampliado.
    - _Requirements: 16.5, 16.6, 16.7_

- [x] 7. Edge Function de ingestão
  - [x] 7.1 Implementar `supabase/functions/tracking-ingest/index.ts`
    - Recebe lotes pequenos de eventos, valida forma básica e chama `rpc_tracking_ingest_event`.
      Write-only: resposta sempre `{ ok: true }` ou `{ ok: false, error: 'INVALID_EVENT_TYPE' }`, sem
      dados de jornada/contagem/existência (anti-enumeração). Resolve `user_id` por `auth.uid()`
      quando há sessão; nunca confia em id do cliente; nunca grava PII no `payload`.
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8_

- [x] 8. Camada de serviço (`src/services/admin/rastreamento.ts`)
  - [x] 8.1 Erros, mensagens pt-BR e tipos
    - `RastreamentoError`/`mapRastreamentoError`/mensagens canônicas; tipos snake_case das views
      (`AtRiskPage`, `TimelineBundle`, `FunnelBundle`, `RecoveryBundle`, `TrackingConfigView`) e
      entradas de filtro/mutação.
    - _Requirements: 15.9_
  - [x] 8.2 Wrappers de leitura com Partial_Degradation
    - `listAtRisk`, `getTimeline`, `getFunnel`, `getRecoveryPerformance`, `getTrackingConfig`. Cada
      fetch agregado carrega blocos via `Promise.allSettled`, grava `bundle.errors[bloco]` na falha;
      só o bloco-fonte lança `NOT_FOUND`. Fontes compostas (cliente-360/operacao/ia-supervisora/
      whatsapp) indisponíveis degradam sem derrubar as superfícies próprias.
    - _Requirements: 4.1, 4.4, 7.3, 8.9, 8.10, 11.1, 11.7, 12.6, 14.4, 14.6_
  - [x] 8.3 Wrappers de mutação, delegação ao whatsapp e personalização por IA
    - `markContacted` (`_SKIPPED ALREADY_CONTACTED`), `triggerRecovery` (DISPATCH ⇒ personaliza via
      `AI_Edge_Function` do admin-assistant com **fallback** para `DEFAULT_TEMPLATES` e **delega** o
      envio enfileirando `Dispatch_Job` no `Job_Worker` do whatsapp-automation; SUPPRESS ⇒ `_SKIPPED`
      com `Suppression_Reason`), `updateAiConfig` (`STALE_VERSION`, chave só no Vault). Toda mutação
      via `executeAdminMutation` com os action codes oficiais; `assertNotMasterNorSelf` em **qualquer**
      caminho que referencie `users`. Falha na delegação ⇒ conclui decisão, loga em separado e **não**
      marca `CONTACTED`; cada supressão automática vira log estruturado sem PII.
    - _Requirements: 7.8, 7.9, 9.8, 9.9, 9.10, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 12.4, 12.5, 15.7, 15.8_
  - [x] 8.4 Property test CP14 (precedência) — `cp14_permission_precedence.property.test.ts`
    - **Property 14 (transversal — precedência): permission_denied tem precedência sobre validação**
    - **Validates: Requirements 2.7, 2.8, 3.10, 15.2**
    - Ação protegida sem permissão + input inválido ⇒ sempre `permission_denied`. Reusa
      `expectPermissionDenied`/`expectRejectsPermissionDenied` de `_helpers/authAssertions.ts`.
  - [x] 8.5 Testes de serviço — `rastreamento_service.test.ts`
    - `_SKIPPED` (mark/trigger), `STALE_VERSION` (config), fallback de template quando a IA falha,
      `Partial_Degradation` por bloco, e ausência total de provedor mantendo o núcleo operável. Expõe
      spies (`AI_Edge_Function`, enfileiramento de `Dispatch_Job`) via `globalThis` por causa do
      hoisting de `vi.mock`.
    - _Requirements: 7.9, 9.12, 10.5, 12.5, 12.6_

- [x] 9. Checkpoint — backend + serviço verde
  - Garantir que todos os testes passem (tsc + testes de serviço + CP14 + lint). Tirar dúvidas com o
    usuário se surgirem.

- [x] 10. UI compacta — componentes, página, rota e sidebar
  - [x] 10.1 `KpiCard` + `AtRiskTable` + `RecoveryActionsMenu` + exportação CSV
    - Em `src/components/admin/rastreamento/`. `KpiCard` no padrão compacto (label
      `text-[10px] uppercase tracking-wider text-gray-500`, valor `text-base sm:text-lg font-semibold`).
      `AtRiskTable` com `Risk_Score`/`Risk_Band` (pt-BR), `Abandonment_Cause`, `Contact_Status`,
      paginação `10/50/100` (default 10) e, em `<768px`, lista de cards single-column.
      `RecoveryActionsMenu` **gated `RASTREAMENTO_MANAGE`** (abrir WhatsApp na `Conversation_Inbox`,
      copiar telefone/mensagem, marcar contatado, ver histórico); em modo somente-leitura as ações são
      **ocultadas** por completo. Botão de exportar CSV chama `exportAtRiskCsv`.
    - _Requirements: 1.7, 1.8, 6.8, 7.2, 7.6, 7.7, 7.10, 7.11_
  - [x] 10.2 `UserJourneyTimeline`
    - Eventos por `occurred_at` crescente, rótulo pt-BR + `surface` + data/hora, `Funnel_Stage` atual,
      estado vazio `Nenhum evento de jornada registrado.` (sem erro, estrutura visível), link para
      `/admin/users/<id>` (abre a `Cliente_360_View` existente). Sem PII bruta.
    - _Requirements: 1.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 10.3 `ConversionFunnelChart` + `RecoveryPerformanceChart` (SVG inline)
    - Gráficos em **SVG inline** (sem Recharts/Chart.js); seleção de `Time_Window` `{24h,7d,30d,90d}`;
      cada bloco via `Partial_Degradation` com `<DashboardBlockError onRetry={onRefresh} />` apenas no
      bloco que falhou.
    - _Requirements: 8.1, 8.8, 8.9, 8.10, 11.1, 11.7_
  - [x] 10.4 `TrackingFilterPopover` + `TrackingAiConfigCard`
    - `TrackingFilterPopover` em popover acionado por ícone `SlidersHorizontal` (sem painel inline
      largo); filtros por nome/telefone/status/data/tipo de problema/perfil/faixa de `Risk_Score`;
      aplica só na ação explícita; estado vazio `Nenhum usuário encontrado.`. `TrackingAiConfigCard`
      **gated `RASTREAMENTO_MANAGE`** (seleciona `Active_Provider`, registra chave via Vault, nunca
      exibe a chave; `STALE_VERSION` com toast de recarregar) — oculto para somente-leitura.
    - _Requirements: 1.6, 12.1, 12.3, 12.4, 12.5, 12.7, 13.1, 13.2, 13.4, 13.7, 13.8_
  - [x] 10.5 `AdminRastreamentoPage` + rota + item de sidebar
    - `src/pages/admin/AdminRastreamentoPage.tsx` com `useAdminPermission('RASTREAMENTO_VIEW')` ⇒
      `<Stealth404 />` quando negado; monta os componentes em layout compacto (sem `<h1>` grande;
      multi-coluna em `≥768px`). Rota `rastreamento` em `AdminLayoutRoute.tsx`; item `Rastreamento`
      (`to: '/admin/rastreamento'`, gated `RASTREAMENTO_VIEW`) em `AdminSidebar.tsx`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.10, 2.5_

- [x] 11. Testes de UI
  - [x] 11.1 Escrever `rastreamentoUI.test.tsx`
    - Stealth_404 na página; item de sidebar gated; ausência de `<h1>` grande; paginação default 10 e
      troca `10/50/100`; popover de filtros; estado vazio da timeline e da lista; ocultação total das
      ações de recuperação e do card de IA em modo somente-leitura; navegação a `/admin/users/<id>`;
      formulário inválido bloqueia o envio E exibe mensagem pt-BR (validação no frontend).
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 2.5, 4.4, 7.10, 12.7, 13.1, 13.7, 15.9_

- [x] 12. Testes de integração (CI)
  - [x] 12.1 Escrever a suíte em `tests/admin/rastreamento/`
    - RLS/isolamento (sem acesso cruzado; `anon` sem leitura); `auth.uid()` nulo ⇒ `permission_denied`;
      `RASTREAMENTO_VIEW_DENIED` **persistido** em `admin_audit_logs`; audit de mutação **persistido**
      (e falha de audit não bloqueia a mutação); Master imutável (`assertNotMasterNorSelf`/trigger);
      ingestão de evento inválido ⇒ `INVALID_EVENT_TYPE` sem persistir; publicação real em
      `system_alerts` (`ABANDONMENT_SPIKE`); delegação real ao `Job_Worker` (criação de `Dispatch_Job`);
      idempotência da migration 124 (reaplicar não quebra) e não-recriação de objetos 092–118. Usa
      branch Supabase efêmero. Reusa `expectAuditPersisted`/`expectMutationSucceedsDespiteAuditFailure`/
      `expectViewDenied` e `expectAntiEnumeration`/`expectIndistinguishable`.
    - _Requirements: 3.5, 3.9, 9.8, 14.1, 14.5, 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 15.8, 16.3, 16.7_

- [x] 13. Fechamento — Critical_Modules, Regression_Suite e documentação
  - [x] 13.1 Registrar Critical_Modules em `tests/coverage.config.ts`
    - Thresholds do design: `abandonmentClassifier` 95, `riskScore` 95, `stageDerivation` 95,
      `funnelMetrics` 95, `recoveryRuleEngine` 90, `atRiskList` 90, `recoveryPerformance` 95,
      `csvExport` 90 (sob `src/services/admin/rastreamento/`). Confirmar que `scripts/check-coverage.ts`
      falha o build abaixo do mínimo.
    - _Requirements: 17.6_
  - [x] 13.2 Regression_Suite, documentação e verificação final de governança
    - Incorporar os novos testes (CP1–CP14 + unit + UI + integração) à Regression_Suite; atualizar
      `tests/README.md` e a entrada 124 em `supabase/migrations/README.md`. Verificar a regra-mãe:
      validação no frontend E no backend, cenários de falha/negativos cobertos, e `tsc` + build + lint
      + testes verdes. Nada conclui sem testes completos.
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.7_

- [x] 14. Checkpoint final — suíte completa verde
  - Garantir que todos os testes passem (unit + property + UI + integração), cobertura dentro do
    threshold e documentação atualizada. Tirar dúvidas com o usuário se surgirem.

## Notes

- **Testes obrigatórios (sem `*`):** por `testing-governance` (regra-mãe: nenhuma feature conclui sem
  testes completos) e `project-conventions` (CPs obrigatórios em specs do painel **nunca** são marcados
  com `*`), nenhuma sub-tarefa de teste deste plano é opcional. Isso é uma escolha deliberada que
  prevalece sobre a marcação opcional genérica do fluxo, alinhada às regras do workspace.
- **As 14 propriedades obrigatórias** (CP1–CP12 + Property 13 privacidade + Property 14 precedência)
  têm cada uma seu arquivo `cp<N>_<nome>.property.test.ts` em `src/__tests__/admin/rastreamento/`,
  ≥100 iterações (projeto usa 200), anotados com `// Feature: admin-rastreamento-inteligente,
  Property <N>`.
- **Convenções fast-check:** sem `fc.stringOf` (usar `fc.string({...}).filter(...)`/`safeText`); PII via
  `fc.constantFrom`; spies de `vi.mock` expostos via `globalThis` (hoisting).
- **Reuso (não duplicar/quebrar):** envio (whatsapp-automation), IA + Vault (admin-assistant), handoff
  (suporte-inteligente), identificação/navegação (admin-cliente-360), alertas/logs/insights
  (central-operacao + ia-supervisora). Única alteração cirúrgica e **aditiva** é o CHECK de
  `system_alerts.alert_type` (+`ABANDONMENT_SPIKE`), revertida no rollback.
- **Padrões herdados:** `executeAdminMutation` (audit-by-construction), `is_admin_with_permission`
  (RBAC server-side), `STALE_VERSION` (versionamento otimista), `_SKIPPED` (idempotência),
  `Stealth_404`, `Partial_Degradation`, Master imutável.
- Cada tarefa de código vem acompanhada de sua tarefa de teste; checkpoints validam incrementos.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.5", "3.3", "4.1", "4.4", "4.6"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.6", "2.7", "2.8", "3.1", "3.4", "3.5", "4.2", "4.3", "4.5", "4.7", "4.8"] },
    { "id": 4, "tasks": ["2.4", "3.2", "4.9", "4.10"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["6.3"] },
    { "id": 8, "tasks": ["6.4", "7.1", "8.1"] },
    { "id": 9, "tasks": ["8.2"] },
    { "id": 10, "tasks": ["8.3"] },
    { "id": 11, "tasks": ["8.4", "8.5", "10.1", "10.2", "10.3", "10.4"] },
    { "id": 12, "tasks": ["10.5", "12.1"] },
    { "id": 13, "tasks": ["11.1", "13.1"] },
    { "id": 14, "tasks": ["13.2"] }
  ]
}
```

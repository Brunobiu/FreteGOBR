# Implementation Plan: trial-e-bloqueio

## Overview

Plano de implementação incremental e orientado a testes para o trial de 30 dias de motoristas,
bloqueio de acesso, anti-fraude no cadastro e reflexo no painel admin. A ordem segue do núcleo puro
(`src/utils/trialStatus.ts`, alvo primário de property-based testing) para a Migration 044 (schema,
trigger, predicado de bloqueio, RLS, anti-fraude e RPCs admin), depois para o cliente (hook, badge,
header, bloqueio/roteamento, continuidade de chat) e por fim para o painel admin (serviço + UI). Cada
tarefa constrói sobre as anteriores e termina conectando o componente ao fluxo já existente, sem
deixar código órfão.

Convenções aplicadas (steering): pt-BR em texto user-facing, inglês em action/error codes e
identificadores SQL; audit-by-construction via `executeAdminMutation`; RBAC server-side em duas
camadas (`is_admin_with_permission`); versionamento otimista `updated_at` + `STALE_VERSION`; Master
Admin imutável; `Stealth404`; migration idempotente com `DO $check$` + par `_rollback.sql`; UI admin
compacto (popover de filtros, paginação 10/50/100). Os 13 property tests das Correctness Properties
são **obrigatórios** (sem `*`); testes de exemplo/unitário/integração são opcionais (com `*`).

## Tasks

- [x] 1. Núcleo puro de trial e extensão de tipos
  - [x] 1.1 Criar `src/utils/trialStatus.ts` com tipos e funções de cálculo
    - Definir tipos `UserTypeLike`, `SubscriptionStatus`, `SUBSCRIPTION_STATUSES`,
      `TrialComputationInput`, `TrialState`, `BadgeTier`
    - Implementar `computeDaysLeft(trialEndsAt, now)` = `max(0, ceil((trialEndsAt - now) / 86400000))`,
      `null ⇒ 0`
    - Implementar `computeTrialState(input)` (isenção de embarcador/admin ⇒ `{daysLeft:0,isExpired:false}`;
      `isExpired = trialEndsAt!=null && trialEndsAt<=now && !isSubscribed`)
    - Implementar `selectBadgeTier({userType,isSubscribed,daysLeft})` (hidden/green/yellow/red/red-pulse)
    - Implementar `computeTrialEndsAt(createdAt)` = `createdAt + 30*86400000`
    - Funções totais, sem I/O, sem dependência de React/supabase
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 7.1, 7.2, 7.4_

  - [x] 1.2 Adicionar a `trialStatus.ts` os predicados puros de autorização e identificador
    - `canAccessFrete(frete, caller)` — espelho da `fretes_select_policy` (continuidade via conversa
      própria + feed `ativo` negado para bloqueado)
    - `canAcceptNewFrete(caller)` — espelho do guard de `toggle_frete_like` (nega novo aceite p/ bloqueado)
    - `normalizeIdentifier(type, value)` e `computeIdentifierAvailable(type, value, existing)` — espelho
      de `is_identifier_available` (normalização de phone/cpf/email)
    - _Requirements: 5.6, 6.1, 6.2, 6.3, 8.6, 8.7, 9.1, 9.4_

  - [x] 1.3 Property test — `computeDaysLeft`
    - **Property 1: Cálculo de dias restantes**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - `src/__tests__/trialStatus.property.test.ts`; fast-check ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 1`; cobrir fronteira `trialEndsAt === now`, sub-dia (ceil) e `null`

  - [x] 1.4 Property test — `computeTrialState` (predicado de bloqueio e isenção)
    - **Property 2: Predicado de bloqueio e isenção**
    - **Validates: Requirements 1.4, 2.4, 5.1, 7.1, 7.2, 9.3**
    - `src/__tests__/trialStatus.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 2`; gerar `userType` em motorista/embarcador/admin

  - [x] 1.5 Property test — `selectBadgeTier` (função total)
    - **Property 3: Seleção de tier do TrialBadge (função total)**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.4**
    - `src/__tests__/trialStatus.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 3`; `fc.nat({max:400})` com fronteiras 0,1,5,10,11

  - [x] 1.6 Property test — `computeTrialEndsAt`
    - **Property 4: Concessão do trial (created_at + 30 dias)**
    - **Validates: Requirements 1.1**
    - `src/__tests__/trialStatus.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 4`

  - [x]* 1.7 Testes de exemplo/edge do núcleo puro
    - Casos pontuais: `trialEndsAt` nulo, `now === trialEndsAt`, status fora do domínio tratado como `trial`
    - `src/__tests__/trialStatus.example.test.ts`
    - _Requirements: 2.3, 3.3_

  - [x] 1.8 Estender o tipo `User` e o mapeamento em `auth.ts`
    - Adicionar `trialEndsAt?`, `subscriptionStatus?`, `isSubscribed?` em `src/types/index.ts`
    - Mapear `trial_ends_at`/`subscription_status`/`is_subscribed` em `login`/`register`/
      `getCurrentUser`/`refreshToken` (`src/services/auth.ts`) e persistir no cache `fretego_user`
    - _Requirements: 3.1_

- [x] 2. Migration 044 — schema, trigger, predicado, RLS, anti-fraude e RPCs admin
  - [x] 2.1 Schema e concessão do trial
    - `supabase/migrations/044_trial_e_bloqueio.sql` com `BEGIN/COMMIT` e `DO $check$` exigindo
      migrations 030/031/008
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS` para `trial_ends_at timestamptz`,
      `subscription_status text DEFAULT 'trial'`, `is_subscribed boolean DEFAULT false` + `CHECK`
      de domínio fechado
    - Índice parcial `idx_users_trial_motoristas` em `(trial_ends_at) WHERE user_type='motorista'`
    - Trigger `users_set_trial_defaults` (BEFORE INSERT) + backfill de motoristas sem `trial_ends_at`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Predicado de bloqueio, RLS de fretes e guard de aceite
    - `is_motorista_trial_blocked(uuid)` (SQL STABLE SECURITY DEFINER, `SET search_path=public`)
    - Substituir `fretes_select_policy` com continuidade (conversa própria) + bloqueio do feed `ativo`
    - `CREATE OR REPLACE` em `toggle_frete_like` adicionando guard `is_motorista_trial_blocked ⇒ RAISE 'trial_blocked'`
    - _Requirements: 5.1, 5.6, 6.1, 6.3, 9.1, 9.2, 9.3, 9.4_

  - [x] 2.3 Anti-fraude no servidor
    - `is_identifier_available(text,text)` (normalização phone/cpf/email; `GRANT EXECUTE` a `anon, authenticated`)
    - Trigger `users_antifraud_duplicate_block` (BEFORE INSERT) que aborta em duplicidade de phone/cpf/email
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 2.4 RPCs admin de listagem e extensão
    - `admin_list_trial_motoristas(...)` (USER_VIEW + audit negativo `TRIAL_VIEW_DENIED`; `days_left` e
      `trial_state` computados no servidor; filtro prestes-a-expirar `0 < days_left <= 5`)
    - `admin_extend_trial(...)` (USER_EDIT + audit negativo; Master imutável antes do touch; `NOT_MOTORISTA`;
      versionamento otimista com `STALE_VERSION`; `INVALID_INPUT` p/ data não futura)
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` em todas as funções novas; bloco `-- VERIFY` comentado
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 2.5 Par de rollback da Migration 044
    - `supabase/migrations/044_trial_e_bloqueio_rollback.sql` documentado (não auto-aplicado): drop de
      triggers/funções/índice/RPCs, restauração da `fretes_select_policy` e `toggle_frete_like` anteriores,
      drop das colunas novas
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Checkpoint — Migration e núcleo puro
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Anti-fraude no cadastro (cliente)
  - [x] 4.1 Integrar pré-check e mapeamento de erro em `auth.register`
    - Exportar `DUPLICATE_IDENTIFIER_MESSAGE = 'Este CPF/telefone/e-mail já está cadastrado.'`
    - Pré-check via `is_identifier_available('phone'|'cpf'|'email', value)` (fail-open em erro de rede)
    - Mapear erro do trigger `duplicate_identifier:*` para a mensagem canônica + rollback compensatório
      existente (`delete users` + `signOut`) em `src/services/auth.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 4.2 Wiring no `RegisterForm`
    - Exibir a mensagem canônica de duplicidade e permitir prosseguir quando os identificadores são únicos
    - `src/components/RegisterForm.tsx`
    - _Requirements: 8.2, 8.6_

  - [x] 4.3 Property test — rejeição atômica de cadastro duplicado
    - **Property 7: Rejeição atômica de cadastro duplicado**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
    - `src/__tests__/antifraude.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 7`;
      geradores de CPF/telefone/email via `fc.constantFrom` (templates válidos com variações de formatação)

  - [x] 4.4 Property test — disponibilidade quando todos os identificadores são únicos
    - **Property 8: Disponibilidade quando todos os identificadores são únicos**
    - **Validates: Requirements 8.6**
    - `src/__tests__/antifraude.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 8`

  - [x] 4.5 Property test — checagem isolada é booleana e sem efeito colateral
    - **Property 9: Checagem isolada de disponibilidade é booleana e sem efeito colateral**
    - **Validates: Requirements 8.7**
    - `src/__tests__/antifraude.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 9`

  - [x]* 4.6 Integração/smoke do anti-fraude (paridade SQL↔TS + rollback do register)
    - Mock do `supabase`; verificar mensagem canônica e que nenhuma conta órfã permanece
    - `src/__tests__/antifraude.integration.test.ts`
    - _Requirements: 8.1, 8.5_

- [x] 5. Hook, TrialBadge e Header
  - [x] 5.1 Implementar `useTrialStatus`
    - Lê `useAuth()`; fallback ao cache `fretego_user` quando `user == null`; default seguro sem auth/sem cache
    - Delega 100% do cálculo a `computeTrialState`; memoização com `useMemo`; `now = new Date()`
    - `src/hooks/useTrialStatus.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.2 Implementar `TrialBadge`
    - Consome `useTrialStatus` + `selectBadgeTier`; `tier === 'hidden' ⇒ null`
    - Texto `Teste grátis: {daysLeft} dias`; classes Tailwind por tier; `red-pulse` com `animate-pulse`;
      responsivo `<768px`; `role="status"`/`aria-live="polite"`
    - `src/components/TrialBadge.tsx`
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 5.3 Renderizar `TrialBadge` no `AppHeader`
    - Inserir no cluster da direita (antes do sino); auto-ocultação cobre não-motoristas/assinantes
    - `src/components/AppHeader.tsx`
    - _Requirements: 4.2, 4.3_

  - [x]* 5.4 Testes do hook `useTrialStatus`
    - Sem auth/sem cache (default), fallback de cache, isenção embarcador/admin
    - `src/__tests__/useTrialStatus.test.ts`
    - _Requirements: 3.3, 3.4, 3.5_

  - [x]* 5.5 Testes de render do `TrialBadge`
    - Texto exato, mapeamento tier↔classe, oculto em `daysLeft === 0`, responsivido
    - `src/__tests__/trialBadge.example.test.tsx`
    - _Requirements: 4.1, 4.9_

- [x] 6. Bloqueio: TrialExpiredPage, roteamento, feed e continuidade de chat
  - [x] 6.1 Implementar `TrialExpiredPage`
    - Mensagem "Seu teste expirou. Assine para continuar."; botão "Assinar" ⇒ `/motorista/plano`
    - Tabela informativa `PLAN_INFO` (Mensal R$ 39,00; Trimestral R$ 87,00; Semestral R$ 150,00); responsiva `<768px`
    - `src/pages/TrialExpiredPage.tsx`
    - _Requirements: 5.3, 5.4, 5.5, 5.9_

  - [x] 6.2 Implementar `TrialGate` e `MotoristaProtectedRoute`
    - `TrialGate` usa `useTrialStatus`: `isExpired ⇒ <TrialExpiredPage/>`, senão `children`
    - `MotoristaProtectedRoute` compõe `ProtectedRoute` + `TrialGate`
    - `src/components/MotoristaProtectedRoute.tsx` (e ajuste mínimo em `ProtectedRoute.tsx` se necessário)
    - _Requirements: 5.2, 5.7_

  - [x] 6.3 Conectar rotas em `App.tsx`
    - `/mensagens`, `/assistente` ⇒ `MotoristaProtectedRoute`; `/motorista/plano`, `/perfil/motorista`,
      `/configuracoes` permanecem `ProtectedRoute`; admin inalterado (TrialGate inerte p/ admin)
    - `src/App.tsx`
    - _Requirements: 5.2, 7.3_

  - [x] 6.4 Bloquear o feed da `HomePage` para motorista bloqueado
    - Quando `userType === 'motorista'` e `isExpired`, renderizar `<TrialExpiredPage/>` no lugar do feed,
      sem chamar `getActiveFretes`
    - `src/pages/HomePage.tsx`
    - _Requirements: 5.6_

  - [x] 6.5 Property test — continuidade de fretes em andamento
    - **Property 5: Continuidade de fretes em andamento**
    - **Validates: Requirements 6.1, 6.2, 9.4**
    - `src/__tests__/trialAuthz.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 5`
      (modelo puro de `canAccessFrete`)

  - [x] 6.6 Property test — negação de novo aceite por motorista bloqueado
    - **Property 6: Negação de novo aceite por motorista bloqueado**
    - **Validates: Requirements 5.6, 6.3, 9.1, 9.2**
    - `src/__tests__/trialAuthz.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 6`
      (modelo puro de `canAcceptNewFrete` + negação do feed)

  - [x]* 6.7 Testes de render/navegação da `TrialExpiredPage`
    - Mensagem, navegação do botão "Assinar", presença dos valores de `PLAN_INFO`
    - `src/__tests__/trialExpiredPage.test.tsx`
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 6.8 Continuidade de chat (não bloquear `/mensagens`)
    - Manter `/mensagens` sem `TrialGate`; refletir no cliente a continuidade autoritativa do servidor
      (somente conversas de fretes em andamento quando bloqueado)
    - `src/pages/MensagensPage.tsx` e/ou `src/components/FreteChatWidget.tsx`
    - _Requirements: 5.7, 6.2_

- [x] 7. Checkpoint — Cliente (badge, bloqueio, anti-fraude)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Serviço admin de trial
  - [x] 8.1 Helpers puros e contrato em `src/services/admin/trial.ts`
    - Tipos `TrialStatusFilter`, `TrialSort`, `TrialFilters`, `TrialMotoristaRow`, `TrialListResult`,
      `TrialErrorCode`, `TRIAL_ERROR_MESSAGES`
    - Funções puras: `classifyTrialState`, `isAboutToExpire`, `isStaleVersion`,
      `parseTrialFiltersFromQuery`, `serializeTrialFiltersToQuery`
    - _Requirements: 10.2, 10.3, 11.2, 11.3_

  - [x] 8.2 Funções de I/O em `src/services/admin/trial.ts`
    - `listTrialMotoristas(filters)` via RPC `admin_list_trial_motoristas`
    - `extendTrial(userId, newTrialEndsAt, expectedUpdatedAt)` via `executeAdminMutation`
      (`action:'TRIAL_EXTEND'`, `targetType:'users'`) ⇒ RPC `admin_extend_trial`; tratar `STALE_VERSION`
    - _Requirements: 10.1, 10.4, 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 8.3 Property test — filtro de status de trial
    - **Property 10: Filtro de status de trial no painel admin**
    - **Validates: Requirements 10.2**
    - `src/__tests__/admin/trial/trialFilters.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 10`

  - [x] 8.4 Property test — lista de prestes-a-expirar
    - **Property 11: Lista de prestes-a-expirar**
    - **Validates: Requirements 10.3**
    - `src/__tests__/admin/trial/trialFilters.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 11`

  - [x] 8.5 Property test — versionamento otimista na extensão de trial
    - **Property 12: Versionamento otimista na extensão de trial**
    - **Validates: Requirements 11.2, 11.3**
    - `src/__tests__/admin/trial/extendTrial.property.test.ts`; ≥100 runs; tag
      `Feature: trial-e-bloqueio, Property 12` (modelo de `isStaleVersion`)

  - [x] 8.6 Property test — extensão para o futuro desbloqueia
    - **Property 13: Extensão para o futuro desbloqueia**
    - **Validates: Requirements 11.4**
    - `src/__tests__/trialAuthz.property.test.ts`; ≥100 runs; tag `Feature: trial-e-bloqueio, Property 13`
      (composição de `computeTrialState`/predicado de bloqueio com `trial_ends_at` futuro)

  - [x]* 8.7 Integração/smoke do serviço admin
    - Wiring de RPC + audit (`TRIAL_EXTEND`, `TRIAL_VIEW_DENIED`), gating RBAC/Stealth404, defaults de schema
    - `src/__tests__/admin/trial/trialService.integration.test.ts`
    - _Requirements: 1.2, 1.3, 10.4, 11.1, 11.6_

- [x] 9. UI admin de trial
  - [x] 9.1 `TrialListPage`
    - Gate `useAdminPermission('USER_VIEW')` ⇒ `<Stealth404/>`; estilo compacto (sem `<h1>`,
      paginação 10/50/100); degrada exibindo dados mesmo sem o estilo compacto
    - `src/pages/admin/trial/TrialListPage.tsx`
    - _Requirements: 10.1, 10.4, 10.5, 10.6_

  - [x] 9.2 `TrialMotoristasTable`
    - Colunas status (em trial/expirado/assinante) + dias restantes; cards single-column no mobile
    - `src/components/admin/trial/TrialMotoristasTable.tsx`
    - _Requirements: 10.1, 10.5, 10.6_

  - [x] 9.3 `TrialFilters`
    - Popover (`SlidersHorizontal`) com filtro por status + toggle "prestes a expirar"
    - `src/components/admin/trial/TrialFilters.tsx`
    - _Requirements: 10.2, 10.3, 10.5_

  - [x] 9.4 `ExtendTrialModal`
    - Date picker do novo `trial_ends_at`; lê `updated_at` ao abrir e reenvia (versionamento otimista);
      botão desabilitado para Master Admin; validação de data futura
    - `src/components/admin/trial/ExtendTrialModal.tsx`
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [x] 9.5 Wiring de navegação admin
    - Item "Trial" (`/admin/trial`, permission `USER_VIEW`) no `AdminSidebar`; nova rota `trial` em
      `AdminLayoutRoute`
    - `src/components/admin/AdminSidebar.tsx`, `src/components/admin/AdminLayoutRoute.tsx`
    - _Requirements: 10.1, 10.4_

  - [x]* 9.6 Testes de exemplo da UI admin
    - Stealth404 sem permissão, render da tabela, toast de `STALE_VERSION` no modal
    - `src/__tests__/admin/trial/trialUI.test.tsx`
    - _Requirements: 10.4, 11.3_

- [x] 10. Checkpoint final — Painel admin e integração
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes de exemplo/unitário/integração) e podem ser puladas
  para um MVP mais rápido. Os 13 property tests das Correctness Properties são **obrigatórios** (sem `*`),
  conforme a convenção de specs do painel.
- Cada property test referencia explicitamente sua propriedade do design, usa fast-check com no mínimo
  100 iterações e é tagueado com `Feature: trial-e-bloqueio, Property {n}`.
- A Migration 044 é construída incrementalmente no mesmo arquivo `.sql` (tarefas 2.1→2.4) com par de
  rollback (2.5); por isso essas tarefas são sequenciais.
- O cliente nunca é a fonte de verdade: a autoridade do bloqueio/continuidade é o servidor (RLS + RPCs).
  Os predicados puros TS são a especificação executável (paridade SQL↔TS).
- Checkpoints garantem validação incremental nos limites de migration, cliente e painel admin.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.7", "1.8", "2.2", "4.3", "6.5", "6.7", "8.1"] },
    { "id": 2, "tasks": ["1.4", "2.3", "4.4", "5.1", "6.6", "8.3", "8.5", "9.2", "9.3"] },
    { "id": 3, "tasks": ["1.5", "2.4", "4.1", "4.5", "5.2", "5.4", "6.2", "6.4", "6.8", "8.4", "8.6"] },
    { "id": 4, "tasks": ["1.6", "2.5", "4.2", "4.6", "5.3", "5.5", "6.3", "8.2"] },
    { "id": 5, "tasks": ["8.7", "9.1", "9.4"] },
    { "id": 6, "tasks": ["9.5", "9.6"] }
  ]
}
```

# Implementation Plan — finalizacao-lancamento

## Overview

Plano incremental para levar o FreteGO ao estado "pronto para lançar". Organizado em fases que vão do
risco zero (núcleo puro testável) ao de maior integração, terminando em polimento e validação manual.

Política de execução (exigência do dono):
- **Testes em toda funcionalidade nova**: cada bloco de código de produção tem sub-tarefa de testes
  dedicada (unit + property quando há invariante). Property tests em `src/__tests__/`
  (`numRuns >= 100`, convenções fast-check do projeto: nunca `fc.stringOf`; PII via `fc.constantFrom`;
  `vi.mock` hoisted com `globalThis.__spy`).
- **Não-regressão a cada fase**: ao fim de cada fase rodar a suíte COMPLETA (`tsc --noEmit` +
  `vitest run` + `npm run build`) e confirmar verde antes de avançar.
- **NÃO commitar durante a execução** — o dono valida tudo no fim e então commitamos/pushamos de uma
  vez (decisão desta sessão).
- **Mudanças aditivas**: nada que já funciona é alterado, salvo o layout mobile aditivo de duas páginas
  admin (Fase 6).
- Sub-tarefas marcadas com `*` são **opcionais** (property tests complementares e itens
  Infra_Dependent que exigem branch Supabase efêmero/secrets para execução verde). O agente NÃO as
  executa automaticamente.
- Convenções herdadas (não redocumentar — ver `project-conventions.md`, `admin-patterns.md`,
  `testing-governance.md`): migration idempotente com `DO $check$` + par `_rollback.sql`; RPC
  `SECURITY DEFINER` + `search_path` + `auth.uid()` + `is_admin_with_permission` + REVOKE/GRANT;
  `executeAdminMutation`; versionamento otimista; idempotência `_SKIPPED`; Stealth_404; Master Admin
  imutável. **Migração de Admin Settings = 084** (próxima livre real; 045/046 puladas).

## Tasks

## Fase 0 — Núcleo puro do Settings (sem I/O, risco zero)

- [x] 1. Tipos e helpers puros do Settings_Service
  - Criar `src/services/admin/settings.ts` com os tipos públicos (`SettingCategory`,
    `SettingValueType`, `EvolutionConnectionStatus`, `SettingRecord`, `SettingsByCategory`,
    `SettingsErrorCode`, classe `SettingsServiceError` + `SETTINGS_ERROR_MESSAGES` pt-BR) e os helpers
    puros: `reaisToCents`, `centsToReais`, `maskSecret`, `validateSettingValue`,
    `validateEvolutionBaseUrl`, `validateEmail`, `groupByCategory`, `decideSecretAction`,
    `toSettingsError`. Nenhuma chamada a Supabase nesta task.
  - _Requirements: 2.2, 4.2, 5.3, 6.2, 7.4, 9.2, 10.1, 10.2, 10.3, 10.5_

- [x] 2. Property tests obrigatórios dos helpers puros (CP-1, CP-2, CP-3)
  - `src/__tests__/admin/settings/secretMasking.property.test.ts` (Property 1: segredo nunca vaza;
    `maskSecret` revela ≤4 chars, mascara tudo se bruto ≤4).
  - `src/__tests__/admin/settings/validateSettingValue.property.test.ts` (Property 2: validação por
    tipo/enum/intervalo; readonly ⇒ `READONLY_SETTING`).
  - `src/__tests__/admin/settings/moneyRoundtrip.property.test.ts` (Property 3:
    `reaisToCents(centsToReais(c))===c`, 2 casas).
  - _Requirements: 12.2, 12.3, 12.4, 12.6_

- [x]* 2.1 Property tests opcionais dos helpers (CP-6, CP-7, CP-9)
  - `validateUrl.property.test.ts` (URL https), `validateEmail.property.test.ts` (e-mail válido/vazio),
    `groupByCategory.property.test.ts` (5 categorias sempre presentes, sem perda).
  - _Requirements: 5.3, 9.2, 8.3_

- [x] 3. Regressão da Fase 0
  - Rodar `tsc --noEmit` + `vitest run` (CP-1/CP-2/CP-3 verdes) + `npm run build`. Confirmar verde.
  - _Requirements: 28.2_

## Fase 1 — Banco (migration 084)

- [x] 4. Migration 084: tabela, RPCs, seeds, rollback
  - [x] 4.1 Criar `supabase/migrations/084_admin_settings.sql` (scaffold idempotente)
    - `BEGIN; ... COMMIT;`, bloco `DO $check$` validando `is_admin_with_permission`,
      `admin_audit_logs` e extensão `supabase_vault`.
    - _Requirements: 11.1, 11.2, 11.4_
  - [x] 4.2 Tabela `platform_settings` com colunas, CHECKs de coerência, `UNIQUE (category,key)`, índice
    e RLS `platform_settings_no_dml`.
    - _Requirements: 11.3_
  - [x] 4.3 RPC `admin_settings_get()` (STABLE, `SETTINGS_VIEW`, masking de secret, `SETTINGS_VIEW_DENIED`
    no negativo).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 4.4 RPC `admin_settings_update(p_key, p_value, p_expected_updated_at)` (`SETTINGS_EDIT`,
    validação por tipo/enum/range, versionamento otimista, erros tipados).
    - _Requirements: 3.4, 3.6, 3.8, 3.9, 10.1, 10.2, 10.3, 10.4_
  - [x] 4.5 RPC `admin_settings_secret_set(p_key, p_secret, p_expected_updated_at)` (Vault, `secret_last4`,
    `value=NULL`).
    - _Requirements: 4.1, 4.2, 4.3, 5.2_
  - [x] 4.6 RPC `admin_settings_secret_clear(p_key, p_expected_updated_at)` idempotente
    (`SETTINGS_SECRET_CLEARED` / `_SKIPPED`).
    - _Requirements: 4.4, 4.8_
  - [x] 4.7 RPC `app_get_setting_secret(p_key)` server-only (REVOKE FROM PUBLIC, sem GRANT a
    `authenticated`).
    - _Requirements: 4.9_
  - [x] 4.8 Seeds idempotentes (`ON CONFLICT DO NOTHING`): trial_duration_days=30; preços
    3900/8700/15000; 4 chaves Evolution; 2 contatos de suporte; categoria `ai` sem seed. Posture
    REVOKE/GRANT em cada RPC + bloco `-- VERIFY` comentado.
    - _Requirements: 5.1, 5.5, 6.1, 7.1, 8.1, 9.1, 11.5, 11.6, 11.8_
  - [x] 4.9 Criar `supabase/migrations/084_admin_settings_rollback.sql` (DROP reverso documentado, não
    auto-aplicado).
    - _Requirements: 11.7_

- [ ]* 4.10 Teste de idempotência da migration (Infra_Dependent)
  - Script que aplica a 084 duas vezes sem erro/duplicação de seeds.
  - _Requirements: 11.3, 11.5_

- [x] 5. Regressão da Fase 1
  - `tsc --noEmit` + `vitest run` + `npm run build` verdes (migration não quebra o build TS).
  - _Requirements: 28.2_

## Fase 2 — Wrappers do Service + property tests do service

- [x] 6. Wrappers de leitura/mutação no Settings_Service
  - Adicionar a `settings.ts`: `getSettings` (RPC `admin_settings_get`, `groupByCategory`, degradação
    parcial com `Promise.allSettled`), `updateSetting` (`executeAdminMutation('SETTINGS_UPDATED', ...)`),
    `setSecret` (`executeAdminMutation('SETTINGS_SECRET_UPDATED', ...)` com before/after só
    `{is_set,last4}`), `clearSecret` (RPC idempotente).
  - _Requirements: 2.1, 2.7, 3.2, 3.3, 4.1, 4.3, 4.4, 4.7_

- [x]* 6.1 Property tests opcionais do service (CP-4, CP-5, CP-8, CP-10)
  - `optimisticVersion`, `secretClear`, `auditContract`, `partialDegradation` (RPC mockada via
    `globalThis.__rpcSpy`, factory hoisted-safe).
  - _Requirements: 3.4, 3.6, 4.4, 4.7, 2.7, 3.2_

- [x] 7. Regressão da Fase 2
  - `tsc --noEmit` + `vitest run` + `npm run build` verdes.
  - _Requirements: 28.2_

## Fase 3 — Componentes e página do Settings

- [x] 8. Componentes de UI (`src/components/admin/settings/`)
  - `SettingsBlockSkeleton.tsx`, `SettingsBlockError.tsx` (botão Tentar novamente), `SettingField.tsx`
    (render por tipo; money em R$ 2 casas; readonly/enum desabilitados; validação inline + Salvar
    desabilitado; captura/reenvia `updated_at`), `SecretField.tsx` (Não configurado / masked +
    Substituir/Remover; em branco preserva), `SettingsCategorySection.tsx` (agrupa; avisos integrations
    e ai; integra skeleton/error).
  - _Requirements: 1.7, 2.7, 4.5, 4.6, 5.4, 5.7, 6.3, 7.3, 7.4, 8.2, 8.3, 9.3, 10.5, 13.1, 13.4_

- [x] 9. Página `/admin/settings` + rota + sidebar
  - Criar `src/pages/admin/settings/SettingsPage.tsx` (Stealth_404 sem `SETTINGS_VIEW`; `canEdit` por
    `SETTINGS_EDIT`; sem `<h1>` grande; 5 seções; coluna única `<768px`; toasts canônicos `status`/
    `alert`). Registrar rota filha `settings` em `AdminLayoutRoute.tsx` (gated `SETTINGS_VIEW`).
    Confirmar item em `AdminSidebar.tsx` (`permission: 'SETTINGS_VIEW'`).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.5, 3.7, 3.10, 13.2, 13.3, 13.5_

- [ ]* 9.1 Testes de componente/página e gating de rota (opcionais)
  - Unit de `SettingField`/`SecretField` (render por tipo, máscara, readonly); `SettingsPage` (sem h1,
    seção IA sempre presente, aviso Evolution, toasts com `role`); gating por papel usando a
    `Permission_Matrix` real.
  - _Requirements: 1.2, 1.3, 1.4, 3.1, 4.5, 4.6, 5.4, 6.3, 7.3, 8.2, 12.5, 13.1, 13.3_

- [x] 10. Regressão da Fase 3 (fim do Admin Settings)
  - `tsc --noEmit` + `vitest run` (CP-1/2/3 verdes) + `npm run build`. Confirmar verde. Admin Settings
    funcional ponta a ponta no código.
  - _Requirements: 28.2, 28.4_

## Fase 4 — Fundação de testes reutilizável

- [x] 11. Helper de auditoria + harness Supabase
  - Criar `src/__tests__/_helpers/auditAssertions.ts` (`expectAuditPersisted`,
    `expectMutationSucceedsDespiteAuditFailure`, `expectViewDenied`) reusando os helpers canônicos
    existentes.
  - Criar `tests/_helpers/supabaseHarness.ts` (`asUser`, `asAnon`, `asService`, `seedUser`, `cleanup`;
    credenciais via env). **Infra_Dependent** na execução.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 12. Regressão da Fase 4
  - `tsc --noEmit` + `vitest run` + `npm run build` verdes (helpers compilam, não quebram a suíte).
  - _Requirements: 28.2_

## Fase 5 — Testes de integração, segurança, E2E e performance (Infra_Dependent)

> Entregam código/config; execução verde depende de branch Supabase efêmero + secrets no CI.

- [ ]* 13. Testes de integração (`tests/integration/`)
  - `auth`, `frete-lifecycle`, `chat`, `billing-webhooks`, `uploads`, `lgpd-audit`, `jobs-external` com
    os erros canônicos (anti-enumeração pt-BR, `STALE_VERSION`, RLS, `WEBHOOK_SIGNATURE_INVALID` +
    idempotência, `INVALID_FILE_TYPE`, audit persistido, retry/degradação).
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

- [ ]* 14. Testes de segurança (`tests/security/`)
  - `rlsHarness.ts` + `rls-isolation.test.ts` (Property 6; Master Admin imutável); `injection-vectors`
    (Property 10); `rate-limit-bruteforce` (429, Retry-After, anti-enumeração).
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 17.1, 17.2, 17.3, 17.4, 17.5_

- [ ]* 15. Validação de saída, contratos e observabilidade
  - Testes de estrutura JSON/schema, ausência de campos sensíveis, `expectNoSecrets`/
    `expectStructuredLog`, compatibilidade de contrato (compatível passa, incompatível falha).
  - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [ ]* 16. Playwright (E2E) + k6 (performance)
  - `tests/e2e/playwright.config.ts` (desktop + mobile <768px, retries:1), `fixtures/e2eFixtures.ts` +
    `expectInvalidFormBlocked`, specs `auth.e2e`/`frete.e2e`/`devices-adverse.e2e`.
    `tests/performance/load.k6.js` + `thresholds.json`.
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [ ]* 17. Extensões de CI
  - `scripts/validate-migrations.ts` (incremental a partir de 084, reconhece salto 045/046, exige
    `_rollback.sql`), `scripts/validate-env.ts`, `scripts/test-report.ts`. Jobs `migrations` e
    `env-check` em `ci.yml` (aditivo); workflows `e2e.yml` e `performance.yml`.
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8_

## Fase 6 — Testes opcionais de robustez + polimentos

- [ ]* 18. Property tests opcionais de módulos já implementados
  - security-hardening (12: FileValidatorAdvanced, inputLimits, CSRFTokenManager, antiEnumeration,
    SessionManager, jwtRevocation, BruteForceProtector, passwordValidation, rateLimiter, auditLogger,
    honeypot, urlSanitizer); embarcador-onboarding (verification, onboardingProgress, maskTarget);
    motorista-perfil-extras (souEuProprietario); schema-alignment-fixes (documentTypeValidation,
    registerRollback, chatErrorMapping); admin-financeiro CP-2 `markAsPaid` idempotente (única exceção
    do módulo de comissão).
  - _Requirements: 21.1, 21.2, 21.3, 22.1, 22.2, 22.3, 23.1, 23.2, 23.3, 23.4_

- [x] 19. Cards mobile nas tabelas admin de notificações (único toque em produção)
  - `AdminTicketsPage.tsx` e `AdminBroadcastPage.tsx`: render de cards single-column em `<768px`,
    preservando a tabela em `>=768px` (aditivo, desktop inalterado).
  - _Requirements: 24.1, 24.2, 24.3_

- [ ]* 19.1 Atualizar documentação do notifications-hub
  - ROADMAP e GUIA_TESTES_MANUAIS refletindo o estado entregue (só docs).
  - _Requirements: 25.1, 25.2, 25.3_

- [x] 20. Regressão da Fase 6
  - `tsc --noEmit` + `vitest run` + `npm run build` verdes. Confirmar que o toque mobile não regrediu
    o desktop.
  - _Requirements: 24.3, 28.2_

## Fase 7 — Fechamento

- [x] 21. Não-regressão final + Regression_Suite + cobertura
  - Rodar suíte completa (tsc + vitest + build) 2x para checar estabilidade; incorporar os novos testes
    obrigatórios à Regression_Suite; conferir thresholds dos Critical_Modules (`check-coverage.ts`).
  - _Requirements: 28.2, 28.3, 28.4_

- [ ]* 22. Validação pré-lançamento (Manual_Validation — NÃO é código)
  - Roteiro manual: aplicar migration 084 + bloco `-- VERIFY` (rollback se falhar); smoke tests do
    Settings (ler/editar/secret set-replace-clear/versão) e dos fluxos críticos (cadastro, frete, chat,
    billing, uploads) em ambiente real. Itens executados pelo dono, fora do código.
  - _Requirements: 26.1, 26.2, 26.3, 26.4, 27.1, 27.2, 27.3_

## Notes

- Sub-tarefas com `*` são opcionais (property tests complementares + itens Infra_Dependent que exigem
  branch Supabase efêmero/secrets). Não bloqueiam o Launch_Readiness.
- Tasks **2** (CP-1/CP-2/CP-3) e **19** (cards mobile) e todas as de regressão são obrigatórias.
- Migration de Admin Settings é a **084** (045/046 puladas; última aplicada 083).
- O único código de produção existente com lógica alterada é o layout mobile de AdminTicketsPage e
  AdminBroadcastPage (Fase 6), de forma aditiva.
- **Sem commits durante a execução**: validação final do dono → commit + push de tudo de uma vez.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "2.1"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4.1"] },
    { "wave": 5, "tasks": ["4.2"] },
    { "wave": 6, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7"] },
    { "wave": 7, "tasks": ["4.8"] },
    { "wave": 8, "tasks": ["4.9", "4.10"] },
    { "wave": 9, "tasks": ["5"] },
    { "wave": 10, "tasks": ["6"] },
    { "wave": 11, "tasks": ["6.1"] },
    { "wave": 12, "tasks": ["7"] },
    { "wave": 13, "tasks": ["8"] },
    { "wave": 14, "tasks": ["9"] },
    { "wave": 15, "tasks": ["9.1"] },
    { "wave": 16, "tasks": ["10"] },
    { "wave": 17, "tasks": ["11"] },
    { "wave": 18, "tasks": ["12"] },
    { "wave": 19, "tasks": ["13", "14", "15", "16", "17"] },
    { "wave": 20, "tasks": ["18", "19", "19.1"] },
    { "wave": 21, "tasks": ["20"] },
    { "wave": 22, "tasks": ["21", "22"] }
  ]
}
```

# Implementation Plan

## Overview

Plano de implementação do módulo **Configurações** do painel admin (`/admin/settings`), organizado em
8 epics incrementais. Cada sub-task referencia cláusulas do `requirements.md` (Reqs X.Y) e/ou
propriedades de correção do `design.md` (CP-N). A ordem é construtiva: banco → service (tipos →
helpers puros → wrappers) → componentes → página/rota → testes de integração/smoke → checkpoints. Cada
passo se apoia no anterior e termina integrado; nenhum código fica órfão.

Convenções herdadas (não redocumentar — ver `project-conventions.md` e `admin-patterns.md`):
- Migration idempotente com `BEGIN; ... COMMIT;`, bloco `DO $check$` defensivo, seeds via
  `INSERT ... ON CONFLICT DO NOTHING`, bloco `-- VERIFY` comentado + par `_rollback.sql` documentado
  (não auto-aplicado).
- RPCs `SECURITY DEFINER` com `SET search_path = public`, `auth.uid()` check, gating
  `is_admin_with_permission(...)` (grava `SETTINGS_VIEW_DENIED` no path negativo),
  `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
- Toda mutação não-idempotente passa por `executeAdminMutation` (audit-by-construction).
  Idempotência (`clearSecret`) grava o audit log **dentro** da RPC (`_SKIPPED`).
- Versionamento otimista via `updated_at` + `STALE_VERSION`.
- `Stealth_404` em acesso sem permissão; UI em modo somente leitura sem `SETTINGS_EDIT`.
- pt-BR em UI/comentários/mensagens user-facing; action codes, error codes e identifiers SQL/TS em
  inglês. Padrão compacto pós-cleanup (sem `<h1>` grande, botões `text-xs px-2.5 py-1`).
- TypeScript strict; Vitest + fast-check; **sem novas deps npm** (Vault nativo, `URL`/regex).
- Property tests fast-check com `{ numRuns: 100 }` (mínimo 100 iterações), tag de rastreabilidade
  `Feature: admin-settings, Property {n}: {texto}`. `vi.mock` hoisted → expor spies via
  `(globalThis as Record<string, unknown>).__spy`; `fc.stringOf` não existe (usar
  `fc.string({minLength,maxLength}).filter(...)`); e-mails/URLs válidos via `fc.constantFrom([...])`.
- **Permission_Matrix não muda** — `SETTINGS_VIEW`/`SETTINGS_EDIT` já existem desde a migration 030.
  Nenhuma alteração em `permissions.ts`.

> **Propriedades obrigatórias vs opcionais.** Por `design.md` (§Overview e §Correctness Properties),
> as propriedades **obrigatórias** são **CP-1** (segredo nunca vaza / masking), **CP-2** (validação por
> `Setting_Value_Type`) e **CP-3** (round-trip centavos↔reais) — implementadas em sub-tasks **sem**
> asterisco (bloqueiam merge). As demais (CP-4..CP-10) são property tests complementares, marcadas com
> `*` (opcionais). Convenção do projeto: CPs obrigatórios nunca levam `*`; opcionais sempre levam `*`.

## Tasks

- [ ] 1. Migration 045: tabela, RPCs, seeds e rollback
  - [ ] 1.1 Criar `supabase/migrations/045_admin_settings.sql` (scaffold idempotente)
    - Cabeçalho com objetivo do módulo e dependências (migrations 030 admin-foundation, 042b vault).
    - Envolver tudo em `BEGIN; ... COMMIT;`.
    - Bloco `DO $check$ ... $check$` defensivo validando que `is_admin_with_permission(text)` e
      `admin_audit_logs` existem (e que a extensão `supabase_vault` está habilitada), levantando
      `EXCEPTION` clara quando ausentes.
    - _Requirements: 11.1, 11.2, 11.4_

  - [ ] 1.2 Criar tabela `platform_settings` (chave-valor tipado por categoria)
    - Colunas conforme design §Data Models: `id`, `category` (CHECK domínio fechado
      `integrations/trial/plans/ai/general`), `key`, `value_type` (CHECK
      `string/integer/money/boolean/secret/enum`), `value jsonb NULL`, `enum_options jsonb NULL`,
      `is_readonly`, `is_secret`, `secret_is_set`, `secret_last4` (CHECK `<= 4` chars),
      `vault_secret_name`, `label`, `updated_at`, `updated_by` (FK `users(id) ON DELETE SET NULL`).
    - 3 CHECK de coerência: `chk_platform_settings_value_type` (segredo ⇒ `value IS NULL`; tipo↔jsonb),
      `chk_platform_settings_enum_options` (enum ⇒ array; não-enum ⇒ NULL),
      `chk_platform_settings_secret_flag` (secret ⇔ `is_secret`).
    - `UNIQUE (category, key)`; `CREATE INDEX IF NOT EXISTS idx_platform_settings_category`.
    - `ENABLE ROW LEVEL SECURITY` + policy `platform_settings_no_dml` `FOR ALL USING (false) WITH CHECK (false)`
      (toda interação via RPC `SECURITY DEFINER`; `DROP POLICY IF EXISTS` antes de `CREATE POLICY`).
    - `COMMENT ON TABLE`/colunas críticas (`value`, `secret_last4`, `vault_secret_name`).
    - Tabela genérica: nova `Setting_Key` é só `INSERT` semente, sem `ALTER TABLE`.
    - _Requirements: 5.6, 8.4_

  - [ ] 1.3 RPC `admin_settings_get()` `STABLE SECURITY DEFINER`
    - `auth.uid()` check ⇒ `permission_denied` (42501) se NULL.
    - Gating `is_admin_with_permission('SETTINGS_VIEW')`; no path negativo INSERT `SETTINGS_VIEW_DENIED`
      em `admin_audit_logs` (`before=NULL`, `after={user_id, reason}`) + `RAISE permission_denied`.
    - `SELECT category,key,value_type, CASE WHEN value_type='secret' THEN NULL ELSE value END AS value,
      enum_options, is_readonly, is_secret, secret_is_set,
      CASE WHEN secret_is_set THEN '••••••••'||secret_last4 ELSE NULL END AS masked_value, label,
      updated_at, updated_by FROM platform_settings ORDER BY category, key` agregado em `jsonb`.
    - Segredo **nunca** inclui valor bruto (coluna `value` já é NULL por construção).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 1.4 RPC `admin_settings_update(p_key text, p_value jsonb, p_expected_updated_at timestamptz)` `SECURITY DEFINER`
    - `auth.uid()` + gating `SETTINGS_EDIT` (`SETTINGS_VIEW_DENIED` + `permission_denied` no negativo).
    - Pré-fetch `value_type, is_readonly, enum_options, updated_at`. Erros tipados via
      `RAISE EXCEPTION ... USING ERRCODE='P0001'`: key inexistente ⇒ `SETTING_NOT_FOUND`;
      `value_type='secret'` ⇒ `INVALID_VALUE`; `is_readonly` ⇒ `READONLY_SETTING`;
      `jsonb_typeof(p_value)` incompatível com o tipo ⇒ `INVALID_VALUE`; enum fora do domínio ⇒
      `INVALID_VALUE`; ranges por key (`trial_duration_days` 1..365; `money` 0..1000000) ⇒ `INVALID_VALUE`.
    - `UPDATE ... SET value=p_value, updated_at=NOW(), updated_by=auth.uid()
      WHERE key=p_key AND updated_at=p_expected_updated_at`; `ROW_COUNT=0` (com key existente) ⇒
      `STALE_VERSION`. Retorna `{ ok:true, updated_at }`.
    - _Requirements: 3.4, 3.6, 3.8, 3.9, 5.5, 6.2, 7.2, 9.4, 10.1, 10.2, 10.3, 10.4_

  - [ ] 1.5 RPC `admin_settings_secret_set(p_key text, p_secret text, p_expected_updated_at timestamptz)` `SECURITY DEFINER`
    - `auth.uid()` + gating `SETTINGS_EDIT`. Key deve existir com `value_type='secret'` (senão `INVALID_VALUE`).
    - Versionamento otimista vs `updated_at`.
    - `vault.create_secret(p_secret, vault_secret_name, ...)` na 1ª vez ou `vault.update_secret(id, p_secret)`
      em substituição (resolve `id` por `name`; nome estável `platform_setting:<category>:<key>`).
    - `UPDATE SET secret_is_set=true, secret_last4=right(p_secret,4), value=NULL, updated_at=NOW(),
      updated_by=auth.uid()`. Retorna `{ ok:true, is_set:true, masked_value:'••••••••'||right(p_secret,4), updated_at }`.
    - Bruto vive **apenas** no Vault; coluna `value` permanece NULL.
    - _Requirements: 4.1, 4.2, 5.2_

  - [ ] 1.6 RPC `admin_settings_secret_clear(p_key text, p_expected_updated_at timestamptz)` `SECURITY DEFINER` (idempotente)
    - `auth.uid()` + gating `SETTINGS_EDIT`.
    - `secret_is_set=false` ⇒ INSERT `SETTINGS_SECRET_CLEARED_SKIPPED` **dentro da RPC** +
      `RETURN { skipped:true, reason:'ALREADY_CLEARED' }` (não muta).
    - `secret_is_set=true` ⇒ versionamento otimista; `vault.delete_secret(vault_secret_name)`;
      `UPDATE SET secret_is_set=false, secret_last4=NULL, updated_at=NOW(), updated_by=auth.uid()`;
      INSERT `SETTINGS_SECRET_CLEARED`; `RETURN { ok:true, is_set:false, updated_at }`.
    - _Requirements: 4.4_

  - [ ] 1.7 RPC `app_get_setting_secret(p_key text)` `SECURITY DEFINER` (server-only)
    - `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = vault_secret_name(p_key)`.
    - `REVOKE ALL FROM PUBLIC` e **sem** `GRANT EXECUTE TO authenticated` — reservada a
      processos server-side de integração futuros; nenhum fluxo do painel a invoca.
    - _Requirements: 4.8_

  - [ ] 1.8 Seeds idempotentes `INSERT ... ON CONFLICT (category, key) DO NOTHING`
    - `trial/trial_duration_days` integer `30`; `plans/plan_price_mensal` money `3900`;
      `plans/plan_price_trimestral` money `8700`; `plans/plan_price_semestral` money `15000`.
    - `integrations/evolution_api_base_url` string `''`; `integrations/evolution_api_key` secret `NULL`
      (`is_secret=true`, `vault_secret_name` definido); `integrations/evolution_instance_name` string `''`;
      `integrations/evolution_connection_status` enum `'disconnected'` (`is_readonly=true`,
      `enum_options=['disconnected','connecting','connected','error']`).
    - `general/support_contact_email` string `''`; `general/support_contact_phone` string `''`.
    - Categoria `ai` reservada **sem** seeds (seção sempre exibida, possivelmente vazia).
    - Não sobrescreve valores já existentes em reexecução.
    - _Requirements: 5.1, 5.2, 5.5, 6.1, 7.1, 8.1, 9.1, 11.5_

  - [ ] 1.9 Posture de segurança das RPCs + bloco `-- VERIFY`
    - Para cada RPC (1.3–1.6): `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`.
      Para `app_get_setting_secret` (1.7): `REVOKE ALL FROM PUBLIC` sem GRANT a `authenticated`.
    - Bloco `-- VERIFY` comentado (`/* ... */`) com SELECTs de smoke: contagem de seeds por categoria,
      checagem de `secret_is_set`/`secret_last4`, confirmação de que `value` é NULL para secrets.
    - _Requirements: 11.6, 11.8_

  - [ ] 1.10 Criar `supabase/migrations/045_admin_settings_rollback.sql`
    - DROP reverso documentado: RPCs, policy, índice e tabela `platform_settings` (ordem reversa de
      dependência). Comentário avisando que segredos no Vault devem ser removidos manualmente.
    - **Não** auto-aplicado; serve como referência.
    - _Requirements: 11.7_

  - [ ]* 1.11 Script de idempotência da migration
    - `supabase/migrations/_test_idempotency_045.sql` que aplica `045_admin_settings.sql` 2× e valida
      que a 2ª execução não falha e não duplica/sobrescreve seeds.
    - _Requirements: 11.3, 11.5_

- [ ] 2. Service: tipos públicos, helpers puros e property tests puros
  - [ ] 2.1 Criar `src/services/admin/settings.ts` — tipos públicos
    - Domínios fechados: `SettingCategory`, `SettingValueType`, `EVOLUTION_CONNECTION_STATUSES` +
      `EvolutionConnectionStatus`.
    - `SettingValue`, `SettingRecord`, `SettingsByCategory`.
    - Payloads: `UpdateSettingPayload`, `SetSecretPayload`, `ClearSecretPayload`.
    - Resultados: `MutationOk`, `SecretSetOk`, `SecretClearOk`, `SkippedClear`, `ClearSecretResult`.
    - Erros: `SettingsErrorCode`, classe `SettingsServiceError`, tabela `SETTINGS_ERROR_MESSAGES` (pt-BR).
    - _Requirements: 2.2_

  - [ ] 2.2 Helpers puros (testáveis isoladamente)
    - `reaisToCents(reais: string | number): number` e `centsToReais(cents: number): string` (2 casas).
    - `maskSecret(raw: string): string` — mantém últimos 4 chars, prefixa bullets `•`.
    - `validateSettingValue(valueType, value, opts?)` — espelho da RPC: `string`⇒string; `integer`⇒inteiro;
      `money`⇒inteiro 0..1000000; `boolean`⇒boolean; `enum`⇒∈`enumOptions`; range por key
      (`trial_duration_days` 1..365); retorna `{ok:true} | {ok:false, code}`.
    - `validateEvolutionBaseUrl(url): boolean` — URL absoluta com esquema exatamente `https`.
    - `validateEmail(email): boolean` — e-mail válido **ou** string vazia.
    - `groupByCategory(records): SettingsByCategory` — todas as 5 categorias presentes; categoria sem
      registro ⇒ lista vazia; cada registro exatamente 1×.
    - `decideSecretAction(input)` — resolve `set | clear | preserve` (campo em branco sem remoção ⇒ `preserve`).
    - _Requirements: 1.7, 4.2, 4.7, 5.3, 6.2, 7.2, 7.4, 9.2, 10.1, 10.2, 10.3_

  - [ ] 2.3 Normalizador de erros `toSettingsError(err): SettingsServiceError`
    - Mapeia `42501`/`permission_denied` ⇒ `PERMISSION_DENIED`; discrimina por prefixo textual
      `STALE_VERSION`/`SETTING_NOT_FOUND`/`INVALID_VALUE`/`READONLY_SETTING`; `network`/`fetch` ⇒
      `NETWORK_ERROR`; fallback `UNKNOWN`. Nunca inclui valor bruto de segredo.
    - _Requirements: 3.7, 10.5_

  - [ ] 2.4 Property test CP-2 (validação por tipo/enum/intervalo/somente leitura)
    - `src/__tests__/admin/settings/validateSettingValue.property.test.ts`.
    - **Property 2: Validação por tipo, enum, intervalo e somente leitura**
    - Geradores: `fc.constantFrom(value_types)` × `fc.oneof(string/integer/double/boolean/...)`,
      `enum_options`, key `trial_duration_days`. Aceita ⇔ coerente; senão `INVALID_VALUE`; readonly ⇒ `READONLY_SETTING`.
    - **Validates: Requirements 5.5, 6.2, 7.2, 9.4, 10.1, 10.2, 10.3, 10.5**

  - [ ] 2.5 Property test CP-3 (round-trip centavos↔reais)
    - `src/__tests__/admin/settings/moneyRoundtrip.property.test.ts`.
    - **Property 3: Round-trip centavos↔reais**
    - Gerador `fc.integer({min:0,max:1000000})`: `reaisToCents(centsToReais(c)) === c` e `centsToReais(c)`
      sempre com 2 casas decimais.
    - **Validates: Requirements 7.1, 7.4**

  - [ ]* 2.6 Property test CP-6 (URL https da Evolution API)
    - `src/__tests__/admin/settings/validateUrl.property.test.ts`.
    - **Property 6: Validação de URL base da Evolution API**
    - Geradores: `fc.constantFrom([...https válidas])`, http, relativas, lixo. Verdadeiro ⇔ URL absoluta `https`.
    - **Validates: Requirements 5.3**

  - [ ]* 2.7 Property test CP-7 (e-mail válido ou vazio)
    - `src/__tests__/admin/settings/validateEmail.property.test.ts`.
    - **Property 7: Validação de e-mail de contato (válido ou vazio)**
    - Geradores: `fc.constantFrom([...e-mails válidos])`, inválidos, `''`. Verdadeiro ⇔ vazio ou formato válido.
    - **Validates: Requirements 9.2**

  - [ ]* 2.8 Property test CP-9 (agrupamento por categoria sem perda)
    - `src/__tests__/admin/settings/groupByCategory.property.test.ts`.
    - **Property 9: Agrupamento por categoria sem perda**
    - Gerador `fc.array` de `SettingRecord` com category de `fc.constantFrom`. Cada registro 1× na sua
      categoria; 5 categorias sempre presentes; categoria vazia ⇒ lista vazia válida.
    - **Validates: Requirements 1.7, 8.3**

- [ ] 3. Service: wrappers de leitura/mutação e property tests do service
  - [ ] 3.1 `getSettings(): Promise<SettingsByCategory>`
    - Wrapper RPC `admin_settings_get`; normaliza erros via `toSettingsError`.
    - Agrupa por categoria via `groupByCategory`; degradação parcial por categoria com
      `Promise.allSettled` (falha isolada não derruba as demais).
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

  - [ ] 3.2 `updateSetting(payload): Promise<MutationOk>`
    - Pré-validação client via `validateSettingValue` (autoridade = servidor).
    - `executeAdminMutation` com `action='SETTINGS_UPDATED'`, `targetType='platform_settings'`,
      `targetId=key`, `before/after` snapshot (sem brutos). Wrapper RPC `admin_settings_update`
      (`p_key`, `p_value`, `p_expected_updated_at`). Propaga `STALE_VERSION`/`INVALID_VALUE`/`SETTING_NOT_FOUND`.
    - _Requirements: 3.2, 3.3, 3.4, 9.5, 10.5_

  - [ ] 3.3 `setSecret(payload): Promise<SecretSetOk>`
    - `executeAdminMutation` com `action='SETTINGS_SECRET_UPDATED'`, registrando **apenas** metadados
      `{ is_set, last4 }` em `before`/`after` (nunca o bruto). Wrapper RPC `admin_settings_secret_set`.
    - Retorna `masked_value` + `updated_at`.
    - _Requirements: 4.1, 4.3, 5.2_

  - [ ] 3.4 `clearSecret(payload): Promise<ClearSecretResult>`
    - Wrapper RPC `admin_settings_secret_clear` (audit gravado **dentro** da RPC). Idempotente:
      já-removido ⇒ `{ skipped:true, reason:'ALREADY_CLEARED' }` (não lança). Campo em branco sem
      remoção resolve para `preserve` via `decideSecretAction` (nenhuma escrita no Vault, nenhum audit).
    - _Requirements: 4.4, 4.7_

  - [ ] 3.5 Property test CP-1 (segredo nunca vaza ao cliente / masking)
    - `src/__tests__/admin/settings/secretMasking.property.test.ts`. Mock de `supabase.rpc` exposto via
      `(globalThis as Record<string, unknown>).__rpcSpy` (factory hoisted-safe).
    - **Property 1: Segredo nunca vaza ao cliente (masking)**
    - Para qualquer bruto não vazio: `SettingRecord.value === null`; `masked_value` termina exatamente
      nos últimos 4 chars (demais ⇒ `•`); `is_set=false` ⇒ `masked_value=null`. Audit de
      `SETTINGS_SECRET_UPDATED` capturado contém só `is_set` + `last4`, sem o bruto.
    - **Validates: Requirements 2.3, 3.3, 4.1, 4.2, 4.3, 4.8**

  - [ ]* 3.6 Property test CP-4 (versionamento otimista + chave inexistente)
    - `src/__tests__/admin/settings/optimisticVersion.property.test.ts` (RPC mockada como modelo do store).
    - **Property 4: Versionamento otimista e chave inexistente**
    - `expected_updated_at` igual ⇒ aplica e avança `updated_at`; diferente ⇒ `STALE_VERSION` sem mutar;
      key ausente ⇒ `SETTING_NOT_FOUND` sem criar registro.
    - **Validates: Requirements 3.4, 3.6, 10.4**

  - [ ]* 3.7 Property test CP-5 (idempotência da remoção + preservação em branco)
    - `src/__tests__/admin/settings/secretClear.property.test.ts` (RPC mockada + `decideSecretAction`).
    - **Property 5: Idempotência da remoção de segredo e preservação de campo em branco**
    - 1ª `clearSecret` em `is_set=true` ⇒ transita para falso + `SETTINGS_SECRET_CLEARED`; subsequentes ⇒
      `{ skipped:true, reason:'ALREADY_CLEARED' }` sem duplicar audit de mutação; salvamento não-remoção
      com campo em branco ⇒ `preserve`.
    - **Validates: Requirements 4.4, 4.7**

  - [ ]* 3.8 Property test CP-8 (contrato de auditoria de atualização não-secreta)
    - `src/__tests__/admin/settings/auditContract.property.test.ts` (captura `LogAdminActionInput`).
    - **Property 8: Contrato de auditoria de atualização não-secreta**
    - Toda atualização não-secreta (incl. toggles `boolean`): `action='SETTINGS_UPDATED'`,
      `targetType='platform_settings'`, `targetId=key`.
    - **Validates: Requirements 3.2, 9.5**

  - [ ]* 3.9 Property test CP-10 (degradação parcial por categoria)
    - `src/__tests__/admin/settings/partialDegradation.property.test.ts` (combinador `Promise.allSettled` → estado de UI).
    - **Property 10: Degradação parcial por categoria**
    - Mapa categoria→`fc.boolean()` (ok/falha): marca como erro **exatamente** as categorias com falha;
      falha de uma nunca propaga às demais.
    - **Validates: Requirements 2.7**

- [ ] 4. Checkpoint — service e banco
  - Garantir que todos os testes passam (`npx tsc --noEmit`, `npx vitest --run` com CP-1/CP-2/CP-3
    verdes). Em caso de dúvida, perguntar ao usuário.

- [ ] 5. Componentes da UI de configurações
  - [ ] 5.1 `SettingsBlockSkeleton.tsx` + `SettingsBlockError.tsx`
    - Skeleton: bloco `animate-pulse` com `aria-busy="true"` + `aria-live="polite"`.
    - Error: mensagem (default `Categoria indisponível.`) + botão `Tentar novamente` (`onRetry`).
    - Diretório `src/components/admin/settings/`.
    - _Requirements: 2.7, 12.3_

  - [ ] 5.2 `SettingField.tsx`
    - Render por `value_type`: `string`/`integer`/`money`/`boolean`/`enum`. `money` exibido/editado em
      R$ com 2 casas (via `centsToReais`/`reaisToCents`). `enum`/`is_readonly` renderizados desabilitados.
    - Validação inline client via `validateSettingValue` + `validateEvolutionBaseUrl`/`validateEmail`:
      valor inválido ⇒ erro inline + botão `Salvar` desabilitado.
    - Captura `updated_at` vigente e o reenvia no salvamento. Label via `htmlFor`/`aria-label`.
    - _Requirements: 5.4, 5.5, 6.3, 7.3, 7.4, 9.3, 10.5, 12.1, 12.4_

  - [ ] 5.3 `SecretField.tsx`
    - `is_set=false` ⇒ campo vazio com rótulo `Não configurado`. `is_set=true` ⇒ exibe `masked_value`
      + controles `Substituir`/`Remover`. Salvamento com campo em branco (sem remoção) preserva.
    - `aria-label` descritivo em botões só-ícone.
    - _Requirements: 4.5, 4.6, 12.4_

  - [ ] 5.4 `SettingsCategorySection.tsx`
    - Agrupa e renderiza os campos de uma categoria com título identificável (Integrações/Trial/Planos/IA/Geral).
    - Aviso informativo em `integrations` (Evolution API ainda não ativa — valores só armazenados) e em
      `ai` (configurações serão detalhadas em entrega futura). Estado vazio em `ai` sem erro.
    - Integra `SettingsBlockSkeleton` (carregando) e `SettingsBlockError` (falha isolada da categoria).
    - _Requirements: 1.7, 5.7, 8.2, 8.3_

  - [ ]* 5.5 Testes unitários `SettingField`
    - Render de cada `value_type`; erro inline + `Salvar` desabilitado em valor inválido; preços em R$
      com 2 casas; campo `readonly` desabilitado.
    - _Requirements: 5.4, 5.5, 6.3, 7.3, 7.4, 9.3_

  - [ ]* 5.6 Testes unitários `SecretField`
    - `is_set=false` ⇒ `Não configurado`; `is_set=true` ⇒ máscara + `Substituir`/`Remover`;
      `aria-label` em botões só-ícone.
    - _Requirements: 4.5, 4.6, 12.4_

- [ ] 6. Página `/admin/settings`, rota e sidebar
  - [ ] 6.1 `src/pages/admin/settings/SettingsPage.tsx`
    - Gating UI: `useAdminPermission('SETTINGS_VIEW')` negado ⇒ `Stealth_404`. `canEdit =
      useAdminPermission('SETTINGS_EDIT').allowed` controla visibilidade dos controles de edição/`Salvar`
      (modo somente leitura sem `SETTINGS_EDIT`).
    - Sem `<h1>` grande (padrão compacto). Compõe as 5 `SettingsCategorySection` via `getSettings`
      (degradação parcial por seção). Coluna única em `<768px`.
    - Fluxos de salvamento: sucesso ⇒ toast `Configuração salva.` (`role="status"`) + refetch do valor;
      `STALE_VERSION` ⇒ toast `Outro admin atualizou. Recarregando.` + refetch; erros via toast
      `role="alert"`. Abertura de edição lê `updated_at` vigente e o reenvia.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 2.7, 3.1, 3.5, 3.7, 3.10, 5.7, 8.2, 8.3, 12.1, 12.2, 12.3_

  - [ ] 6.2 Registrar rota em `src/components/admin/AdminLayoutRoute.tsx`
    - Adicionar rota filha `settings` dentro do bloco `<AdminGuard><AdminShell>...`, gated por
      `SETTINGS_VIEW`, renderizando `SettingsPage`. Importar a página.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 6.3 Confirmar item Configurações em `src/components/admin/AdminSidebar.tsx`
    - Verificar que o item Configurações aponta para `/admin/settings` com `permission: 'SETTINGS_VIEW'`;
      ajustar se divergente.
    - _Requirements: 1.6_

  - [ ]* 6.4 Testes unitários `SettingsPage`
    - Ausência de `<h1>` grande; seção IA sempre presente com aviso mesmo vazia; aviso Evolution API;
      captura/reenvio de `updated_at`; toasts canônicos com `role` `status`/`alert`; labels associados;
      presença de `trial_duration_days` e dos 3 preços na leitura.
    - _Requirements: 1.5, 3.5, 3.7, 3.10, 5.7, 6.4, 7.5, 8.2, 8.3, 12.1, 12.3_

  - [ ]* 6.5 Testes de gating de rota por papel
    - `src/__tests__/admin/settings/routing.test.tsx`: para cada `AdminRole`, montar `/admin/settings`
      e asserir `SettingsPage` quando `hasPermission(role,'SETTINGS_VIEW')`, senão `Stealth_404`; `canEdit`
      ⇔ `hasPermission(role,'SETTINGS_EDIT')` (usa a `Permission_Matrix` real, sem mock).
    - _Requirements: 1.2, 1.3, 1.4, 3.1_

- [ ] 7. Testes de integração e smoke/config
  - [ ]* 7.1 Integração — gating server-side das RPCs
    - Gated por env var (`RUN_SUPABASE_INTEGRATION=1`), Postgres local. Caller autorizado vs negado em
      `admin_settings_get`/`admin_settings_update`: retorno vs `RAISE permission_denied`; gravação de
      `SETTINGS_VIEW_DENIED` (`before=NULL`, `after={user_id, reason}`) no negativo; caller anônimo
      (`auth.uid()` NULL) ⇒ `permission_denied`.
    - _Requirements: 2.4, 2.5, 2.6, 3.8, 3.9_

  - [ ]* 7.2 Integração — segredo no Vault + masking + função server-only
    - `admin_settings_secret_set` grava no Vault e mantém `value` NULL; `admin_settings_get` retorna só
      máscara; `app_get_setting_secret` **não** é concedida a `authenticated`.
    - _Requirements: 4.1, 4.8_

  - [ ]* 7.3 Integração — idempotência de remoção de segredo (nível SQL)
    - `admin_settings_secret_clear` chamado 2× ⇒ 1º `SETTINGS_SECRET_CLEARED`, 2º
      `SETTINGS_SECRET_CLEARED_SKIPPED`.
    - _Requirements: 4.4_

  - [ ]* 7.4 Smoke/config — assertivas sobre a migration 045
    - Teste automatizado que lê `045_admin_settings.sql` e valida: nome do arquivo; envelope
      `BEGIN; ... COMMIT;`; presença de `DO $check$`; bloco `-- VERIFY` comentado; existência de
      `045_admin_settings_rollback.sql`; cada RPC com `SECURITY DEFINER` + `SET search_path = public` +
      `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` (exceto `app_get_setting_secret`);
      seeds presentes (`trial_duration_days=30`, preços `3900/8700/15000`, 4 chaves Evolution, 2 de
      contato); `'ai'` como categoria válida no CHECK sem seeds. Inclui aplicar a migration 2× em
      Postgres local sem falha/duplicação (idempotência).
    - _Requirements: 1.6, 5.1, 5.2, 5.6, 6.1, 7.1, 8.1, 8.4, 9.1, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [ ] 8. Checkpoint final
  - Garantir que todos os testes passam: `npx tsc --noEmit` sem erros, `npm run build` limpo,
    `npx vitest --run` com as suítes verdes (obrigatórias CP-1/CP-2/CP-3; opcionais skipadas se não
    implementadas). Em caso de dúvida, perguntar ao usuário.

## Notes

- Sub-tasks marcadas com `*` são opcionais (property tests complementares CP-4..CP-10, testes
  unitários de componente/página, gating de rota, integração SQL, smoke/config e scripts auxiliares).
  O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Sub-tasks **2.4 (CP-2)**, **2.5 (CP-3)** e **3.5 (CP-1)** **NÃO** levam asterisco — são as propriedades
  obrigatórias do `design.md` e bloqueiam merge.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N), os requisitos que ela
  valida, e é tagueado `Feature: admin-settings, Property {n}` (≥ 100 iterações).
- Padrões herdados sem modificação (ver `admin-patterns.md`): audit-by-construction via
  `executeAdminMutation`, RBAC server-side via `is_admin_with_permission`, versionamento otimista,
  idempotência `_SKIPPED` dentro da RPC, `Stealth_404`, degradação parcial em fetch agregado, padrão
  compacto pós-cleanup. Vault reusado da migration 042b.
- **Permission_Matrix não muda** — `SETTINGS_VIEW`/`SETTINGS_EDIT` já existem desde a migration 030.
  Reqs 12.2 e 12.5 (responsividade `<768px` em coluna única e contraste WCAG AA) são cobertos pela
  estrutura da `SettingsPage`/`SettingsCategorySection`; a verificação final é visual/manual e não vira
  task de código.
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e
  clique em "Start task" ao lado de cada item.

## Task Dependency Graph

Ordem topológica por ondas para escalonamento paralelo. Tasks na mesma onda escrevem em **arquivos
distintos** e podem rodar em paralelo; ondas posteriores só iniciam após as anteriores concluírem.
Dois "long poles" sequenciais (cada um construindo um único arquivo de forma incremental) rodam **em
paralelo entre si** por serem arquivos diferentes:
- **Migration** `supabase/migrations/045_admin_settings.sql` — 1.1→1.9 (uma sub-task por onda, pois
  todas editam o mesmo arquivo).
- **Service** `src/services/admin/settings.ts` — 2.1→2.2/2.3→3.1→3.2→3.3→3.4 (idem, mesmo arquivo).

Cada property/unit test e cada componente vive em arquivo próprio, então paralelizam livremente nas
ondas em que suas dependências já existem. Tasks de checkpoint (epics 4 e 8, sem decimal) não entram
no grafo.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3"] },
    { "id": 3, "tasks": ["1.4", "2.4", "2.5", "2.6", "2.7", "2.8"] },
    { "id": 4, "tasks": ["1.5", "3.1"] },
    { "id": 5, "tasks": ["1.6", "3.2"] },
    { "id": 6, "tasks": ["1.7", "3.3"] },
    { "id": 7, "tasks": ["1.8", "3.4"] },
    { "id": 8, "tasks": ["1.9", "3.5", "3.6", "3.7", "3.8", "3.9"] },
    { "id": 9, "tasks": ["1.10", "1.11", "5.1"] },
    { "id": 10, "tasks": ["5.2", "5.3"] },
    { "id": 11, "tasks": ["5.4", "5.5", "5.6"] },
    { "id": 12, "tasks": ["6.1"] },
    { "id": 13, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 14, "tasks": ["6.5", "7.1", "7.2", "7.3", "7.4"] }
  ]
}
```

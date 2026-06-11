# Design Técnico — finalizacao-lancamento

## Overview

Esta spec leva o FreteGO ao estado **"pronto para lançar"** entregando o que a
auditoria do código confirmou estar faltando. O design respeita as três regras
de steering (`project-conventions.md`, `admin-patterns.md`,
`testing-governance.md`) e a regra-mãe do dono: **mudanças aditivas, foco
pesado em testes, não quebrar nada do que já funciona**.

O documento está dividido conforme as áreas dos requisitos:

1. **Admin Settings** — maior entrega (módulo novo `/admin/settings`).
2. **Reforço de testes** — harness, integração, segurança, E2E, performance, CI.
3. **Testes opcionais de robustez** — property tests complementares.
4. **Polimentos** — cards mobile admin + docs.
5. **Validação pré-lançamento** — manual/runtime (não código).
6. **Não-regressão** — garantia transversal.

### Princípio de não-regressão (transversal)

Cada entrega declara explicitamente se é **ARQUIVO NOVO** ou **ARQUIVO
EXISTENTE TOCADO**. A tabela-resumo na seção final lista tudo. Antecipando:

- **Tudo em Admin Settings é arquivo novo** — a rota `/admin/settings` hoje cai
  em `Stealth_404`; não há código para quebrar.
- **Tudo em testes é arquivo novo** — testes observam, não alteram o app.
- **Migration 084 é puramente aditiva** — só cria tabela/RPCs novas; não toca
  tabela existente.
- **Único código de produção existente tocado:** `AdminTicketsPage.tsx` e
  `AdminBroadcastPage.tsx` (layout mobile aditivo, desktop inalterado).

---

## Area 1 — Admin Settings

## Architecture

Módulo admin clássico do FreteGO, em 4 camadas, reusando 100% dos padrões
existentes (audit-by-construction, RBAC server-side, versionamento otimista,
Stealth_404, Vault):

```
┌─────────────────────────────────────────────────────────────┐
│ UI (React)                                                    │
│  SettingsPage  ──▶ SettingsCategorySection ──▶ SettingField   │
│       │                                    └──▶ SecretField   │
│       │            SettingsBlockSkeleton / SettingsBlockError │
│       │            (useAdminPermission: SETTINGS_VIEW/EDIT)   │
└───────┼───────────────────────────────────────────────────────┘
        │ chama
┌───────▼───────────────────────────────────────────────────────┐
│ Service (src/services/admin/settings.ts)                       │
│  helpers puros: validateSettingValue, maskSecret,              │
│    reaisToCents, centsToReais, validateEvolutionBaseUrl,       │
│    validateEmail, groupByCategory, decideSecretAction          │
│  wrappers: getSettings, updateSetting (executeAdminMutation),  │
│    setSecret, clearSecret                                      │
└───────┼───────────────────────────────────────────────────────┘
        │ supabase.rpc(...)
┌───────▼───────────────────────────────────────────────────────┐
│ Banco (migration 084_admin_settings.sql)                       │
│  tabela platform_settings (RLS no-DML)                         │
│  RPCs SECURITY DEFINER: admin_settings_get / _update /         │
│    _secret_set / _secret_clear / app_get_setting_secret        │
│  Vault (supabase_vault) para segredos                          │
└────────────────────────────────────────────────────────────────┘
```

## Data Models

### Tabela `platform_settings`

Tabela genérica chave-valor tipada por categoria. Adicionar uma nova
configuração é só um `INSERT` de seed — **sem `ALTER TABLE`**.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `uuid PK default gen_random_uuid()` | identidade |
| `category` | `text NOT NULL` | CHECK domínio fechado `integrations/trial/plans/ai/general` |
| `key` | `text NOT NULL` | Setting_Key estável (inglês, snake_case) |
| `value_type` | `text NOT NULL` | CHECK `string/integer/money/boolean/secret/enum` |
| `value` | `jsonb NULL` | valor atual (NULL para secret — vive no Vault) |
| `enum_options` | `jsonb NULL` | array de opções quando `value_type='enum'` |
| `is_readonly` | `boolean NOT NULL default false` | bloqueia edição no painel |
| `is_secret` | `boolean NOT NULL default false` | é Secret_Setting |
| `secret_is_set` | `boolean NOT NULL default false` | há segredo gravado no Vault |
| `secret_last4` | `text NULL` | CHECK `char_length <= 4`; para masking |
| `vault_secret_name` | `text NULL` | nome estável do segredo no Vault |
| `label` | `text NOT NULL` | rótulo pt-BR exibido na UI |
| `updated_at` | `timestamptz NOT NULL default now()` | versionamento otimista |
| `updated_by` | `uuid NULL REFERENCES users(id) ON DELETE SET NULL` | autor |

**Constraints de coerência (CHECK):**
- `chk_value_type_coerence`: se `value_type='secret'` então `value IS NULL`.
- `chk_enum_options`: `value_type='enum'` ⇒ `enum_options` é array não-nulo;
  caso contrário `enum_options IS NULL`.
- `chk_secret_flag`: `is_secret = (value_type='secret')`.
- `UNIQUE (category, key)`.
- Índice `idx_platform_settings_category`.

**RLS:** `ENABLE ROW LEVEL SECURITY` + policy `platform_settings_no_dml`
`FOR ALL USING (false) WITH CHECK (false)`. Toda interação passa pelas RPCs
`SECURITY DEFINER` (nunca DML direto do cliente).

### RPCs (migration 084)

Todas `SECURITY DEFINER`, `SET search_path = public`, `auth.uid()` check,
`REVOKE ALL FROM PUBLIC`. As 4 primeiras `GRANT EXECUTE TO authenticated`; a
`app_get_setting_secret` **não** recebe grant a `authenticated` (server-only).

| RPC | Tipo | Gating | Retorno |
|---|---|---|---|
| `admin_settings_get()` | STABLE | `SETTINGS_VIEW` | jsonb agregado por categoria; secret retorna `masked_value` (`••••••••`+last4) e `value=NULL` |
| `admin_settings_update(p_key, p_value, p_expected_updated_at)` | VOLATILE | `SETTINGS_EDIT` | valida tipo/enum/range; versionamento otimista; `{ ok, updated_at }` |
| `admin_settings_secret_set(p_key, p_secret, p_expected_updated_at)` | VOLATILE | `SETTINGS_EDIT` | grava no Vault; `secret_is_set=true`, `secret_last4=right(p_secret,4)`; `{ ok, is_set, masked_value, updated_at }` |
| `admin_settings_secret_clear(p_key, p_expected_updated_at)` | VOLATILE | `SETTINGS_EDIT` | idempotente: já-limpo ⇒ `SETTINGS_SECRET_CLEARED_SKIPPED` + `{ skipped, reason:'ALREADY_CLEARED' }` |
| `app_get_setting_secret(p_key)` | STABLE, server-only | nenhum grant a authenticated | lê `vault.decrypted_secrets` (uso futuro de integração) |

**Erros tipados** (via `RAISE EXCEPTION ... USING ERRCODE`):
`permission_denied` (42501), `STALE_VERSION` (P0001), `SETTING_NOT_FOUND`,
`INVALID_VALUE`, `READONLY_SETTING`. Caminho negativo de gating grava
`SETTINGS_VIEW_DENIED` em `admin_audit_logs` (`before=NULL`,
`after={user_id, reason}`).

**Seeds idempotentes** (`INSERT ... ON CONFLICT (category,key) DO NOTHING`):
- `trial/trial_duration_days` integer `30`
- `plans/plan_price_mensal` money `3900`; `plan_price_trimestral` money `8700`;
  `plan_price_semestral` money `15000`
- `integrations/evolution_api_base_url` string `''`;
  `integrations/evolution_api_key` secret (is_secret, vault_secret_name);
  `integrations/evolution_instance_name` string `''`;
  `integrations/evolution_connection_status` enum `'disconnected'` readonly
  (options `disconnected/connecting/connected/error`)
- `general/support_contact_email` string `''`;
  `general/support_contact_phone` string `''`
- categoria `ai`: **sem seeds** (seção sempre exibida, possivelmente vazia)

## Components and Interfaces

### Service — `src/services/admin/settings.ts` (ARQUIVO NOVO)

**Tipos públicos:**
```ts
export type SettingCategory = 'integrations' | 'trial' | 'plans' | 'ai' | 'general';
export type SettingValueType = 'string' | 'integer' | 'money' | 'boolean' | 'secret' | 'enum';
export type EvolutionConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SettingRecord {
  key: string;
  category: SettingCategory;
  valueType: SettingValueType;
  value: string | number | boolean | null;   // null p/ secret
  enumOptions: string[] | null;
  isReadonly: boolean;
  isSecret: boolean;
  secretIsSet: boolean;
  maskedValue: string | null;                 // '••••••••3f9a' | null
  label: string;
  updatedAt: string;                          // ISO 8601 UTC
}
export type SettingsByCategory = Record<SettingCategory, SettingRecord[]>;

export type SettingsErrorCode =
  | 'PERMISSION_DENIED' | 'STALE_VERSION' | 'SETTING_NOT_FOUND'
  | 'INVALID_VALUE' | 'READONLY_SETTING' | 'NETWORK_ERROR' | 'UNKNOWN';
```

**Helpers puros (testáveis isoladamente, base dos property tests):**
- `reaisToCents(reais): number` / `centsToReais(cents): string` — round-trip CP-3.
- `maskSecret(raw): string` — últimos 4 chars; se `raw.length <= 4`, mascara
  tudo (não vaza). Base do CP-1.
- `validateSettingValue(valueType, value, opts?)` — espelho exato da validação
  da RPC: string/integer/money(0..1000000)/boolean/enum(∈options)/range por key
  (`trial_duration_days` 1..365). Base do CP-2.
- `validateEvolutionBaseUrl(url)` — URL absoluta esquema exatamente `https`.
- `validateEmail(email)` — e-mail válido **ou** string vazia.
- `groupByCategory(records)` — sempre as 5 categorias; vazia ⇒ lista vazia.
- `decideSecretAction(input)` → `'set' | 'clear' | 'preserve'` (campo em branco
  sem remoção ⇒ `preserve`).
- `toSettingsError(err)` — normaliza erro do Supabase para `SettingsErrorCode`.

**Wrappers (I/O):**
- `getSettings(): Promise<SettingsByCategory>` — RPC `admin_settings_get`;
  `groupByCategory`; degradação parcial com `Promise.allSettled`.
- `updateSetting(payload): Promise<{ updatedAt: string }>` — pré-valida no
  cliente; `executeAdminMutation('SETTINGS_UPDATED', 'platform_settings', key,
  before, after)`; RPC `admin_settings_update`.
- `setSecret(payload)` — `executeAdminMutation('SETTINGS_SECRET_UPDATED', ...)`
  com `before/after` = só `{ is_set, last4 }` (nunca bruto); RPC `_secret_set`.
- `clearSecret(payload)` — RPC `_secret_clear` (audit dentro da RPC);
  idempotente `{ skipped, reason:'ALREADY_CLEARED' }`.

### Componentes React (ARQUIVOS NOVOS, em `src/components/admin/settings/`)

- `SettingsBlockSkeleton.tsx` — `animate-pulse`, `aria-busy`.
- `SettingsBlockError.tsx` — mensagem + botão "Tentar novamente" (`onRetry`).
- `SettingField.tsx` — render por `value_type`; `money` em R$ 2 casas;
  `enum`/`readonly` desabilitados; validação inline + Salvar desabilitado se
  inválido; captura/reenvia `updated_at`.
- `SecretField.tsx` — `is_set=false` ⇒ "Não configurado"; `is_set=true` ⇒
  masked + Substituir/Remover; em branco sem remoção preserva.
- `SettingsCategorySection.tsx` — agrupa campos; aviso em `integrations`
  (Evolution API não ativa) e `ai` (em breve); integra skeleton/error.

### Página — `src/pages/admin/settings/SettingsPage.tsx` (ARQUIVO NOVO)

- Gating UI: `useAdminPermission('SETTINGS_VIEW')` negado ⇒ Stealth_404;
  `canEdit = useAdminPermission('SETTINGS_EDIT')` controla controles de edição.
- Sem `<h1>` grande (Compact_Layout_Pattern). 5 `SettingsCategorySection`.
  Coluna única `<768px`.
- Toasts canônicos: sucesso `Configuração salva.` (`role=status`);
  `STALE_VERSION` ⇒ `Outro admin atualizou. Recarregando.` + refetch; erro
  `role=alert`.

### Rota e sidebar (ARQUIVOS EXISTENTES TOCADOS — aditivo)

- `src/components/admin/AdminLayoutRoute.tsx` — adicionar rota filha `settings`
  gated por `SETTINGS_VIEW`, renderizando `SettingsPage`. **Aditivo**: nova rota,
  nenhuma rota existente alterada.
- `src/components/admin/AdminSidebar.tsx` — o item Configurações já aponta para
  `/admin/settings`; apenas confirmar `permission: 'SETTINGS_VIEW'`. Sem
  alteração de comportamento de outros itens.

## Correctness Properties

### Admin Settings

| ID | Propriedade | Obrigatória? | Arquivo de teste |
|---|---|---|---|
| **CP-1** | Segredo nunca vaza: `value===null` no retorno; `maskedValue` só mostra ≤4 chars; audit de segredo só `{is_set,last4}` | **SIM** | `secretMasking.property.test.ts` |
| **CP-2** | Validação por tipo/enum/range: aceita válidos, rejeita inválidos (`INVALID_VALUE`); readonly ⇒ `READONLY_SETTING` | **SIM** | `validateSettingValue.property.test.ts` |
| **CP-3** | Round-trip `reaisToCents(centsToReais(c))===c`; sempre 2 casas | **SIM** | `moneyRoundtrip.property.test.ts` |
| CP-4 | Versionamento otimista: `expected_updated_at` divergente ⇒ `STALE_VERSION` sem mutar; key ausente ⇒ `SETTING_NOT_FOUND` | opcional | `optimisticVersion.property.test.ts` |
| CP-5 | Idempotência de clear + preserve em branco | opcional | `secretClear.property.test.ts` |
| CP-6 | URL https Evolution | opcional | `validateUrl.property.test.ts` |
| CP-7 | E-mail válido ou vazio | opcional | `validateEmail.property.test.ts` |
| CP-8 | Contrato de auditoria de update não-secreto | opcional | `auditContract.property.test.ts` |
| CP-9 | Agrupamento por categoria sem perda | opcional | `groupByCategory.property.test.ts` |
| CP-10 | Degradação parcial por categoria | opcional | `partialDegradation.property.test.ts` |

Todos `numRuns >= 100`, tag `Feature: finalizacao-lancamento, Property {n}`,
convenções fast-check do projeto (sem `fc.stringOf`; `vi.mock` hoisted com
`globalThis.__spy`; PII via `fc.constantFrom`).

### Property 1: Segredo nunca vaza (masking) — obrigatória
Para qualquer valor bruto de Secret_Setting, o retorno de leitura tem
`value === null`, o `maskedValue` revela no máximo os últimos 4 caracteres (e
mascara tudo quando o bruto tem ≤4 chars), e o snapshot de auditoria contém
apenas `{ is_set, last4 }` — nunca o bruto.
**Validates: Requirements 2.3, 3.3, 4.1, 4.2, 4.3**

### Property 2: Validação por tipo/enum/intervalo — obrigatória
Para todo par (Setting_Value_Type, valor), `validateSettingValue` aceita se e
somente se o valor é coerente com o tipo (string/integer/money 0..1000000/
boolean/enum∈options/range por key como `trial_duration_days` 1..365); readonly
⇒ `READONLY_SETTING`. Mesmo veredito no cliente e no servidor.
**Validates: Requirements 5.5, 6.2, 7.2, 9.2, 10.1, 10.2, 10.3**

### Property 3: Round-trip centavos↔reais — obrigatória
Para todo inteiro de centavos `c` em 0..1000000,
`reaisToCents(centsToReais(c)) === c` e `centsToReais(c)` sempre tem 2 casas
decimais.
**Validates: Requirements 7.1, 7.4, 7.5**

### Property 4: Propriedades complementares — opcionais
Versionamento otimista (CP-4), idempotência de clear + preserve (CP-5), URL
https (CP-6), e-mail válido/vazio (CP-7), contrato de auditoria (CP-8),
agrupamento por categoria (CP-9), degradação parcial (CP-10). Marcadas `*` nas
tarefas; não bloqueiam o Launch_Readiness.
**Validates: Requirements 3.4, 3.6, 4.4, 4.7, 5.3, 9.2, 2.7**

---

## Error Handling

Erros seguem o padrão tipado do projeto (classe de erro + código + mensagem
pt-BR canônica), tanto no SQL quanto no service:

| Código | Origem | Mensagem pt-BR (user-facing) |
|---|---|---|
| `PERMISSION_DENIED` (42501) | RPC gating | `Você não tem permissão para acessar esta área.` |
| `STALE_VERSION` (P0001) | versionamento otimista | `Outro admin atualizou. Recarregando.` |
| `SETTING_NOT_FOUND` | key inexistente | `Configuração não encontrada.` |
| `INVALID_VALUE` | validação de tipo/range/enum | `Valor inválido para esta configuração.` |
| `READONLY_SETTING` | edição de campo readonly | `Esta configuração é somente leitura.` |
| `NETWORK_ERROR` | falha de rede | `Falha de conexão. Tente novamente.` |
| `UNKNOWN` | fallback | `Não foi possível concluir a operação.` |

- Caminho negativo de gating grava `SETTINGS_VIEW_DENIED` em `admin_audit_logs`.
- Segredos: erro nunca inclui valor bruto. Falha de audit logging **não**
  bloqueia a mutação (Property 9).
- Degradação parcial: falha de uma categoria na leitura não derruba as demais
  (`SettingsBlockError` apenas na categoria afetada).

---

## Area 2 — Reforço de testes (todos ARQUIVOS NOVOS)

### Fundação

- `src/__tests__/_helpers/auditAssertions.ts` (NOVO) — `expectAuditPersisted`
  (Property 8: aprova só com registro PERSISTIDO em `admin_audit_logs` com
  `action`/`target_type`/`target_id`), `expectMutationSucceedsDespiteAuditFailure`
  (Property 9), `expectViewDenied` (`<MODULE>_VIEW_DENIED`, `before=NULL`).
  Reusa os helpers canônicos existentes (`generators`, `authAssertions`,
  `antiEnumeration`, `logAssertions`) — não reimplementa.
- `tests/_helpers/supabaseHarness.ts` (NOVO) — `asUser`, `asAnon`, `asService`,
  `seedUser`, `cleanup` (IDs derivados do nome do teste; credenciais via env,
  nunca hardcoded). **Infra_Dependent**: execução verde exige branch Supabase
  efêmero + secrets no CI; a entrega é o código do harness.

### Testes de integração (`tests/integration/`, NOVOS — Infra_Dependent)

`auth`, `frete-lifecycle`, `chat`, `billing-webhooks`, `uploads`,
`lgpd-audit`, `jobs-external`. Cada um exercita o fluxo real e os erros
canônicos (anti-enumeração pt-BR, `STALE_VERSION`, RLS bloqueando vínculo
ausente, `WEBHOOK_SIGNATURE_INVALID` + idempotência, `INVALID_FILE_TYPE`,
audit persistido, retry/degradação).

### Segurança (`tests/security/`, NOVOS — Infra_Dependent)

- `rlsHarness.ts` + `rls-isolation.test.ts` — `expectNoCrossUserAccess`;
  Property 6 (isolamento por pares de usuários); Master Admin imutável.
- `injection-vectors.test.ts` — SQLi/XSS/CSRF; Property 10 (payload malicioso
  rejeitado sem efeito colateral).
- `rate-limit-bruteforce.test.ts` — 429, `Retry-After`, anti-enumeração.

> Já existem em `tests/security/`: `noSecretLeak`, `secretScan`, contratos em
> `tests/contract/`. Os novos são aditivos, não sobrescrevem.

### E2E e performance (NOVOS — Infra_Dependent)

- `tests/e2e/playwright.config.ts` — projetos `desktop-chromium` e
  `mobile-safari` (<768px), `retries:1` no CI. `fixtures/e2eFixtures.ts` +
  `expectInvalidFormBlocked` (bloqueio E mensagem pt-BR). Specs `auth.e2e`,
  `frete.e2e`, `devices-adverse.e2e`.
- `tests/performance/load.k6.js` + `thresholds.json` (p95 no limite,
  `http_req_failed < 1%`).

### Extensões de CI (`.github/workflows/` e `scripts/`, NOVOS/aditivos)

- `scripts/validate-migrations.ts` (NOVO) — numeração incremental sem buracos a
  partir de **084**, reconhecendo o salto histórico **045/046**; exige par
  `_rollback.sql`.
- `scripts/validate-env.ts` (NOVO) — confere variáveis de ambiente requeridas.
- `scripts/test-report.ts` (NOVO) — consolida `TestRunReport`.
- `.github/workflows/ci.yml` (TOCADO — aditivo) — adicionar jobs `migrations` e
  `env-check`; gates existentes inalterados.
- `.github/workflows/e2e.yml` e `performance.yml` (NOVOS).

---

## Área 3 — Testes opcionais de robustez (NOVOS, sufixo `*`)

Property tests para módulos **já implementados** (não alteram produção):
- security-hardening (12): FileValidatorAdvanced, inputLimits, CSRFTokenManager,
  antiEnumeration, SessionManager, jwtRevocation, BruteForceProtector,
  passwordValidation, rateLimiter, auditLogger, honeypot, urlSanitizer.
- embarcador-onboarding: verification, onboardingProgress, maskTarget.
- motorista-perfil-extras: souEuProprietario.
- schema-alignment-fixes: documentTypeValidation, registerRollback,
  chatErrorMapping.
- admin-financeiro: **apenas** CP-2 `markAsPaid` idempotente (única exceção do
  módulo de comissão aposentado).

Todos marcados `*` (opcionais) — não bloqueiam o Launch_Readiness.

---

## Área 4 — Polimentos

### Cards mobile (ARQUIVOS EXISTENTES TOCADOS — aditivo, único toque em produção)

- `AdminTicketsPage.tsx` e `AdminBroadcastPage.tsx` — adicionar render de cards
  single-column em `<768px`, preservando a tabela em `>=768px`. Padrão idêntico
  ao já usado em outras listagens admin. **Não-regressivo**: desktop inalterado.

### Documentação (ARQUIVOS TOCADOS — só docs)

- Atualizar ROADMAP e GUIA_TESTES_MANUAIS do notifications-hub. Sem código.

---

## Área 5 — Validação pré-lançamento (Manual_Validation — NÃO é código)

Listada nas tarefas como categoria separada e claramente marcada:
- Aplicar migration 084 + rodar bloco `-- VERIFY`; rollback documentado.
- Roteiro de smoke tests (Settings: ler/editar/secret/versão; e fluxos críticos
  cadastro/frete/chat/billing/uploads em ambiente real).

---

## Área 6 — Não-regressão (transversal)

- Todas as mudanças aditivas; contratos públicos existentes preservados.
- Após cada entrega de código: rodar suíte completa (`tsc --noEmit` +
  `vitest run` + `npm run build`) e confirmar verde antes de avançar.
- Numeração de migrations incremental a partir de 084 (salto 045/046 conhecido).
- Master Admin `Nexus_Vortex99` imutável em qualquer mutação tocada.

### Tabela-resumo: novo vs. tocado

| Item | Novo / Tocado | Risco de regressão |
|---|---|---|
| `084_admin_settings.sql` + rollback | NOVO | Nenhum (só cria) |
| `src/services/admin/settings.ts` | NOVO | Nenhum |
| Componentes `admin/settings/*` | NOVO | Nenhum |
| `SettingsPage.tsx` | NOVO | Nenhum |
| `AdminLayoutRoute.tsx` (rota settings) | TOCADO | Aditivo (rota nova) |
| `AdminSidebar.tsx` (confirmar permissão) | TOCADO | Nenhum (item já existe) |
| Property tests Settings (CP-1..CP-10) | NOVO | Nenhum (teste) |
| `auditAssertions.ts`, `supabaseHarness.ts` | NOVO | Nenhum (teste) |
| Testes integração/segurança/E2E/perf | NOVO | Nenhum (teste) |
| `scripts/validate-*.ts`, `test-report.ts` | NOVO | Nenhum |
| `ci.yml` (jobs migrations/env-check) | TOCADO | Aditivo (gates novos) |
| `e2e.yml`, `performance.yml` | NOVO | Nenhum |
| Property tests opcionais de robustez | NOVO | Nenhum (teste) |
| `AdminTicketsPage.tsx` / `AdminBroadcastPage.tsx` | **TOCADO** | Aditivo (layout mobile; desktop inalterado) |
| Docs notifications-hub | TOCADO | Nenhum (doc) |

**Conclusão:** o único código de produção existente com lógica alterada é o
layout mobile de duas páginas admin, de forma aditiva. Todo o resto é arquivo
novo ou adição que não altera comportamento existente.

---

## Testing Strategy

- **Unit + property (Fase 1, roda no pre-commit e CI):** helpers puros do
  Settings (CP-1/CP-2/CP-3 obrigatórios), property tests opcionais de robustez.
- **Integração/segurança/E2E/performance (Fase 2+, só CI, Infra_Dependent):**
  entregar código/config; execução verde depende de branch efêmero + secrets.
- **Não-regressão:** suíte completa verde após cada fase; `check-coverage.ts`
  mantém thresholds dos Critical_Modules.
- Convenções fast-check do projeto sempre respeitadas.

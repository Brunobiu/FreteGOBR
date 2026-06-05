# Design Document

> Sistema de Testes Automatizados e Validações Contínuas — FreteGO

## Overview

Este documento descreve a arquitetura técnica do sistema de testes do FreteGO. O objetivo é transformar os 27 requisitos em uma infraestrutura concreta, executável e evolutiva, reusando a stack já presente no repositório (Vitest 4 + fast-check 4, Playwright via MCP, GitHub Actions, cobertura v8) e estendendo-a apenas onde necessário.

O design segue três princípios:

1. **Reuso antes de reinvenção.** A base já existe (`src/__tests__/`, `vitest.config.ts`, `.github/workflows/ci.yml`, Husky + lint-staged). O sistema é uma extensão organizada, não uma reescrita.
2. **Pirâmide de testes.** Muitos testes unitários e property-based (rápidos, determinísticos), uma camada média de integração com Supabase, e poucos E2E (lentos, alto valor).
3. **Governança executável.** As "decisões oficiais" viram helpers e matchers reutilizáveis, de modo que o comportamento correto seja a opção mais fácil de testar.

Decisões de governança são traduzidas em **assertions canônicas** centralizadas (ex.: `expectPermissionDenied`, `expectAuditPersisted`, `expectAntiEnumeration`), evitando divergência de interpretação entre autores de testes.

### Mapa de requisitos para componentes

| Requisito | Componente de design |
|---|---|
| R1–R6 (Unitários) | `Unit_Test_Suite` + geradores fast-check + `financeInvariants` |
| R7–R13 (Integração) | `Integration_Test_Suite` + `SupabaseTestHarness` + `auditAssertions` |
| R14–R15 (E2E) | `E2E_Test_Suite` (Playwright) + `e2eFixtures` |
| R16–R19 (Segurança) | `Security_Test_Suite` + `rlsHarness` + `attackVectors` |
| R20 (Performance) | `Performance_Test_Suite` (k6/autocannon) |
| R21 (Regressão) | `Regression_Suite` (toda a coleção) + CI gates |
| R22–R23 (Validação) | `Data_Validator` contracts + `zodSchemas` |
| R24 (Contratos) | `Contract_Test_Suite` + snapshot de schema Zod |
| R25 (CI/CD) | `CI_Pipeline` (GitHub Actions estendido) |
| R26 (Observabilidade) | `Observability_Layer` + `logAssertions` |
| R27 (Governança) | `Spec_Governance_Process` + checklist + steering |

## Architecture

### Camadas de teste (pirâmide)

```
                ┌─────────────────────────┐
                │   E2E (Playwright)       │  poucos, lentos, alto valor
                │   R14, R15               │  desktop + mobile + adversidade
                ├─────────────────────────┤
                │   Integração (Supabase)  │  fluxos ponta a ponta sem browser
                │   R7–R13                 │  branch DB efêmero
                ├─────────────────────────┤
                │   Contrato + Validação   │  schemas Zod, round-trip front/back
                │   R22–R24                │
                ├─────────────────────────┤
                │   Unit + Property        │  muitos, rápidos, determinísticos
                │   R1–R6                  │  fast-check + Vitest
                └─────────────────────────┘

      Transversais: Segurança (R16–R19) · Performance (R20)
                    Regressão (R21) · Observabilidade (R26)
                    Governança (R27)
```

### Estrutura de pastas

Mantém a convenção existente `src/__tests__/` e adiciona um diretório dedicado para integração/E2E/perf que dependem de ambiente externo.

```
src/
  __tests__/
    _helpers/                      # NOVO — assertions e harness compartilhados
      auditAssertions.ts           # expectAuditPersisted, expectViewDenied
      authAssertions.ts            # expectPermissionDenied (precedência)
      antiEnumeration.ts           # expectAntiEnumeration (msgs canônicas)
      financeInvariants.ts         # invariantes lucro/comissão
      generators.ts                # fc.* reusáveis (cpf, cnpj, phone, email)
      supabaseHarness.ts           # cliente de teste + seed/cleanup
      rlsHarness.ts                # dois usuários, checa isolamento
      logAssertions.ts             # estrutura de log, no-secret-leak
    <modulo>/                      # já existe: admin/, notifications-hub/...
      cp<N>_<nome>.property.test.ts

tests/                             # NOVO — fora do bundle do app
  integration/
    auth.integration.test.ts       # R7
    frete-lifecycle.integration.test.ts  # R8
    chat.integration.test.ts       # R9
    billing-webhooks.integration.test.ts # R10
    uploads.integration.test.ts    # R11
    lgpd-audit.integration.test.ts # R12
    jobs-external.integration.test.ts # R13
  contract/
    api-contracts.test.ts          # R24 — snapshot de schema Zod
  e2e/
    playwright.config.ts
    fixtures/
      e2eFixtures.ts
    auth.e2e.spec.ts               # R14
    frete.e2e.spec.ts              # R14
    devices-adverse.e2e.spec.ts    # R15
  security/                        # já existe parte em src/__tests__/security
    rls-isolation.test.ts          # R16
    injection-vectors.test.ts      # R17
    rate-limit-bruteforce.test.ts  # R18
    no-secret-leak.test.ts         # R19
    secret-scan.test.ts            # R19.5 (scan de fonte)
  performance/
    load.k6.js                     # R20
    thresholds.json
  contracts-snapshots/             # baseline de schemas pra detectar breaking
    *.schema.json

.github/workflows/
  ci.yml                           # estendido (R25)
  e2e.yml                          # NOVO — Playwright em PR
  performance.yml                  # NOVO — agendado/manual
```

> Nota: testes que importam só código puro do app continuam em `src/__tests__/` (rápidos, rodam no pre-commit). Testes que dependem de Supabase/browser vão para `tests/` e rodam no CI, não no pre-commit, para manter o commit rápido.

### Ambientes de execução

| Suíte | Onde roda | Gatilho | DB |
|---|---|---|---|
| Unit + Property | local + CI | pre-commit (staged) + push/PR | nenhum |
| Integração | CI | push/PR | branch Supabase efêmero |
| Contrato | local + CI | push/PR | nenhum (schemas) |
| E2E | CI | PR (label/scheduled) | branch Supabase efêmero |
| Segurança | CI | push/PR | branch + mocks |
| Performance | CI | manual/agendado | ambiente isolado |

O branch Supabase efêmero usa o recurso de **development branches** do projeto (migrations da `main` aplicadas a um DB limpo), garantindo isolamento e idempotência sem tocar produção.

## Components and Interfaces

### 1. Assertions canônicas de governança (`_helpers/`)

O coração do design. Cada decisão oficial vira uma função reutilizável; testes chamam a função em vez de reimplementar a checagem.

```ts
// authAssertions.ts — R16.5, regra "permission_denied tem precedência"
export function expectPermissionDenied(err: unknown): void {
  // Aprova SOMENTE se o error code for exatamente 'permission_denied',
  // mesmo que existam erros de validacao simultaneos.
  const code = extractErrorCode(err);
  expect(code).toBe('permission_denied');
}

// auditAssertions.ts — R12.4, "auditoria so aprova se PERSISTIR"
export async function expectAuditPersisted(
  db: SupabaseTestClient,
  expected: { action: string; targetType: string; targetId: string }
): Promise<void> {
  // A mera execucao NAO basta: tem que existir a linha persistida.
  const { data } = await db
    .from('admin_audit_logs')
    .select('action,target_type,target_id')
    .match({
      action: expected.action,
      target_type: expected.targetType,
      target_id: expected.targetId,
    })
    .maybeSingle();
  expect(data, 'registro de auditoria deve estar PERSISTIDO').not.toBeNull();
}

// auditAssertions.ts — R12.5, "audit falho NAO bloqueia mutacao"
export async function expectMutationSucceedsDespiteAuditFailure(
  runMutation: () => Promise<{ ok: boolean }>
): Promise<void> {
  const res = await runMutation(); // audit logging mockado para falhar
  expect(res.ok, 'mutacao principal deve concluir mesmo com audit falho').toBe(true);
}

// antiEnumeration.ts — R7.6/7.7/7.8
export const CANONICAL_MESSAGES = {
  AUTH: 'Não foi possível autenticar.',
  SIGNUP: 'Não foi possível concluir o cadastro.',
  CODE: 'Não foi possível enviar o código.',
} as const;
```

### 2. Geradores fast-check compartilhados (`_helpers/generators.ts`)

Centraliza os geradores, respeitando as convenções do projeto (`fc.stringOf` não existe; phone/CPF/CNPJ/email via `fc.constantFrom` de templates fixos válidos).

```ts
import fc from 'fast-check';

// Templates fixos validos — evita valores aleatorios que falham validacao.
export const validCpf = () => fc.constantFrom('111.444.777-35', '529.982.247-25');
export const validCnpj = () => fc.constantFrom('11.222.333/0001-81', '45.448.325/0001-92');
export const validPhone = () => fc.constantFrom('(62) 99999-8888', '(11) 98765-4321');
export const validEmail = () => fc.constantFrom('teste@fretegobr.com.br', 'motorista@gmail.com');

// String segura: usa fc.string com filter (nunca fc.stringOf).
export const safeText = (min: number, max: number) =>
  fc.string({ minLength: min, maxLength: max }).filter((s) => s.trim().length >= min);

// Numeros financeiros incluindo extremos e invalidos.
export const financialAmount = () =>
  fc.oneof(
    fc.double({ min: 0, max: 1_000_000, noNaN: true }),
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0.01)
  );
```

### 3. Supabase Test Harness (`_helpers/supabaseHarness.ts`)

Provê cliente de teste, seed determinístico e cleanup. Usado por integração e segurança.

```ts
export interface SupabaseTestHarness {
  asUser(userId: string): SupabaseTestClient;   // JWT do usuario
  asAnon(): SupabaseTestClient;                  // role anon
  asService(): SupabaseTestClient;               // service_role (setup/teardown)
  seedUser(opts: SeedUserOptions): Promise<SeededUser>;
  cleanup(): Promise<void>;                       // remove tudo que o teste criou
}
```

- `asService` só no setup/teardown; nunca para exercitar a regra sob teste (senão burla RLS).
- `cleanup` roda em `afterEach`/`afterAll`, garantindo idempotência entre execuções.
- Credenciais lidas de variáveis de ambiente do CI (nunca hardcoded — R19).

### 4. RLS Harness (`_helpers/rlsHarness.ts`)

Especializado em isolamento entre usuários (R16).

```ts
export async function expectNoCrossUserAccess<T>(
  harness: SupabaseTestHarness,
  table: string,
  ownerRow: () => Promise<{ id: string; ownerId: string }>
): Promise<void> {
  const { id, ownerId } = await ownerRow();
  const intruder = await harness.seedUser({ type: 'motorista' });
  const { data, error } = await harness.asUser(intruder.id).from(table).select('*').eq('id', id);
  // Isolamento: ou retorna vazio, ou erro de permissao — nunca a linha do dono.
  expect(data ?? []).toHaveLength(0);
}
```

### 5. Contract Test Suite (`tests/contract/`)

Usa os schemas Zod já presentes no projeto (`zod` está no `package.json`) como fonte da verdade. Mantém um snapshot do schema em `contracts-snapshots/`; muda compatível passa, incompatível falha (R24.2/24.3).

```ts
// Detecta breaking change comparando o JSON Schema derivado do Zod
// contra o baseline versionado.
function assertContractCompatible(name: string, current: JsonSchema): void {
  const baseline = loadBaseline(name);
  const diff = diffSchemas(baseline, current);
  // Adicao de campo opcional / novo enum value = compativel (nao falha).
  // Remocao de campo / mudanca de tipo / obrigatorio novo = incompativel (falha).
  expect(diff.breaking, formatBreaking(diff)).toHaveLength(0);
}
```

### 6. E2E (Playwright)

`tests/e2e/playwright.config.ts` define projetos para desktop e mobile (R15.1). Fixtures preparam sessão autenticada e dados.

```ts
// playwright.config.ts (essencial)
export default defineConfig({
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },     // <768px
  ],
  retries: process.env.CI ? 1 : 0,   // retry conta como flaky (ver R21.3)
  reporter: [['html'], ['json', { outputFile: 'e2e-results.json' }]],
});
```

Helper de formulário inválido (R14.3) exige **as duas** condições:

```ts
export async function expectInvalidFormBlocked(page: Page, submit: () => Promise<void>) {
  const urlBefore = page.url();
  await submit();
  // 1) submissao bloqueada (sem navegacao / sem persistencia)
  expect(page.url()).toBe(urlBefore);
  // 2) mensagem de erro em pt-BR visivel
  await expect(page.getByRole('alert')).toBeVisible();
  // teste so passa se AMBAS as condicoes ocorrerem.
}
```

### 7. Performance (`tests/performance/`)

k6 (ou autocannon) com thresholds em arquivo versionado. Roda em workflow separado para não atrasar o PR comum.

```js
// thresholds.json -> import no script k6
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<800'],   // R20.2 p95 dentro do limite
    http_req_failed: ['rate<0.01'],
  },
};
```

Cenário de degradação controlada (R20.6): serviços externos mockados como indisponíveis simultaneamente; assert que o app responde (degradado) em vez de 5xx total.

## Data Models

### Resultado de teste padronizado (relatórios CI)

```ts
interface TestRunReport {
  suite: 'unit' | 'integration' | 'e2e' | 'security' | 'performance' | 'contract';
  total: number;
  passed: number;
  failed: number;
  flaky: number;          // passou só após retry — bloqueia mesmo assim (R21.3)
  durationMs: number;
  coverage?: CoverageSummary;
}

interface CoverageSummary {
  lines: number;
  branches: number;
  functions: number;
  criticalModules: Array<{ path: string; pct: number; threshold: number; ok: boolean }>;
}
```

### Critical_Module e Coverage_Threshold (R25.7)

```ts
// tests/coverage.config.ts
export const CRITICAL_MODULES: Record<string, number> = {
  'src/utils/calculoFrete.ts': 95,
  'src/services/admin/permissions.ts': 95,
  'src/services/admin/audit.ts': 90,
  'src/utils/trialStatus.ts': 90,
  'src/utils/inputValidator.ts': 90,
  'src/utils/passwordValidation.ts': 90,
  'src/services/verification.ts': 85,
};
```

Um script de pós-cobertura (`scripts/check-coverage.ts`) lê o `coverage-final.json` do v8 e falha se algum Critical_Module ficar abaixo do threshold (R25.8).

## Error Handling

A suíte trata erros de forma a distinguir **falha de produto** (deve bloquear) de **falha de infraestrutura** (não deve bloquear merge — R21.4/R25.3).

| Situação | Classificação | Ação no CI |
|---|---|---|
| Asserção de teste falha | Falha de produto | Bloqueia merge/deploy |
| Teste flaky (passou após retry) | Falha de produto | Bloqueia merge/deploy (R21.3) |
| Cobertura abaixo do threshold | Falha de produto | Bloqueia deploy (R25.8) |
| Schema incompatível | Falha de produto | Bloqueia (R24.2) |
| Runner sem rede / branch DB indisponível | Falha de infra | NÃO bloqueia automaticamente (R21.4) |
| Timeout de provisionamento do CI | Falha de infra | NÃO bloqueia automaticamente |

A distinção é feita por um wrapper que marca exceções de infraestrutura com um exit code/anotação dedicada, lida por um step do workflow que decide o gate.

Convenções de error codes verificados pelos testes (do requirements): `INVALID_NUMERIC_INPUT`, `NUMERIC_OVERFLOW`, `USAGE_LIMIT_REACHED`, `STALE_VERSION`, `permission_denied`, `PARSE_ERROR`, `JOB_FAILED`, `INVALID_FILE_TYPE`, `WEBHOOK_SIGNATURE_INVALID`.

## Testing Strategy

### Property-based (fast-check) — invariantes priorizadas

- **Round-trip** (R5.3, R24.6): `parse(print(x)) ≡ x`; serialização de contrato ida e volta.
- **Invariante financeira** (R1.6): `lucro_liquido = receita - custos_totais` para todo par válido.
- **Confluência/idempotência** (R6.3/R6.4): ordem de operações comutativas não muda resultado; aplicar 2x = aplicar 1x.
- **Isolamento** (R16.6): para todo par de usuários distintos, nenhum lê linha do outro.
- **Condição de erro** (R17.6): para todo payload malicioso, rejeição sem efeito colateral.

Convenções fast-check do projeto respeitadas: `vi.mock` hoisted (expor spies via `globalThis.__nomeDoSpy`), nada de `fc.stringOf`, geradores de PII via `fc.constantFrom`.

### Mocks e dublês

- APIs externas (R13.2): 1–3 cenários representativos com stub (sucesso, erro, timeout).
- Provedor de pagamento (R10.3): mock para aprovação e recusa.
- Audit logging falho (R12.5): mock que rejeita, para provar que a mutação principal segue.

### Determinismo

- `cleanup()` obrigatório por teste de integração.
- Seeds com IDs derivados do nome do teste (sem colisão em execução paralela).
- Sem dependência de relógio real: datas injetadas.

## Pipeline CI/CD (R25)

Extensão do `.github/workflows/ci.yml` atual (que hoje faz `lint`, `test --run`, `build`) e adição de workflows dedicados.

```yaml
# ci.yml (estendido) — roda em push e PR
jobs:
  quality:
    steps:
      - run: npm ci
      - run: npm run lint                 # R25.1
      - run: npx tsc --noEmit             # type-check (R25.1)
      - run: npm run test:run -- --coverage
      - run: npx tsx scripts/check-coverage.ts   # R25.7/25.8
      - run: npm run build                # R25.1
  migrations:
    steps:
      - run: npx tsx scripts/validate-migrations.ts   # R25.4
  env-check:
    steps:
      - run: npx tsx scripts/validate-env.ts          # R25.5
```

- **Gate de deploy** (R25.2): deploy só após `quality`, `migrations`, `env-check` verdes.
- **Flaky bloqueia** (R21.3): step que lê o relatório e falha se `flaky > 0`.
- **Infra não bloqueia** (R21.4/R25.3): steps de infra marcados com `continue-on-error` + anotação, sem reprovar o gate de produto.
- **Cobertura** (R25.6): artefato HTML publicado a cada run.

```
push/PR ──> [lint] ──> [type-check] ──> [unit+property+coverage] ──┐
                                                                    ├─> gate ──> deploy
       └──> [migrations] ──> [env-check] ──> [integration] ─────────┘
PR(label) ──> [e2e desktop+mobile]
scheduled ──> [performance]
```

## Observabilidade (R26)

- **Logs estruturados contínuos** (R26.1): formato JSON com `level`, `ts`, `correlation_id`, `module`; não dependem de evento específico.
- **Correlation ID** (R26.2/R26.6): gerado na borda (frontend), propagado em header para Edge Functions e incluído no `body` das RPCs auditáveis.
- **Métricas e alertas** (R26.3/R26.4): expostas e validadas com 1–3 exemplos; alerta dispara ao cruzar limiar.
- **No-secret-leak** (R19/R26): `logAssertions.expectNoSecrets(logLine)` roda sobre amostras de log capturadas nos testes.

## Governança de Specs (R27)

Materializada como um steering file e um checklist de PR, não como código de runtime.

```
.kiro/steering/testing-governance.md   # regra: nenhuma feature pronta sem testes
```

Checklist obrigatório por feature nova (R27):
- [ ] requirements.md, design.md, tasks.md
- [ ] testes automatizados + cenários de falha
- [ ] validações (frontend + backend)
- [ ] Regression_Suite atualizada
- [ ] documentação técnica atualizada
- [ ] critérios de aceite testáveis

## Correctness Properties

Propriedades formais que a suíte deve garantir, expressas como invariantes verificáveis por property-based testing (fast-check). Cada uma mapeia para requisitos e para um teste concreto.

### Property 1: Invariante financeira
**Validates: Requirements 1.5, 1.6, 1.7**
Para todo par de entradas financeiras válidas `(receita, custos)`:
`lucro_liquido(receita, custos) == receita - custos_totais(custos)`.
Para entradas `NaN`/`Infinity`/`-Infinity`, o resultado é o erro `INVALID_NUMERIC_INPUT`; em overflow, `NUMERIC_OVERFLOW`. Nunca um número silenciosamente errado.

### Property 2: Round-trip de parsing e contrato
**Validates: Requirements 5.3, 24.6**
Para todo objeto válido `x` gerado: `parse(print(x))` é equivalente a `x`. Vale para parsers internos e para a serialização de contratos entre frontend e backend.

### Property 3: Idempotência
**Validates: Requirements 6.4, 10.5, 11.4**
Para toda operação declarada idempotente `op`: `op(op(s)) == op(s)`. Aplicar um webhook duplicado, um `_SKIPPED` admin, ou um upload repetido não produz efeito adicional.

### Property 4: Confluência de operações comutativas
**Validates: Requirements 6.3**
Para qualquer permutação de um conjunto de operações comutativas aplicadas ao mesmo estado inicial, o estado final é idêntico (independe da ordem).

### Property 5: Versionamento otimista monotônico
**Validates: Requirements 6.2, 8.6**
Para duas atualizações concorrentes sobre o mesmo registro versionado, no máximo uma sucede; a outra recebe `STALE_VERSION` e o registro não é alterado por ela. `updated_at` é estritamente crescente a cada mutação aceita.

### Property 6: Isolamento entre usuários
**Validates: Requirements 16.6**
Para todo par de usuários distintos `(A, B)` e toda tabela com RLS, uma leitura feita por `A` nunca retorna linhas cujo dono é `B`. O conjunto retornado a `A` é subconjunto das linhas de `A`.

### Property 7: Precedência de permission_denied
**Validates: Requirements 16.5**
Para toda requisição a uma ação protegida feita por quem não tem permissão, o resultado é exatamente `permission_denied`, independentemente de erros de validação simultâneos presentes na mesma requisição.

### Property 8: Auditoria persistida implica verificação aprovada
**Validates: Requirements 12.4**
A verificação de auditoria de um evento é aprovada se e somente se existe um registro persistido em `admin_audit_logs` casando `action`, `target_type` e `target_id`. A execução do processo sem persistência nunca aprova.

### Property 9: Mutação resiliente a falha de auditoria
**Validates: Requirements 12.5**
Para toda mutação admin cujo audit logging falhe, a operação principal ainda conclui com sucesso. A falha de auditoria nunca altera o resultado da mutação.

### Property 10: Rejeição sem efeito colateral
**Validates: Requirements 17.6, 22.6**
Para todo payload malicioso ou inválido gerado, a entrada é rejeitada e nenhum efeito colateral persiste (nenhuma linha criada/alterada, nenhum arquivo retido).

### Property 11: Não vazamento de segredos
**Validates: Requirements 19.1, 19.3**
Para toda resposta de API e toda linha de log capturada nos testes, não aparece hash de senha, token, secret nem stack trace.

### Property 12: Anti-enumeração canônica
**Validates: Requirements 7.6, 7.7, 7.8, 18.3**
Para falhas de autenticação, envio de código e cadastro duplicado, a mensagem retornada é exatamente a canônica correspondente, e respostas para identidades existentes e inexistentes são indistinguíveis.

### Property 13: Compatibilidade de contrato
**Validates: Requirements 24.2, 24.3**
Mudança de schema compatível (campo opcional novo, novo valor de enum) não falha o teste de contrato; mudança incompatível (remoção de campo, mudança de tipo, novo obrigatório) sempre falha.

### Property 14: Degradação controlada
**Validates: Requirements 13.3, 20.6**
Com um ou mais serviços externos indisponíveis simultaneamente, o sistema responde de forma degradada (parcial) em vez de falha total; blocos de um fetch agregado falham isoladamente sem derrubar os demais.

## Decisões e Trade-offs

1. **`tests/` separado de `src/__tests__/`.** Mantém o pre-commit rápido (só unit/property do código staged) e isola testes que exigem ambiente externo. Trade-off: dois locais de teste — mitigado por documentação clara.
2. **Branch Supabase efêmero para integração/E2E.** Isolamento real e idempotência sem risco a produção. Trade-off: tempo de provisionamento no CI — mitigado rodando E2E só em PR com label ou agendado.
3. **k6 para performance em workflow separado.** Evita atrasar o PR comum. Trade-off: performance não roda em todo push — aceitável por ser caro e menos volátil.
4. **Snapshot de schema Zod para contratos.** Detecta breaking change automaticamente sem ferramenta externa pesada (Pact). Trade-off: cobre contrato interno front/back, não consumidores terceiros — suficiente para o escopo atual.
5. **Assertions canônicas centralizadas.** Garante interpretação única das decisões de governança. Trade-off: acoplamento ao helper — aceitável, pois é exatamente o ponto de verdade desejado.

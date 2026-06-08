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

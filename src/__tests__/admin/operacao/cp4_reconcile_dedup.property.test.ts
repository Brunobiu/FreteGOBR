// Feature: admin-central-operacao, Property 4: Deduplicação e idempotência da reconciliação.
//
// reconcile nunca propõe abrir alerta para uma dedup_key já ativa (<= 1 ativo por
// situação) e é idempotente: após aplicar toOpen, reconciliar de novo dá toOpen
// vazio e nenhuma situação ainda-ativa em toResolve.
//
// Validates: Requirements 6.5, 7.2, 7.3, 7.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  reconcile,
  dedupKey,
  ALERT_SEVERITY_MAP,
  type ActiveSituation,
  type ExistingActiveAlert,
  type AlertType,
} from '../../../services/admin/operacao/alertEvaluator';
import { uuidLike } from '../../_helpers/generators';

const ALERT_TYPES: AlertType[] = [
  'WHATSAPP_DISCONNECTED',
  'CAMPAIGN_PAUSED',
  'CAMPAIGN_ERROR',
  'INTEGRATION_FAILURE',
  'SUBSCRIPTION_EXPIRING',
  'CUSTOMER_AWAITING',
];

const situationGen: fc.Arbitrary<ActiveSituation> = fc
  .record({ alertType: fc.constantFrom(...ALERT_TYPES), sourceId: uuidLike() })
  .map(({ alertType, sourceId }) => ({
    alertType,
    source: { sourceType: 'src', sourceId },
    severity: ALERT_SEVERITY_MAP[alertType],
  }));

function dedupeSituations(list: ActiveSituation[]): ActiveSituation[] {
  const seen = new Set<string>();
  const out: ActiveSituation[] = [];
  for (const s of list) {
    const k = dedupKey(s.alertType, s.source);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

describe('CP-4 operações: deduplicação e idempotência da reconciliação', () => {
  it('não reabre situação ativa; reaplicar o plano é idempotente', () => {
    const scenario = fc.record({
      situations: fc.array(situationGen, { maxLength: 8 }).map(dedupeSituations),
      extraExistingKeys: fc.uniqueArray(fc.string({ minLength: 4, maxLength: 16 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(scenario, ({ situations, extraExistingKeys }) => {
        // existing = subconjunto das situações + chaves extras (sem situação)
        const half = situations.slice(0, Math.floor(situations.length / 2));
        const existing: ExistingActiveAlert[] = [
          ...half.map((s) => ({ dedupKey: dedupKey(s.alertType, s.source), state: 'OPEN' as const })),
          ...extraExistingKeys.map((k) => ({ dedupKey: `extra:${k}`, state: 'OPEN' as const })),
        ];
        const existingKeys = new Set(existing.map((e) => e.dedupKey));
        const situationKeys = new Set(situations.map((s) => dedupKey(s.alertType, s.source)));

        const plan = reconcile(existing, situations);

        // toOpen nunca inclui chave já ativa
        for (const s of plan.toOpen)
          expect(existingKeys.has(dedupKey(s.alertType, s.source))).toBe(false);
        // nenhuma situação ativa aparece em toResolve
        for (const k of situationKeys) expect(plan.toResolve).not.toContain(k);

        // idempotência: aplica toOpen e reconcilia de novo
        const existing2: ExistingActiveAlert[] = [
          ...existing,
          ...plan.toOpen.map((s) => ({ dedupKey: dedupKey(s.alertType, s.source), state: 'OPEN' as const })),
        ];
        const plan2 = reconcile(existing2, situations);
        expect(plan2.toOpen).toEqual([]);
        for (const k of situationKeys) expect(plan2.toResolve).not.toContain(k);
      }),
      { numRuns: 200 }
    );
  });
});

// Feature: admin-central-operacao, Property 5: Auto-resolução consistente.
//
// Toda dedup_key ativa SEM situação correspondente aparece em toResolve; toda
// chave que ainda corresponde a uma situação ativa NÃO aparece em toResolve.
//
// Validates: Requirements 7.4, 7.5

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
  'SUBSCRIPTION_EXPIRING',
  'CUSTOMER_AWAITING',
];

const sitGen: fc.Arbitrary<ActiveSituation> = fc
  .record({ alertType: fc.constantFrom(...ALERT_TYPES), sourceId: uuidLike() })
  .map(({ alertType, sourceId }) => ({
    alertType,
    source: { sourceType: 'src', sourceId },
    severity: ALERT_SEVERITY_MAP[alertType],
  }));

describe('CP-5 operações: auto-resolução consistente', () => {
  it('toResolve == exatamente as chaves ativas sem situação', () => {
    fc.assert(
      fc.property(
        fc.array(sitGen, { maxLength: 10 }),
        fc.array(fc.boolean(), { maxLength: 10 }),
        (allSits, keepFlags) => {
          // dedupe por chave
          const byKey = new Map<string, ActiveSituation>();
          for (const s of allSits) byKey.set(dedupKey(s.alertType, s.source), s);
          const sits = [...byKey.values()];

          // particiona em "ainda ativa" (mantém situação) vs "extinta" (só existe como alerta)
          const stillActive: ActiveSituation[] = [];
          const extinctKeys: string[] = [];
          sits.forEach((s, i) => {
            const key = dedupKey(s.alertType, s.source);
            if (keepFlags[i] ?? true) stillActive.push(s);
            else extinctKeys.push(key);
          });

          // existing = todas ativas (still + extintas)
          const existing: ExistingActiveAlert[] = sits.map((s) => ({
            dedupKey: dedupKey(s.alertType, s.source),
            state: 'OPEN' as const,
          }));
          // situations = apenas as ainda-ativas
          const plan = reconcile(existing, stillActive);

          expect(new Set(plan.toResolve)).toEqual(new Set(extinctKeys));
          const stillKeys = new Set(stillActive.map((s) => dedupKey(s.alertType, s.source)));
          for (const k of stillKeys) expect(plan.toResolve).not.toContain(k);
        }
      ),
      { numRuns: 200 }
    );
  });
});

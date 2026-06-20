// Feature: admin-ia-supervisora, Property 3: Dedup/idempotência da reconciliação.
//
// reconcileInsights não reabre um dedup_key já ativo (<= 1 ativo por situação) e
// é idempotente: após aplicar toOpen ao conjunto existente, reconciliar de novo
// sobre as mesmas anomalias produz toOpen vazio e nenhum toDismiss das ativas.
//
// Validates: Requirements 5.4, 3.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectAnomalies,
  reconcileInsights,
  type ExistingActiveInsight,
} from '../../../services/admin/supervisor/anomalyDetector';
import { anomalySnapshotGen } from './_generators';

const existingGen = fc.array(
  fc.record({
    dedupKey: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
    state: fc.constantFrom<'OPEN' | 'ACKNOWLEDGED'>('OPEN', 'ACKNOWLEDGED'),
  }),
  { maxLength: 6 }
);

describe('CP3 supervisor: dedup/idempotência da reconciliação', () => {
  it('nunca reabre dedup_key ativo; toOpen disjunto de existing', () => {
    fc.assert(
      fc.property(anomalySnapshotGen, existingGen, (snap, existing) => {
        const anomalies = detectAnomalies(snap);
        const plan = reconcileInsights(existing, anomalies);
        const existingKeys = new Set(existing.map((e) => e.dedupKey));
        for (const o of plan.toOpen) expect(existingKeys.has(o.dedupKey)).toBe(false);
        // toTouch ⊆ existing ∩ anomalias
        for (const k of plan.toTouch) expect(existingKeys.has(k)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('idempotência: aplicar toOpen e reconciliar de novo => toOpen vazio, sem dismiss das ativas', () => {
    fc.assert(
      fc.property(anomalySnapshotGen, existingGen, (snap, existing) => {
        const anomalies = detectAnomalies(snap);
        const plan1 = reconcileInsights(existing, anomalies);
        // simula o estado após aplicar o plano: existentes + recém-abertos
        const after: ExistingActiveInsight[] = [
          ...existing,
          ...plan1.toOpen.map((a) => ({ dedupKey: a.dedupKey, state: 'OPEN' as const })),
        ];
        const plan2 = reconcileInsights(after, anomalies);
        expect(plan2.toOpen).toEqual([]);
        // nenhuma chave de anomalia ativa aparece em toDismiss
        const anomalyKeys = new Set(anomalies.map((a) => a.dedupKey));
        for (const k of plan2.toDismiss) expect(anomalyKeys.has(k)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('auto-dismiss: chave ativa sem anomalia correspondente entra em toDismiss', () => {
    const existing: ExistingActiveInsight[] = [
      { dedupKey: 'ANOMALY:diagnostic:extinta', state: 'OPEN' },
    ];
    const plan = reconcileInsights(existing, []);
    expect(plan.toDismiss).toContain('ANOMALY:diagnostic:extinta');
    expect(plan.toOpen).toEqual([]);
  });
});

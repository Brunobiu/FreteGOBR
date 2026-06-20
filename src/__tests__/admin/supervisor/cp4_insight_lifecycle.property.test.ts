// Feature: admin-ia-supervisora, Property 4: Idempotência/versionamento ack/dismiss.
//
// applyInsightOp: ack de ACKNOWLEDGED / dismiss de DISMISSED => _SKIPPED sem
// mutar; expected_updated_at divergente => stale; DISMISSED terminal (ack =>
// invalid_transition); N acks sobre OPEN => 1 transição + N-1 skips.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyInsightOp,
  type InsightLifecycleState,
  type InsightOp,
} from '../../../services/admin/supervisor/insightLifecycle';
import { insightStateGen } from './_generators';

const CUR = '2026-06-19T12:00:00Z';
const NEXT = '2026-06-19T12:05:00Z';

describe('CP4 supervisor: idempotência/versionamento de ack/dismiss', () => {
  it('skip/invalid/stale/transition conforme estado e versão', () => {
    fc.assert(
      fc.property(
        insightStateGen,
        fc.constantFrom<'ack' | 'dismiss'>('ack', 'dismiss'),
        fc.boolean(),
        (state, kind, correctVersion) => {
          const current: InsightLifecycleState = { state, updatedAt: CUR };
          const op: InsightOp = {
            kind,
            expectedUpdatedAt: correctVersion ? CUR : 'errado',
            nextUpdatedAt: NEXT,
          };
          const res = applyInsightOp(current, op);

          if (kind === 'ack' && state === 'ACKNOWLEDGED') {
            expect(res.effect).toBe('skipped');
            expect(res.reason).toBe('ALREADY_ACKNOWLEDGED');
            expect(res.state).toEqual(current); // sem mutar
          } else if (kind === 'dismiss' && state === 'DISMISSED') {
            expect(res.effect).toBe('skipped');
            expect(res.reason).toBe('ALREADY_DISMISSED');
            expect(res.state).toEqual(current);
          } else if (kind === 'ack' && state === 'DISMISSED') {
            expect(res.effect).toBe('invalid_transition'); // terminal
            expect(res.state).toEqual(current);
          } else if (!correctVersion) {
            expect(res.effect).toBe('stale');
            expect(res.state).toEqual(current);
          } else {
            expect(res.effect).toBe('transition');
            expect(res.state.updatedAt).toBe(NEXT);
            expect(res.state.state).toBe(kind === 'ack' ? 'ACKNOWLEDGED' : 'DISMISSED');
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('N acks sobre OPEN => 1 transição efetiva + N-1 skips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        let state: InsightLifecycleState = { state: 'OPEN', updatedAt: CUR };
        let transitions = 0;
        let skips = 0;
        for (let i = 0; i < n; i++) {
          const res = applyInsightOp(state, {
            kind: 'ack',
            expectedUpdatedAt: state.updatedAt,
            nextUpdatedAt: `${NEXT}-${i}`,
          });
          if (res.effect === 'transition') transitions++;
          if (res.effect === 'skipped') skips++;
          state = res.state;
        }
        expect(transitions).toBe(1);
        expect(skips).toBe(n - 1);
        expect(state.state).toBe('ACKNOWLEDGED');
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: admin-central-operacao, Property 6: Idempotência e versionamento de ack/resolve.
//
// ack de já-ACKNOWLEDGED / resolve de já-RESOLVED => _SKIPPED sem mutar;
// expected_updated_at divergente => STALE_VERSION sem mutar; N acks sobre OPEN =>
// exatamente 1 transição + (N-1) _SKIPPED; RESOLVED terminal.
//
// Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyAlertOp,
  type AlertLifecycleState,
  type AlertOp,
} from '../../../services/admin/operacao/alertLifecycle';

const stateGen = fc.record({
  state: fc.constantFrom('OPEN', 'ACKNOWLEDGED', 'RESOLVED'),
  updatedAt: fc.constantFrom('t0', 't1', 't2'),
}) as fc.Arbitrary<AlertLifecycleState>;

const opGen = fc.record({
  kind: fc.constantFrom('ack', 'resolve'),
  expectedUpdatedAt: fc.constantFrom('t0', 't1', 't2'),
  nextUpdatedAt: fc.constant('t9'),
}) as fc.Arbitrary<AlertOp>;

describe('CP-6 operações: idempotência e versionamento de ack/resolve', () => {
  it('semântica por estado/versão (skip/stale/invalid/transition)', () => {
    fc.assert(
      fc.property(stateGen, opGen, (current, op) => {
        const res = applyAlertOp(current, op);
        if (op.kind === 'ack') {
          if (current.state === 'ACKNOWLEDGED') {
            expect(res.effect).toBe('skipped');
            expect(res.reason).toBe('ALREADY_ACKNOWLEDGED');
            expect(res.state).toEqual(current);
          } else if (current.state === 'RESOLVED') {
            expect(res.effect).toBe('invalid_transition');
            expect(res.state).toEqual(current);
          } else if (op.expectedUpdatedAt !== current.updatedAt) {
            expect(res.effect).toBe('stale');
            expect(res.state).toEqual(current);
          } else {
            expect(res.effect).toBe('transition');
            expect(res.state).toEqual({ state: 'ACKNOWLEDGED', updatedAt: op.nextUpdatedAt });
          }
        } else {
          if (current.state === 'RESOLVED') {
            expect(res.effect).toBe('skipped');
            expect(res.reason).toBe('ALREADY_RESOLVED');
            expect(res.state).toEqual(current);
          } else if (op.expectedUpdatedAt !== current.updatedAt) {
            expect(res.effect).toBe('stale');
            expect(res.state).toEqual(current);
          } else {
            expect(res.effect).toBe('transition');
            expect(res.state).toEqual({ state: 'RESOLVED', updatedAt: op.nextUpdatedAt });
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('N acks sobre OPEN => exatamente 1 transição + (N-1) _SKIPPED', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        let state: AlertLifecycleState = { state: 'OPEN', updatedAt: 't0' };
        let transitions = 0;
        let skips = 0;
        for (let i = 0; i < n; i++) {
          // 1ª op com expected correto; demais já caem em skip (estado ACKNOWLEDGED)
          const res = applyAlertOp(state, {
            kind: 'ack',
            expectedUpdatedAt: state.updatedAt,
            nextUpdatedAt: `t${i + 1}`,
          });
          if (res.effect === 'transition') transitions += 1;
          else if (res.effect === 'skipped') skips += 1;
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

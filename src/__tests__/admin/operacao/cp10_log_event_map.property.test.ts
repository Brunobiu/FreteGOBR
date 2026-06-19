// Feature: admin-central-operacao, Property 10: Totalidade do Log_Event_Map.
//
// resolveActionCodes é total e determinística para todo Log_Event_Type; tipos sem
// emissor (LOGOUT, CLIENT_CREATED) resolvem para [] — sem erro nem fabricação.
//
// Validates: Requirements 11.1, 11.2, 11.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveActionCodes,
  LOG_EVENT_TYPES,
} from '../../../services/admin/operacao/logEventMap';
import { logEventTypeGen } from './_generators';

describe('CP-10 operações: totalidade do Log_Event_Map', () => {
  it('total + determinística; LOGOUT/CLIENT_CREATED => []', () => {
    fc.assert(
      fc.property(logEventTypeGen, (t) => {
        const r = resolveActionCodes(t);
        expect(Array.isArray(r)).toBe(true);
        expect(resolveActionCodes(t)).toEqual(r); // determinismo
        if (t === 'LOGOUT' || t === 'CLIENT_CREATED') {
          expect(r).toEqual([]);
        } else {
          expect(r.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('definida para TODOS os 9 tipos do domínio fechado', () => {
    for (const t of LOG_EVENT_TYPES) {
      expect(Array.isArray(resolveActionCodes(t))).toBe(true);
    }
    expect(LOG_EVENT_TYPES.length).toBe(9);
  });
});

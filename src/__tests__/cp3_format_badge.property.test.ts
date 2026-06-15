/**
 * Property-Based Test — motorista-chat-nav, Property 3.
 *
 * Feature: motorista-chat-nav, Property 3: Formatação do badge satura em "9+".
 * Validates: Requirements 3.4, 3.5
 *
 * Invariante: para qualquer inteiro `n >= 0`, `formatBadge(n)` produz:
 *   - `''` (sem badge) quando `n === 0`;
 *   - `String(n)` quando `1 <= n <= 9`;
 *   - exatamente `'9+'` quando `n > 9`.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { formatBadge } from '../services/chatFrete';

describe('motorista-chat-nav — Property 3: formatação do badge satura em "9+"', () => {
  it('cobre os três ramos para qualquer n não negativo', () => {
    fc.assert(
      fc.property(fc.nat(), (n) => {
        const result = formatBadge(n);
        if (n === 0) {
          expect(result).toBe('');
        } else if (n <= 9) {
          expect(result).toBe(String(n));
        } else {
          expect(result).toBe('9+');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('vazio exatamente em 0, número exato em 1..9, "9+" para todo n > 9', () => {
    expect(formatBadge(0)).toBe('');
    for (let n = 1; n <= 9; n++) {
      expect(formatBadge(n)).toBe(String(n));
    }
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 1_000_000 }), (n) => {
        expect(formatBadge(n)).toBe('9+');
      }),
      { numRuns: 100 }
    );
  });
});

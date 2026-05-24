/**
 * PBT para readStoredRadius — sempre retorna um membro válido de
 * RADIUS_OPTIONS_KM, independentemente do input.
 *
 * Validates: Requirements 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  readStoredRadius,
  RADIUS_OPTIONS_KM,
} from '../utils/geoDistance';

describe('readStoredRadius', () => {
  it('para qualquer string ou null, retorna um membro válido de RADIUS_OPTIONS_KM', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
        const r = readStoredRadius(raw);
        expect((RADIUS_OPTIONS_KM as readonly number[]).includes(r)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('round-trip: readStoredRadius(String(R)) === R para R válido', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RADIUS_OPTIONS_KM), (r) => {
        expect(readStoredRadius(String(r))).toBe(r);
      }),
      { numRuns: 100 }
    );
  });

  it('null retorna RADIUS_DEFAULT_KM (100)', () => {
    expect(readStoredRadius(null)).toBe(100);
  });

  it('valor numérico fora das opções retorna default', () => {
    expect(readStoredRadius('999')).toBe(100);
    expect(readStoredRadius('-50')).toBe(100);
  });

  it('lixo não numérico retorna default', () => {
    expect(readStoredRadius('abc')).toBe(100);
    expect(readStoredRadius('')).toBe(100);
  });
});

/**
 * Property-Based Test — Validação por tipo/enum/intervalo (Settings_Service).
 *
 * Feature: finalizacao-lancamento, Property 2: Validação por tipo.
 * Validates: Requirements 5.5, 6.2, 7.2, 9.2, 10.1, 10.2, 10.3.
 *
 * validateSettingValue aceita um valor se e somente se ele é coerente com o
 * Setting_Value_Type (string / integer / money 0..1_000_000 / boolean /
 * enum∈options / range por key). Campo readonly sempre rejeita com
 * READONLY_SETTING.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  validateSettingValue,
  MONEY_MAX_CENTS,
  TRIAL_DURATION_MIN,
  TRIAL_DURATION_MAX,
} from '../../../services/admin/settings';

describe('Property 2: validação por tipo', () => {
  it('string: aceita qualquer string, rejeita não-string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(validateSettingValue('string', s).ok).toBe(true);
      }),
      { numRuns: 100 }
    );
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)), (v) => {
        expect(validateSettingValue('string', v).ok).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('boolean: aceita só boolean', () => {
    fc.assert(
      fc.property(fc.boolean(), (b) => {
        expect(validateSettingValue('boolean', b).ok).toBe(true);
      }),
      { numRuns: 50 }
    );
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer()), (v) => {
        expect(validateSettingValue('boolean', v).ok).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('money: aceita inteiro 0..MAX, rejeita fora do range / não-inteiro', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MONEY_MAX_CENTS }), (n) => {
        expect(validateSettingValue('money', n).ok).toBe(true);
      }),
      { numRuns: 100 }
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: MONEY_MAX_CENTS + 1, max: MONEY_MAX_CENTS + 1_000_000 }),
          fc.integer({ min: -1_000_000, max: -1 }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true })
        ),
        (n) => {
          expect(validateSettingValue('money', n).ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('integer trial_duration_days: aceita 1..365, rejeita fora', () => {
    fc.assert(
      fc.property(fc.integer({ min: TRIAL_DURATION_MIN, max: TRIAL_DURATION_MAX }), (n) => {
        expect(validateSettingValue('integer', n, { key: 'trial_duration_days' }).ok).toBe(true);
      }),
      { numRuns: 100 }
    );
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -365, max: 0 }), fc.integer({ min: 366, max: 10000 })),
        (n) => {
          expect(validateSettingValue('integer', n, { key: 'trial_duration_days' }).ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('enum: aceita valor ∈ options, rejeita fora', () => {
    const options = ['disconnected', 'connecting', 'connected', 'error'];
    fc.assert(
      fc.property(fc.constantFrom(...options), (v) => {
        expect(validateSettingValue('enum', v, { enumOptions: options }).ok).toBe(true);
      }),
      { numRuns: 50 }
    );
    fc.assert(
      fc.property(
        fc.string().filter((s) => !options.includes(s)),
        (v) => {
          expect(validateSettingValue('enum', v, { enumOptions: options }).ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('readonly: rejeita SEMPRE com READONLY_SETTING, qualquer valor', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer(), fc.boolean()), (v) => {
        const r = validateSettingValue('string', v, { isReadonly: true });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('READONLY_SETTING');
      }),
      { numRuns: 100 }
    );
  });

  it('secret: nunca é validado por update normal (rejeita)', () => {
    expect(validateSettingValue('secret', 'qualquer').ok).toBe(false);
  });
});

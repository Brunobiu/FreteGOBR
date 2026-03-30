/**
 * Property-Based Tests for Password Validation
 * Regra simplificada: mínimo 6 caracteres
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from './passwordValidation';

describe('Property 2: Password Validation Rules (simplificada)', () => {
  it('isValid === (length >= 6)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(password.length >= 6);
      }),
      { numRuns: 200 }
    );
  });

  it('hasMinLength reflete corretamente o tamanho', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.hasMinLength).toBe(password.length >= 6);
      }),
      { numRuns: 100 }
    );
  });

  it('errors vazio quando válido, não-vazio quando inválido', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        if (result.isValid) {
          expect(result.errors).toHaveLength(0);
        } else {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

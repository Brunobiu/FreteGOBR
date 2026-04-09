/**
 * Property-Based Tests for Password Validation
 * Regra atualizada: mínimo 8 chars + maiúscula + minúscula + número + especial + não comum
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from '../utils/passwordValidation';

describe('Property 2: Password Validation Rules (enhanced)', () => {
  it('hasMinLength === (length >= 8)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.requirements.hasMinLength).toBe(password.length >= 8);
      }),
      { numRuns: 200 }
    );
  });

  it('hasUppercase reflete presença de maiúscula', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.requirements.hasUppercase).toBe(/[A-Z]/.test(password));
      }),
      { numRuns: 100 }
    );
  });

  it('hasLowercase reflete presença de minúscula', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.requirements.hasLowercase).toBe(/[a-z]/.test(password));
      }),
      { numRuns: 100 }
    );
  });

  it('hasNumber reflete presença de número', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.requirements.hasNumber).toBe(/[0-9]/.test(password));
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

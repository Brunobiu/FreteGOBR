/**
 * Property-Based Tests for Password Validation
 *
 * Property 2: Password Validation Rules
 * Validates: Requirements 1.6, 3.3, 3.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from './passwordValidation';

describe('Password Validation - Property Tests', () => {
  it('Property: passwords with 6+ chars, 1+ letter, 1+ number should be valid', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 6, maxLength: 20 })
          .filter((s) => /[a-zA-Z]/.test(s) && /\d/.test(s)),
        (password) => {
          const result = validatePassword(password);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
          expect(result.hasMinLength).toBe(true);
          expect(result.hasLetter).toBe(true);
          expect(result.hasNumber).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: passwords with less than 6 chars should be invalid', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 5 }), (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.hasMinLength).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('Property: passwords without letters should be invalid', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 6, maxLength: 20 })
          .filter((s) => !/[a-zA-Z]/.test(s) && s.length >= 6),
        (password) => {
          const result = validatePassword(password);
          expect(result.isValid).toBe(false);
          expect(result.hasLetter).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: passwords without numbers should be invalid', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 6, maxLength: 20 })
          .filter((s) => !/\d/.test(s) && /[a-zA-Z]/.test(s)),
        (password) => {
          const result = validatePassword(password);
          expect(result.isValid).toBe(false);
          expect(result.hasNumber).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: validation is deterministic (same input = same output)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (password) => {
        const result1 = validatePassword(password);
        const result2 = validatePassword(password);
        expect(result1).toEqual(result2);
      }),
      { numRuns: 100 }
    );
  });
});

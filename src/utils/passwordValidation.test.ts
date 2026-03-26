/**
 * Property-Based Tests for Password Validation
 * Feature: fretego
 *
 * **Validates: Requirements 1.6, 3.3, 3.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePassword } from './passwordValidation';

describe('Property Tests - Password Validation', () => {
  /**
   * Property 2: Password Validation Rules
   *
   * For any string, the password validator should accept it if and only if
   * it has at least 6 characters, contains at least 1 letter, and contains at least 1 number.
   *
   * **Validates: Requirements 1.6, 3.3, 3.4**
   */
  it('Property 2: should accept passwords with 6+ chars, 1+ letter, 1+ number', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (password) => {
        const hasMinLength = password.length >= 6;
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasNumber = /[0-9]/.test(password);

        const expectedValid = hasMinLength && hasLetter && hasNumber;
        const result = validatePassword(password);

        expect(result.isValid).toBe(expectedValid);
        expect(result.hasMinLength).toBe(hasMinLength);
        expect(result.hasLetter).toBe(hasLetter);
        expect(result.hasNumber).toBe(hasNumber);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 2: should always accept valid passwords (6+ chars, letter, number)', () => {
    // Generator for valid passwords
    const validPasswordArbitrary = fc
      .tuple(
        fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
          { minLength: 1 }
        ),
        fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 1 }),
        fc.string({ minLength: 0, maxLength: 94 }) // Additional characters
      )
      .map(([letters, numbers, extra]) => {
        // Shuffle to create realistic passwords
        const combined = (letters + numbers + extra).split('');
        for (let i = combined.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [combined[i], combined[j]] = [combined[j], combined[i]];
        }
        return combined.join('');
      })
      .filter((pwd) => pwd.length >= 6);

    fc.assert(
      fc.property(validPasswordArbitrary, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 2: should always reject passwords without letters', () => {
    const noLetterPasswordArbitrary = fc.stringOf(
      fc.constantFrom(...'0123456789!@#$%^&*()_+-=[]{}|;:,.<>?/~`'.split('')),
      { minLength: 6, maxLength: 100 }
    );

    fc.assert(
      fc.property(noLetterPasswordArbitrary, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.hasLetter).toBe(false);
        expect(result.errors).toContain('Senha deve conter pelo menos 1 letra');
      }),
      { numRuns: 100 }
    );
  });

  it('Property 2: should always reject passwords without numbers', () => {
    const noNumberPasswordArbitrary = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,.<>?/~`'.split(
          ''
        )
      ),
      { minLength: 6, maxLength: 100 }
    );

    fc.assert(
      fc.property(noNumberPasswordArbitrary, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.hasNumber).toBe(false);
        expect(result.errors).toContain('Senha deve conter pelo menos 1 número');
      }),
      { numRuns: 100 }
    );
  });

  it('Property 2: should always reject passwords shorter than 6 characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 5 }), (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.hasMinLength).toBe(false);
        expect(result.errors).toContain('Senha deve ter no mínimo 6 caracteres');
      }),
      { numRuns: 100 }
    );
  });
});

describe('Unit Tests - Password Validation', () => {
  it('should reject password with less than 6 characters', () => {
    const result = validatePassword('abc12');
    expect(result.isValid).toBe(false);
    expect(result.hasMinLength).toBe(false);
    expect(result.errors).toContain('Senha deve ter no mínimo 6 caracteres');
  });

  it('should reject password without letters', () => {
    const result = validatePassword('123456');
    expect(result.isValid).toBe(false);
    expect(result.hasLetter).toBe(false);
    expect(result.errors).toContain('Senha deve conter pelo menos 1 letra');
  });

  it('should reject password without numbers', () => {
    const result = validatePassword('abcdef');
    expect(result.isValid).toBe(false);
    expect(result.hasNumber).toBe(false);
    expect(result.errors).toContain('Senha deve conter pelo menos 1 número');
  });

  it('should accept valid password with minimum requirements', () => {
    const result = validatePassword('abc123');
    expect(result.isValid).toBe(true);
    expect(result.hasMinLength).toBe(true);
    expect(result.hasLetter).toBe(true);
    expect(result.hasNumber).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept password with special characters', () => {
    const result = validatePassword('abc123!@#');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept password with uppercase and lowercase letters', () => {
    const result = validatePassword('AbC123');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject empty password', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should provide all applicable error messages', () => {
    const result = validatePassword('ab');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Senha deve ter no mínimo 6 caracteres');
    expect(result.errors).toContain('Senha deve conter pelo menos 1 número');
  });
});

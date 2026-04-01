/**
 * Tests for Password Validation
 * Regra: mínimo 6 caracteres (sem exigência de letra/número)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePassword } from '../utils/passwordValidation';

describe('Property Tests - Password Validation', () => {
  it('aceita qualquer senha com 6+ caracteres', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 6, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(true);
        expect(result.hasMinLength).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rejeita qualquer senha com menos de 6 caracteres', () => {
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

  it('hasLetter e hasNumber são informativos mas não bloqueiam', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 6, maxLength: 50 }), (password) => {
        const result = validatePassword(password);
        expect(result.hasLetter).toBe(/[a-zA-Z]/.test(password));
        expect(result.hasNumber).toBe(/[0-9]/.test(password));
        // Mesmo sem letra ou número, é válido se tem 6+ chars
        expect(result.isValid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Unit Tests - Password Validation', () => {
  it('rejeita senha curta', () => {
    const result = validatePassword('abc');
    expect(result.isValid).toBe(false);
  });

  it('aceita senha só com números (6+ chars)', () => {
    const result = validatePassword('123456');
    expect(result.isValid).toBe(true);
  });

  it('aceita senha só com letras (6+ chars)', () => {
    const result = validatePassword('abcdef');
    expect(result.isValid).toBe(true);
  });

  it('aceita senha mista', () => {
    const result = validatePassword('abc123');
    expect(result.isValid).toBe(true);
  });

  it('rejeita senha vazia', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
  });
});

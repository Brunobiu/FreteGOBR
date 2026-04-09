/**
 * Tests for Password Validation
 * Regra atualizada: mínimo 8 caracteres + maiúscula + minúscula + número + especial + não comum
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePassword } from '../utils/passwordValidation';

// Helper: gera senha que atende todos os requisitos
const VALID_PASSWORD = 'Abc123!@';
const STRONG_PASSWORD = 'MyStr0ng!Pass#2024';

describe('Property Tests - Password Validation', () => {
  it('rejeita qualquer senha com menos de 8 caracteres', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 7 }), (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.requirements.hasMinLength).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('hasMinLength reflete corretamente o tamanho >= 8', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (password) => {
        const result = validatePassword(password);
        expect(result.requirements.hasMinLength).toBe(password.length >= 8);
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

describe('Unit Tests - Password Validation', () => {
  it('rejeita senha curta', () => {
    const result = validatePassword('Abc1!');
    expect(result.isValid).toBe(false);
    expect(result.requirements.hasMinLength).toBe(false);
  });

  it('rejeita senha sem maiúscula', () => {
    const result = validatePassword('abc123!@');
    expect(result.isValid).toBe(false);
    expect(result.requirements.hasUppercase).toBe(false);
  });

  it('rejeita senha sem minúscula', () => {
    const result = validatePassword('ABC123!@');
    expect(result.isValid).toBe(false);
    expect(result.requirements.hasLowercase).toBe(false);
  });

  it('rejeita senha sem número', () => {
    const result = validatePassword('Abcdefg!');
    expect(result.isValid).toBe(false);
    expect(result.requirements.hasNumber).toBe(false);
  });

  it('rejeita senha sem caractere especial', () => {
    const result = validatePassword('Abcdefg1');
    expect(result.isValid).toBe(false);
    expect(result.requirements.hasSpecialChar).toBe(false);
  });

  it('rejeita senha comum', () => {
    const result = validatePassword('password');
    expect(result.isValid).toBe(false);
    expect(result.requirements.notCommonPassword).toBe(false);
  });

  it('aceita senha que atende todos os requisitos', () => {
    const result = validatePassword(VALID_PASSWORD);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('aceita senha forte', () => {
    const result = validatePassword(STRONG_PASSWORD);
    expect(result.isValid).toBe(true);
    expect(result.strength).toBe('strong');
  });

  it('rejeita senha vazia', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
  });
});

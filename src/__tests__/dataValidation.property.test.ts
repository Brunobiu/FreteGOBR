/**
 * Property-Based Tests — Validação de dados (Tarefa 22).
 *
 * Cobre as decisões oficiais de validação de input:
 *   - Rejeição consistente de vazio/nulo/undefined/tipo incorreto.
 *   - Sanitização ocorre APENAS quando caractere perigoso é detectado.
 *   - Normalização (email lowercase, phone só dígitos) antes de persistir.
 *
 * Validates: Requirements 22.1, 22.3, 22.4, 22.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import InputValidator from '../utils/inputValidator';

describe('Property — rejeição consistente de entradas vazias/nulas/inválidas', () => {
  it('null e undefined sempre rejeitados (texto)', () => {
    expect(InputValidator.validateText(null as unknown as string).isValid).toBe(false);
    expect(InputValidator.validateText(undefined as unknown as string).isValid).toBe(false);
  });

  it('email vazio/nulo sempre rejeitado', () => {
    fc.assert(
      fc.property(fc.constantFrom('', '   ', '\t', '\n'), (blank) => {
        expect(InputValidator.validateEmail(blank).isValid).toBe(false);
      })
    );
  });

  it('telefone vazio sempre rejeitado', () => {
    expect(InputValidator.validatePhone('').isValid).toBe(false);
  });

  it('número NaN/Infinity sempre rejeitado', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(InputValidator.validateNumber(bad).isValid).toBe(false);
    }
  });
});

describe('Property — sanitização só quando há caractere perigoso', () => {
  it('texto seguro (alfanumérico + espaço) não é alterado pela sanitização HTML', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9 ]+$/), (safe) => {
        expect(InputValidator.sanitizeHTML(safe)).toBe(safe);
      }),
      { numRuns: 200 }
    );
  });

  it('texto com caractere perigoso (<,>,&,",\u0027) é escapado', () => {
    fc.assert(
      fc.property(fc.constantFrom('<', '>', '&', '"', "'", '/', '`', '='), (danger) => {
        const out = InputValidator.sanitizeHTML(danger);
        expect(out).not.toBe(danger);
        expect(out.startsWith('&')).toBe(true);
      })
    );
  });

  it('sanitizeHTML é idempotente (não re-escapa o que já escapou)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = InputValidator.sanitizeHTML(s);
        const twice = InputValidator.sanitizeHTML(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Property — normalização antes de persistir', () => {
  it('email é normalizado para lowercase + trim', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'Teste@FreteGoBR.com.br',
          'Motorista@Gmail.com',
          'Embarcador@Empresa.com.br'
        ),
        (email) => {
          const upper = `  ${email}  `;
          const res = InputValidator.validateEmail(upper);
          expect(res.sanitizedValue).toBe(email.trim().toLowerCase());
        }
      )
    );
  });

  it('telefone válido é reduzido a somente dígitos', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('(62) 99999-8888', '(11) 98765-4321', '(21) 3344-5566'),
        (formatted) => {
          const res = InputValidator.validatePhone(formatted);
          expect(res.sanitizedValue).toMatch(/^\d+$/);
        }
      )
    );
  });
});

describe('Property — determinismo da validação', () => {
  it('mesma entrada produz mesmo resultado (frontend determinístico)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        const a = InputValidator.validateText(input);
        const b = InputValidator.validateText(input);
        expect(a.isValid).toBe(b.isValid);
        expect(a.sanitizedValue).toBe(b.sanitizedValue);
        expect(a.errors).toEqual(b.errors);
      }),
      { numRuns: 200 }
    );
  });
});

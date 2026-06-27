/**
 * Property-Based Test — login-sem-senha, CP4: classificação do identificador.
 *
 * Feature: login-sem-senha
 * Validates: Requisito 2 (detecção de canal e-mail vs telefone).
 *
 * `classifyIdentifier` (passwordlessLogin.ts) decide o canal de forma PURA e
 * determinística: contém `@` ⇒ e-mail (válido se casar o formato); senão tenta
 * telefone BR (E.164, via toE164BR). Reusa a util phoneE164.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { classifyIdentifier } from '../../../services/passwordlessLogin';
import { validEmail, validPhone } from '../../_helpers/generators';

describe('CP4 — classifyIdentifier (login sem senha)', () => {
  it('e-mail válido ⇒ "email"', () => {
    fc.assert(
      fc.property(validEmail(), (e) => {
        expect(classifyIdentifier(e)).toBe('email');
      })
    );
  });

  it('telefone BR válido (com máscara) ⇒ "phone"', () => {
    fc.assert(
      fc.property(validPhone(), (p) => {
        expect(classifyIdentifier(p)).toBe('phone');
      })
    );
  });

  it('contém "@" mas formato inválido ⇒ "invalid"', () => {
    fc.assert(
      fc.property(fc.constantFrom('user@', '@x.com', 'a@b', 'x@y.', 'sem-arroba'), (e) => {
        expect(classifyIdentifier(e)).not.toBe('email');
      })
    );
  });

  it('vazio / sem dígitos suficientes ⇒ "invalid"', () => {
    fc.assert(
      fc.property(fc.constantFrom('', '   ', '123', 'abc', '99'), (s) => {
        expect(classifyIdentifier(s)).toBe('invalid');
      })
    );
  });

  it('determinístico: mesma entrada ⇒ mesma saída', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        expect(classifyIdentifier(s)).toBe(classifyIdentifier(s));
      })
    );
  });
});

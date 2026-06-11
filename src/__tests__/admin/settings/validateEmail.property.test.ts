/**
 * Property-Based Test (opcional) — E-mail de contato (válido ou vazio).
 *
 * Feature: finalizacao-lancamento, Property 7: E-mail válido ou vazio.
 * Validates: Requirements 9.2.
 *
 * validateEmail retorna true se e somente se a entrada é uma string vazia
 * (campo opcional) ou um e-mail em formato válido.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { validateEmail } from '../../../services/admin/settings';

describe('Property 7: e-mail válido ou vazio (opcional)', () => {
  it('aceita e-mails válidos e string vazia', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('suporte@fretegobr.com.br', 'contato@empresa.com', 'a@b.co', '', '   '),
        (email) => {
          expect(validateEmail(email)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('rejeita e-mails malformados não vazios', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('semarroba.com', 'user@', '@dominio.com', 'a@b', 'a b@c.com'),
        (email) => {
          expect(validateEmail(email)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

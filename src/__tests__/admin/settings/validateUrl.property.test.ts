/**
 * Property-Based Test (opcional) — URL https da Evolution API.
 *
 * Feature: finalizacao-lancamento, Property 6: Validação de URL base https.
 * Validates: Requirements 5.3.
 *
 * validateEvolutionBaseUrl retorna true se e somente se a entrada é uma URL
 * absoluta com esquema exatamente https.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { validateEvolutionBaseUrl } from '../../../services/admin/settings';

describe('Property 6: validação de URL https (opcional)', () => {
  it('aceita URLs https absolutas', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'https://api.evolution.com',
          'https://evolution.fretegobr.com.br',
          'https://localhost:8080',
          'https://sub.dominio.com/path'
        ),
        (url) => {
          expect(validateEvolutionBaseUrl(url)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('rejeita http, relativas, vazias e lixo', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'http://api.evolution.com',
          'ftp://x.com',
          '/path/relativo',
          'evolution.com',
          'javascript:alert(1)',
          '',
          '   ',
          'not a url'
        ),
        (url) => {
          expect(validateEvolutionBaseUrl(url)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

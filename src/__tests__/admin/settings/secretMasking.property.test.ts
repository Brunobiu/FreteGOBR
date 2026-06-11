/**
 * Property-Based Test — Segredo nunca vaza (masking) (Settings_Service).
 *
 * Feature: finalizacao-lancamento, Property 1: Segredo nunca vaza.
 * Validates: Requirements 2.3, 3.3, 4.1, 4.2, 4.3.
 *
 * Para qualquer valor bruto de segredo:
 *   - maskSecret revela no MÁXIMO os últimos 4 caracteres do bruto;
 *   - quando o bruto tem <= 4 caracteres, mascara TUDO (não vaza nada);
 *   - o prefixo é sempre composto de bullets, nunca de caracteres do bruto
 *     além dos 4 finais.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { maskSecret, decideSecretAction } from '../../../services/admin/settings';

describe('Property 1: segredo nunca vaza (masking)', () => {
  it('revela no máximo os últimos 4 caracteres do bruto', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.length >= 5),
        (raw) => {
          const masked = maskSecret(raw);
          const last4 = raw.slice(-4);
          // A saída é exatamente bullets + os últimos 4 chars do bruto.
          expect(masked).toBe('••••••••' + last4);
          // Exatamente 4 caracteres do bruto são revelados (o sufixo).
          expect(masked.slice(-4)).toBe(last4);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('quando o bruto tem <= 4 caracteres, mascara tudo (não revela o bruto)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 4 }), (raw) => {
        const masked = maskSecret(raw);
        // Não contém o bruto em lugar nenhum.
        expect(masked.includes(raw)).toBe(false);
        // Só bullets.
        expect(/^[•]+$/.test(masked)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('o prefixo mascarado é sempre composto só de bullets', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 5, maxLength: 100 }), (raw) => {
        const masked = maskSecret(raw);
        const prefix = masked.slice(0, masked.length - 4);
        expect(/^[•]+$/.test(prefix)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('decideSecretAction: remoção ⇒ clear; novo valor ⇒ set; em branco ⇒ preserve', () => {
    expect(decideSecretAction({ removeRequested: true, newSecret: '' })).toBe('clear');
    expect(decideSecretAction({ removeRequested: true, newSecret: 'abc' })).toBe('clear');
    expect(decideSecretAction({ removeRequested: false, newSecret: 'novo-segredo' })).toBe('set');
    expect(decideSecretAction({ removeRequested: false, newSecret: '   ' })).toBe('preserve');
    expect(decideSecretAction({ removeRequested: false, newSecret: '' })).toBe('preserve');
  });
});

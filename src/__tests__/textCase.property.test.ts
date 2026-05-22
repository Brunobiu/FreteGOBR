/**
 * Property-Based Tests — Capitalização de nomes (pt-BR)
 *
 * Property 5 (Design Section 10): `capitalizeName` aplica regra
 * pt-BR (primeira letra maiúscula em cada palavra, EXCETO conectores
 * de/da/do/das/dos/e). É idempotente, preserva tokens e o primeiro
 * token é sempre capitalizado.
 *
 * Validates: Requirements 1.2, 1.3 (capitalização persistida via
 * service motorista — testamos a função pura usada pelo service e
 * pela UI no onBlur).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { capitalizeName } from '../utils/textCase';

const CONNECTORS = ['de', 'da', 'do', 'das', 'dos', 'e'];
// Restringe ao alfabeto pt-BR (sem chars como 'ß' que produzem 'SS' no toUpperCase).
// Em pt-BR isso é o domínio relevante para nomes de pessoas e empresas.
const ptbrLetter = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzáéíóúâêîôûãõàçABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ'.split('')
);
const wordArb = fc
  .array(ptbrLetter, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

describe('capitalizeName', () => {
  it('é idempotente', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 6 }), (words) => {
        const input = words.join(' ');
        const once = capitalizeName(input);
        const twice = capitalizeName(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('string vazia retorna string vazia', () => {
    expect(capitalizeName('')).toBe('');
  });

  it('o primeiro token é sempre capitalizado, mesmo se for um conector', () => {
    for (const c of CONNECTORS) {
      const out = capitalizeName(`${c} silva`);
      expect(out.charAt(0)).toBe(c.charAt(0).toUpperCase());
    }
  });

  it('conectores em meio do nome ficam em minúsculo', () => {
    expect(capitalizeName('joão da silva')).toBe('João da Silva');
    expect(capitalizeName('MARIA DOS SANTOS')).toBe('Maria dos Santos');
    expect(capitalizeName('transportes e logística')).toBe('Transportes e Logística');
  });

  it('preserva o número de tokens (split por espaço)', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 8 }), (words) => {
        const input = words.join(' ');
        const out = capitalizeName(input);
        expect(out.split(' ').length).toBe(words.length);
      }),
      { numRuns: 200 }
    );
  });

  it('output normalizado nunca tem espaços duplos consecutivos', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 6 }), (words) => {
        // Insere extras espaços entre palavras pra testar normalização
        const input = words.join('   ');
        const out = capitalizeName(input);
        expect(out).not.toMatch(/ {2}/);
      }),
      { numRuns: 200 }
    );
  });

  it('quando o token NÃO é conector, primeira letra é uppercase', () => {
    fc.assert(
      fc.property(
        wordArb.filter((w) => !CONNECTORS.includes(w.toLowerCase())),
        (word) => {
          const out = capitalizeName(`prefix ${word}`);
          const tokens = out.split(' ');
          // O segundo token (não-conector) deve começar com maiúscula
          expect(tokens[1].charAt(0)).toBe(tokens[1].charAt(0).toUpperCase());
          expect(/[A-ZÀ-Ý]/.test(tokens[1].charAt(0))).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('caracteres pt-BR (acentos, ç) são preservados', () => {
    expect(capitalizeName('joão')).toBe('João');
    expect(capitalizeName('conceição')).toBe('Conceição');
    expect(capitalizeName('alvaréz')).toBe('Alvaréz');
  });
});

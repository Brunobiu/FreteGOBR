// Feature: admin-marketing, Property 6: Hashing de PII
/**
 * CP-6: Hashing de PII — formato, normalizacao idempotente e ausencia de
 * duplo-hash.
 *
 * Para qualquer e-mail/telefone (templates fixos validos, mix de caixa e
 * espacos) e para qualquer hash ja produzido, valida as invariantes do
 * pipeline de PII consumido pela Meta CAPI:
 *
 *   1. Formato: `hashPII(normalizeEmail(e))` e `hashPII(normalizePhone(p))`
 *      produzem exatamente 64 caracteres hexadecimais minusculos
 *      (`/^[0-9a-f]{64}$/`), e `isPiiHash` reconhece o resultado.
 *   2. Determinismo: hashear o mesmo valor normalizado duas vezes produz a
 *      mesma string.
 *   3. Normalizacao idempotente: `normalizeEmail(normalizeEmail(x)) ===
 *      normalizeEmail(x)` e `normalizePhone(normalizePhone(x)) ===
 *      normalizePhone(x)`.
 *   4. Sem duplo-hash: para qualquer hash `h` produzido, `hashPII(h) === h`
 *      (porque `isPiiHash(h)` e verdadeiro), evitando re-hashear um valor que
 *      ja e um hash.
 *
 * Logica pura/deterministica (sem Supabase, sem Vault, sem mocks). O hash usa
 * exclusivamente a Web Crypto API (`crypto.subtle`), disponivel no ambiente
 * jsdom/Node 18+ do vitest — exatamente como a fonte (`src/services/admin/
 * marketing.ts`) a consome.
 *
 * Validates: Requirements 9.4, 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  normalizeEmail,
  normalizePhone,
  isPiiHash,
  hashPII,
} from '../../../services/admin/marketing';

// ----- Geradores (templates fixos validos; mix de caixa/espacos) -----
// Convencao do projeto: email/telefone via fc.constantFrom([...templates
// fixos validos]) para evitar valores aleatorios que falham na validacao.

const emailGen = fc.constantFrom(
  'joao@example.com',
  'MARIA@TESTE.COM.BR',
  ' Ana@Mail.com ',
  'user+tag@dominio.com',
  '  PEDRO@x.io'
);

const phoneGen = fc.constantFrom(
  '+55 11 91234-5678',
  '(11) 99999-0000',
  '5511988887777',
  '  +55 21 3030 4040 '
);

// Regex de PII_Hash (espelha o contrato da fonte e a CHECK SQL).
const PII_HASH_REGEX = /^[0-9a-f]{64}$/;

describe('CP-6: Hashing de PII — formato, normalizacao idempotente e ausencia de duplo-hash', () => {
  it('email: formato 64 hex minusculo, determinismo, normalizacao idempotente e sem duplo-hash', async () => {
    await fc.assert(
      fc.asyncProperty(emailGen, async (rawEmail) => {
        const normalized = normalizeEmail(rawEmail);

        // 3. Normalizacao idempotente: normalize(normalize(x)) == normalize(x).
        expect(normalizeEmail(normalized)).toBe(normalized);

        const hash = await hashPII(normalized);

        // 1. Formato: 64 hex minusculos + isPiiHash verdadeiro.
        expect(hash).toMatch(PII_HASH_REGEX);
        expect(hash).toHaveLength(64);
        expect(hash).toBe(hash.toLowerCase());
        expect(isPiiHash(hash)).toBe(true);

        // 2. Determinismo: mesmo valor normalizado ⇒ mesmo hash.
        const hashAgain = await hashPII(normalized);
        expect(hashAgain).toBe(hash);

        // 4. Sem duplo-hash: um valor que ja e hash retorna inalterado.
        expect(isPiiHash(hash)).toBe(true);
        const reHashed = await hashPII(hash);
        expect(reHashed).toBe(hash);
      }),
      { numRuns: 100 }
    );
  });

  it('telefone: formato 64 hex minusculo, determinismo, normalizacao idempotente e sem duplo-hash', async () => {
    await fc.assert(
      fc.asyncProperty(phoneGen, async (rawPhone) => {
        const normalized = normalizePhone(rawPhone);

        // 3. Normalizacao idempotente: normalize(normalize(x)) == normalize(x).
        expect(normalizePhone(normalized)).toBe(normalized);
        // normalizePhone mantem apenas digitos (DDI preservado nos digitos).
        expect(normalized).toMatch(/^\d*$/);

        const hash = await hashPII(normalized);

        // 1. Formato: 64 hex minusculos + isPiiHash verdadeiro.
        expect(hash).toMatch(PII_HASH_REGEX);
        expect(hash).toHaveLength(64);
        expect(hash).toBe(hash.toLowerCase());
        expect(isPiiHash(hash)).toBe(true);

        // 2. Determinismo: mesmo valor normalizado ⇒ mesmo hash.
        const hashAgain = await hashPII(normalized);
        expect(hashAgain).toBe(hash);

        // 4. Sem duplo-hash: um valor que ja e hash retorna inalterado.
        const reHashed = await hashPII(hash);
        expect(reHashed).toBe(hash);
      }),
      { numRuns: 100 }
    );
  });

  it('sem duplo-hash: qualquer PII_Hash arbitrario e retornado inalterado', async () => {
    // Gera hashes sinteticos validos (64 hex minusculos) para confirmar que
    // hashPII detecta o formato via isPiiHash e NAO re-hasheia.
    const hexCharGen = fc.constantFrom(
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f'
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(hexCharGen, { minLength: 64, maxLength: 64 }).map((chars) => chars.join('')),
        async (syntheticHash) => {
          expect(isPiiHash(syntheticHash)).toBe(true);
          const result = await hashPII(syntheticHash);
          expect(result).toBe(syntheticHash);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Cross-check de valor conhecido (nao-fragil): compara hashPII com uma
  // implementacao independente de SHA-256 (node:crypto), confirmando que o
  // digest hex minusculo bate. Evita hardcodar a constante.
  it('known-answer: hashPII concorda com SHA-256 independente (node:crypto)', async () => {
    const { createHash } = await import('node:crypto');
    const samples = ['test@example.com', 'joao@example.com', '5511988887777'];
    for (const sample of samples) {
      const expected = createHash('sha256').update(sample, 'utf8').digest('hex');
      const actual = await hashPII(sample);
      expect(actual).toBe(expected);
      expect(actual).toMatch(PII_HASH_REGEX);
    }
  });
});

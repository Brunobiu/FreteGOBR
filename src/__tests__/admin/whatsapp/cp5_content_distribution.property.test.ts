// Feature: whatsapp-automation, Property 5: Distribution assigns exactly one content per recipient
/**
 * Property-Based Tests — Distribuição de conteúdos (Req 7)
 *
 * Property 5: a função pura `assignContents` (src/services/admin/whatsapp/distribution.ts)
 * atribui EXATAMENTE UM `Content` a cada `Recipient`, e o content atribuído sempre
 * pertence ao conjunto registrado. Os modos respeitam as fórmulas determinísticas:
 *   - INTERLEAVED (Req 7.3): recipient i → contents[i mod M]
 *   - BLOCK (Req 7.2, 7.5): recipient i → contents[floor(i / blockSize) mod M],
 *     reiniciando a sequência quando os contatos excedem a soma dos blocos.
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  assignContents,
  type Recipient,
  type Content,
} from '../../../services/admin/whatsapp/distribution';

// Geradores: identificadores estáveis e únicos por índice (evita fc.stringOf).
const recipientsArb = fc
  .integer({ min: 1, max: 50 })
  .map<Recipient[]>((n) => Array.from({ length: n }, (_unused, i) => ({ id: `r${i}` })));

const contentsArb = fc
  .integer({ min: 1, max: 12 })
  .map<Content[]>((m) => Array.from({ length: m }, (_unused, i) => ({ id: `c${i}` })));

const blockSizeArb = fc.integer({ min: 1, max: 10 });
const modeArb = fc.constantFrom('BLOCK' as const, 'INTERLEAVED' as const);

describe('assignContents — Property 5 (distribuição)', () => {
  it('atribui exatamente um content por recipient e cada content pertence ao conjunto', () => {
    fc.assert(
      fc.property(
        recipientsArb,
        contentsArb,
        modeArb,
        blockSizeArb,
        (recipients, contents, mode, blockSize) => {
          const result = assignContents(recipients, contents, mode, blockSize);

          // Exatamente uma atribuição por recipient, na mesma ordem.
          expect(result).toHaveLength(recipients.length);

          const contentIds = new Set(contents.map((c) => c.id));
          result.forEach((assignment, i) => {
            // Vínculo correto com o recipient (índice e id determinísticos).
            expect(assignment.index).toBe(i);
            expect(assignment.recipientId).toBe(recipients[i].id);
            // Content atribuído pertence ao conjunto registrado.
            expect(contentIds.has(assignment.contentId)).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('INTERLEAVED: recipient i recebe contents[i mod M]', () => {
    fc.assert(
      fc.property(recipientsArb, contentsArb, blockSizeArb, (recipients, contents, blockSize) => {
        const m = contents.length;
        const result = assignContents(recipients, contents, 'INTERLEAVED', blockSize);

        result.forEach((assignment, i) => {
          expect(assignment.contentId).toBe(contents[i % m].id);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('BLOCK: recipient i recebe contents[floor(i/blockSize) mod M] com reinício', () => {
    fc.assert(
      fc.property(recipientsArb, contentsArb, blockSizeArb, (recipients, contents, blockSize) => {
        const m = contents.length;
        const result = assignContents(recipients, contents, 'BLOCK', blockSize);

        result.forEach((assignment, i) => {
          const expectedIndex = Math.floor(i / blockSize) % m;
          expect(assignment.contentId).toBe(contents[expectedIndex].id);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('BLOCK reinicia a sequência quando os contatos excedem a soma dos blocos (M*blockSize)', () => {
    fc.assert(
      fc.property(contentsArb, blockSizeArb, (contents, blockSize) => {
        const m = contents.length;
        // Garante exceder a soma dos blocos (M*blockSize) para forçar o restart.
        const total = m * blockSize + blockSize + 1;
        const recipients: Recipient[] = Array.from({ length: total }, (_unused, i) => ({
          id: `r${i}`,
        }));

        const result = assignContents(recipients, contents, 'BLOCK', blockSize);

        // O índice 0 (primeiro content) deve reaparecer após a soma dos blocos:
        // recipient em i = M*blockSize cai em floor(i/blockSize) mod M = 0.
        const restartIndex = m * blockSize;
        expect(result[restartIndex].contentId).toBe(contents[0].id);
      }),
      { numRuns: 100 }
    );
  });
});

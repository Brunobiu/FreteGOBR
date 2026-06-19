/**
 * Property-Based Test — CP9* (opcional): Exposição da Base de Conhecimento à IA.
 *
 * // Feature: suporte-inteligente, Property 9: o contexto montado para a
 * // Support_AI inclui uma FAQ_Entry sse publication_state='publicada'.
 *
 * Alvo: src/services/admin/suporte/knowledgeBase.ts (selectPublishedFaq +
 * buildSupportContext).
 *
 * Validates: Requirements 5.7, 6.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  selectPublishedFaq,
  buildSupportContext,
  type KbEntryLite,
} from '../../../services/admin/suporte/knowledgeBase';
import { safeText } from '../../_helpers/generators';

const entryArb = (): fc.Arbitrary<KbEntryLite> =>
  fc.record({
    id: fc.uuid(),
    question: safeText(3, 60),
    answer: safeText(1, 120),
    category: fc.constantFrom('geral', 'financeiro', 'tecnico', 'administrativo', 'conta', 'planos'),
    publication_state: fc.constantFrom('rascunho', 'publicada'),
  });

describe('CP9* — exposição da Base de Conhecimento à IA', () => {
  it('selectPublishedFaq inclui uma entrada sse publication_state=publicada', () => {
    fc.assert(
      fc.property(fc.array(entryArb(), { maxLength: 30 }), (entries) => {
        const selected = selectPublishedFaq(entries);
        // Toda selecionada é publicada; nenhuma publicada fica de fora.
        for (const e of selected) expect(e.publication_state).toBe('publicada');
        const expectedCount = entries.filter((e) => e.publication_state === 'publicada').length;
        expect(selected.length).toBe(expectedCount);
      }),
      { numRuns: 100 }
    );
  });

  it('o contexto contém as perguntas publicadas e nenhuma pergunta de rascunho', () => {
    fc.assert(
      fc.property(fc.array(entryArb(), { maxLength: 20 }), (entries) => {
        // Perguntas únicas evitam colisão de substring entre publicada/rascunho.
        const unique = entries.map((e, i) => ({ ...e, question: `Q${i}_${e.question}` }));
        const context = buildSupportContext(selectPublishedFaq(unique));
        for (const e of unique) {
          if (e.publication_state === 'publicada') {
            expect(context).toContain(e.question);
          } else {
            expect(context).not.toContain(e.question);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

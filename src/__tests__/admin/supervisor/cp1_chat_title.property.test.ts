// Feature: supervisor-chat-history (119), Property 1: Title_Derivation
// determinística, total e SEM PII.
//
// deriveTitle: mesma entrada ⇒ mesma saída; nunca emite segredo; comprimento
// <= TITLE_DERIVE_MAX; entrada vazia/só-espaços ⇒ título default.
//
// Validates: Requirements 1.4, 6 (sem PII)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deriveTitle,
  CHAT_LIMITS,
  DEFAULT_SESSION_TITLE,
} from '../../../services/admin/supervisor/chatHistory';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { titleInputGen } from './_generators';

describe('CP1 supervisor-chat: deriveTitle determinístico, total e sem PII', () => {
  it('é determinístico (mesma entrada ⇒ mesma saída)', () => {
    fc.assert(
      fc.property(titleInputGen, (msg) => {
        expect(deriveTitle(msg)).toBe(deriveTitle(msg));
      }),
      { numRuns: 200 }
    );
  });

  it('nunca emite segredo e respeita o comprimento máximo', () => {
    fc.assert(
      fc.property(titleInputGen, (msg) => {
        const title = deriveTitle(msg);
        expectNoSecrets(title);
        expect(title.length).toBeLessThanOrEqual(CHAT_LIMITS.TITLE_DERIVE_MAX);
        expect(title.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });

  it('entrada vazia/só-espaços ⇒ título default', () => {
    fc.assert(
      fc.property(fc.constantFrom('', '   ', '\n\t  ', '\u00a0', '  \r\n '), (blank) => {
        expect(deriveTitle(blank)).toBe(DEFAULT_SESSION_TITLE);
      }),
      { numRuns: 20 }
    );
  });

  it('entrada não-string ⇒ título default (total)', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(deriveTitle(bad as unknown)).toBe(DEFAULT_SESSION_TITLE);
    }
  });
});

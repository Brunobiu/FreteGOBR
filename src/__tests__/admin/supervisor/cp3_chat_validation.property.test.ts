// Feature: supervisor-chat-history (119), Property 3: validação de mensagem
// determinística e total.
//
// validateMessage(role, content): role fechado {user,ai}; content não-vazio e
// <= CONTENT_MAX. Total (qualquer entrada ⇒ {ok} ou {ok:false,code}).
//
// Validates: Requirements 2.2, 2.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateMessage, CHAT_LIMITS } from '../../../services/admin/supervisor/chatHistory';
import { chatRoleGen, chatRoleInvalidGen } from './_generators';
import { safeText } from '../../_helpers/generators';

describe('CP3 supervisor-chat: validateMessage determinística e total', () => {
  it('role válido + content válido ⇒ ok', () => {
    fc.assert(
      fc.property(chatRoleGen, safeText(1, 300), (role, content) => {
        expect(validateMessage(role, content)).toEqual({ ok: true });
      }),
      { numRuns: 200 }
    );
  });

  it('role inválido ⇒ INVALID_INPUT (mesmo com content válido)', () => {
    fc.assert(
      fc.property(chatRoleInvalidGen, safeText(1, 50), (role, content) => {
        const r = validateMessage(role, content);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
      }),
      { numRuns: 100 }
    );
  });

  it('content vazio/só-espaços ⇒ INVALID_INPUT', () => {
    fc.assert(
      fc.property(chatRoleGen, fc.constantFrom('', '   ', '\n\t', '\u00a0'), (role, content) => {
        expect(validateMessage(role, content).ok).toBe(false);
      }),
      { numRuns: 40 }
    );
  });

  it('content acima do limite ⇒ INVALID_INPUT', () => {
    const tooLong = 'a'.repeat(CHAT_LIMITS.CONTENT_MAX + 1);
    expect(validateMessage('user', tooLong).ok).toBe(false);
    expect(validateMessage('ai', 'a'.repeat(CHAT_LIMITS.CONTENT_MAX)).ok).toBe(true); // limite exato ok
  });

  it('é determinística', () => {
    fc.assert(
      fc.property(
        fc.oneof(chatRoleGen, chatRoleInvalidGen),
        fc.oneof(safeText(1, 30), fc.constantFrom('', ' ')),
        (role, content) => {
          expect(validateMessage(role, content)).toEqual(validateMessage(role, content));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('entrada não-string em content ⇒ inválido (total)', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(validateMessage('user', bad as unknown).ok).toBe(false);
    }
  });
});

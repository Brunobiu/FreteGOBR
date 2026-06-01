// Feature: admin-assistant, Property 9
/**
 * CP-9: Dominio fechado do papel de Chat_Message
 *
 * Para toda string, isValidChatRole retorna verdadeiro SE E SOMENTE SE a
 * string pertence a {user, assistant, system}. assertChatRole retorna o
 * papel para valores do dominio e LANCA para qualquer valor fora dele.
 *
 * Espelha a validacao de `role` da RPC rpc_assistant_post_message
 * (CHECK role IN (...)): papeis fora do dominio nunca sao persistidos.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 5.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isValidChatRole, assertChatRole, type ChatRole } from '../../../services/admin/assistant';

// ----- Geradores -----

// Dominio fechado de ChatRole.
const validRoleGen = fc.constantFrom<ChatRole>('user', 'assistant', 'system');

const VALID_ROLES: ReadonlySet<string> = new Set<string>(['user', 'assistant', 'system']);

// Strings arbitrarias possivelmente fora do dominio. Inclui variacoes
// proximas (case, espacos) que NAO devem ser aceitas.
const anyRoleStringGen = fc.oneof(
  validRoleGen,
  fc.constantFrom('User', 'ASSISTANT', 'System', ' user', 'admin', 'bot', '', 'role'),
  fc.string({ minLength: 0, maxLength: 30 })
);

describe('CP-9: Dominio fechado do papel de Chat_Message', () => {
  it('isValidChatRole e verdadeiro sse a string pertence ao dominio', () => {
    fc.assert(
      fc.property(anyRoleStringGen, (s) => {
        expect(isValidChatRole(s)).toBe(VALID_ROLES.has(s));
      }),
      { numRuns: 100 }
    );
  });

  it('assertChatRole retorna o papel no dominio e lanca fora dele', () => {
    fc.assert(
      fc.property(anyRoleStringGen, (s) => {
        if (VALID_ROLES.has(s)) {
          expect(assertChatRole(s)).toBe(s);
        } else {
          expect(() => assertChatRole(s)).toThrow();
        }
      }),
      { numRuns: 100 }
    );
  });
});

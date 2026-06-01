// Feature: admin-assistant, Property 13
/**
 * CP-13: Validacao do dominio fechado de AI_Provider
 *
 * Para toda string, isValidProvider retorna verdadeiro SE E SOMENTE SE a
 * string pertence a {claude, gemini, grok, llama}.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 7.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isValidProvider, type AiProvider } from '../../../services/admin/assistant';

// ----- Geradores -----

// Dominio fechado de AiProvider.
const validProviderGen = fc.constantFrom<AiProvider>('claude', 'gemini', 'grok', 'llama');

const VALID_PROVIDERS: ReadonlySet<string> = new Set<string>(['claude', 'gemini', 'grok', 'llama']);

// Strings arbitrarias possivelmente fora do dominio, incluindo variacoes
// de caixa e nomes proximos que NAO devem ser aceitos.
const anyProviderStringGen = fc.oneof(
  validProviderGen,
  fc.constantFrom('Claude', 'GEMINI', 'gpt', 'openai', 'anthropic', '', 'llama2'),
  fc.string({ minLength: 0, maxLength: 30 })
);

describe('CP-13: Dominio fechado de AI_Provider', () => {
  it('isValidProvider e verdadeiro sse a string pertence ao dominio', () => {
    fc.assert(
      fc.property(anyProviderStringGen, (s) => {
        expect(isValidProvider(s)).toBe(VALID_PROVIDERS.has(s));
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: admin-assistant, Property 14
/**
 * CP-14: Selecao e resultado tipado da Provider_Abstraction
 *
 * Para todo AiProvider configurado como Active_Provider:
 *  - `selectProviderClient(provider)` retorna o cliente cujo `id` e igual a
 *    `provider` (Req 8.4);
 *  - o cliente de `claude` produz `{ ok: true }` (com `fetch` SIMULADO,
 *    Req 8.2);
 *  - os clientes de `gemini`/`grok`/`llama` produzem
 *    `{ ok: false, error: 'provider_not_implemented' }` SEM referenciar
 *    nenhum segredo — nao chamam `fetch` e nao expoem a `apiKey` (Req 8.5).
 *
 * Convencoes de PBT do projeto (project-conventions.md):
 *  - `globalThis.fetch` e substituido por um spy exposto via
 *    `(globalThis as Record<string, unknown>).__fetchSpy`.
 *  - `providerGen = fc.constantFrom('claude','gemini','grok','llama')`.
 *
 * Validates: Requirements 8.2, 8.4, 8.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

import {
  selectProviderClient,
  type AiInvokeInput,
} from '../../../services/admin/assistantProvider';
import type { AiProvider } from '../../../services/admin/assistant';

// ----- Geradores -----

// Dominio fechado de AiProvider (Active_Provider possivel).
const providerGen = fc.constantFrom<AiProvider>('claude', 'gemini', 'grok', 'llama');

// ----- Fixtures -----

// Segredo sentinela: nunca deve aparecer no resultado dos provedores stub.
const SECRET_API_KEY = 'sk-ant-SECRET-TOKEN-do-not-leak-0123456789';

// Entrada de invocacao fixa (irrelevante para a forma do resultado).
const INPUT: AiInvokeInput = {
  context: 'contexto de teste do Context_Builder',
  messages: [{ role: 'user', content: 'ola, assistente' }],
};

// Resposta simulada da Anthropic Messages API com content array valido.
function makeClaudeResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'claude-3-5-sonnet-latest',
      content: [{ type: 'text', text: 'resposta simulada do Claude' }],
    }),
  } as unknown as Response;
}

// ----- Mock de fetch (hoist-safe: spy exposto em globalThis) -----

let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn(async () => makeClaudeResponse());
  (globalThis as Record<string, unknown>).__fetchSpy = fetchSpy;
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<string, unknown>).__fetchSpy;
  vi.restoreAllMocks();
});

describe('CP-14: Provider_Abstraction — selecao e resultado tipado', () => {
  it('selectProviderClient(provider) retorna o cliente cujo id e igual ao provider', () => {
    fc.assert(
      fc.property(providerGen, (provider) => {
        const client = selectProviderClient(provider);
        expect(client.id).toBe(provider);
      }),
      { numRuns: 100 }
    );
  });

  it('claude => { ok: true } (fetch simulado); gemini/grok/llama => provider_not_implemented sem tocar segredo', async () => {
    await fc.assert(
      fc.asyncProperty(providerGen, async (provider) => {
        fetchSpy.mockClear();

        const client = selectProviderClient(provider);
        const result = await client.invoke(INPUT, SECRET_API_KEY);

        if (provider === 'claude') {
          // Caminho funcional: sucesso tipado com a resposta simulada.
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(typeof result.content).toBe('string');
            expect(typeof result.model).toBe('string');
          }
          // O cliente Claude de fato usou o fetch simulado.
          expect(fetchSpy).toHaveBeenCalledTimes(1);
        } else {
          // Stubs estruturais: erro tipado de nao implementado.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBe('provider_not_implemented');
            expect(result.provider).toBe(provider);
          }
          // Nao tocou em segredo: nenhuma chamada de rede...
          expect(fetchSpy).not.toHaveBeenCalled();
          // ...e a chave nunca aparece no resultado retornado.
          expect(JSON.stringify(result)).not.toContain(SECRET_API_KEY);
        }
      }),
      { numRuns: 100 }
    );
  });
});

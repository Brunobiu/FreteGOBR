// Feature: admin-assistant, Property 14
/**
 * CP-14: Selecao e resultado tipado da Provider_Abstraction
 *
 * Para todo AiProvider configurado como Active_Provider:
 *  - `selectProviderClient(provider)` retorna o cliente cujo `id` e igual a
 *    `provider` (Req 8.4);
 *  - os clientes funcionais (`claude`, `gemini`) produzem `{ ok: true }`
 *    (com `fetch` SIMULADO, Req 8.2);
 *  - os clientes de `grok`/`llama` produzem
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

// Resposta simulada da Google Generative Language (Gemini) generateContent
// com candidates[0].content.parts[].text valido.
function makeGeminiResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      modelVersion: 'gemini-2.0-flash',
      candidates: [
        {
          content: { parts: [{ text: 'resposta simulada do Gemini' }] },
        },
      ],
    }),
  } as unknown as Response;
}

// Despacha a resposta correta com base na URL recebida pelo fetch (a Edge
// chama endpoints distintos para Anthropic e Gemini).
function dispatchSimulatedFetch(input: RequestInfo | URL): Response {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (url.includes('generativelanguage.googleapis.com')) {
    return makeGeminiResponse();
  }
  return makeClaudeResponse();
}

// ----- Mock de fetch (hoist-safe: spy exposto em globalThis) -----

let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => dispatchSimulatedFetch(input));
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

  it('claude/gemini => { ok: true } (fetch simulado); grok/llama => provider_not_implemented sem tocar segredo', async () => {
    await fc.assert(
      fc.asyncProperty(providerGen, async (provider) => {
        fetchSpy.mockClear();

        const client = selectProviderClient(provider);
        const result = await client.invoke(INPUT, SECRET_API_KEY);

        if (provider === 'claude' || provider === 'gemini') {
          // Caminho funcional: sucesso tipado com a resposta simulada.
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(typeof result.content).toBe('string');
            expect(typeof result.model).toBe('string');
          }
          // O cliente funcional de fato usou o fetch simulado.
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

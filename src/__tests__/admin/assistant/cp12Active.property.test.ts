// Feature: admin-assistant, Property 12
/**
 * CP-12: Atividade do assistente depende da presenca da chave do
 * Active_Provider
 *
 * Para toda configuracao, computeActive(config) retorna verdadeiro SE E
 * SOMENTE SE o is_set da chave do active_provider e verdadeiro. Chaves de
 * outros provedores (nao ativos) nao influenciam a atividade.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 7.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  computeActive,
  type AiProvider,
  type AssistantConfigView,
  type ProviderKeyState,
} from '../../../services/admin/assistant';

// ----- Geradores -----

const providerGen = fc.constantFrom<AiProvider>('claude', 'gemini', 'grok', 'llama');

// Estado de chave por provedor: is_set arbitrario; mascara coerente com o
// is_set (string nao vazia quando definido, null caso contrario).
const providerKeyStateGen: fc.Arbitrary<ProviderKeyState> = fc
  .boolean()
  .map((isSet) => ({ isSet, mask: isSet ? '\u2022\u2022\u2022\u2022abcd' : null }));

const thresholdsGen = fc.record({
  page_error_rate: fc.integer({ min: 1, max: 1000 }),
  request_failure_rate: fc.integer({ min: 1, max: 1000 }),
  failed_login_burst: fc.integer({ min: 1, max: 1000 }),
});

// AssistantConfigView com active_provider arbitrario e flags is_set
// independentes por provedor.
const configViewGen: fc.Arbitrary<AssistantConfigView> = fc
  .record({
    activeProvider: providerGen,
    model: fc.constantFrom('claude-3-5-sonnet-latest', 'gemini-pro', 'grok-2', 'llama-3'),
    thresholds: thresholdsGen,
    cronIntervalMinutes: fc.integer({ min: 1, max: 5 }),
    whatsappToggle: fc.boolean(),
    claude: providerKeyStateGen,
    gemini: providerKeyStateGen,
    grok: providerKeyStateGen,
    llama: providerKeyStateGen,
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  })
  .map((r) => ({
    activeProvider: r.activeProvider,
    model: r.model,
    thresholds: r.thresholds,
    cronIntervalMinutes: r.cronIntervalMinutes,
    whatsappToggle: r.whatsappToggle,
    providerKeys: {
      claude: r.claude,
      gemini: r.gemini,
      grok: r.grok,
      llama: r.llama,
    },
    updatedAt: r.updatedAt,
  }));

describe('CP-12: Atividade depende da chave do Active_Provider', () => {
  it('computeActive e verdadeiro sse is_set do active_provider', () => {
    fc.assert(
      fc.property(configViewGen, (config) => {
        const expected = config.providerKeys[config.activeProvider].isSet;
        expect(computeActive(config)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

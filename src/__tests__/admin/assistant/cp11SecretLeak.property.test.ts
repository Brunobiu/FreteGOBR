// Feature: admin-assistant, Property 11
/**
 * CP-11: Nao-vazamento de segredo em saidas legiveis
 *
 * Para toda chave de API bruta nao vazia e para todo ConfigPatch, nenhuma
 * saida destinada ao frontend ou ao audit contem o valor bruto:
 *   - getConfigView retorna apenas is_set + mascara por provedor (nunca o
 *     valor bruto, nem como campo proprio nem embutido na mascara para
 *     chaves de tamanho relevante);
 *   - maskApiKey(raw) nunca e igual ao bruto e nao contem o bruto como
 *     substring para chaves de tamanho relevante;
 *   - buildConfigAudit(patch) nao inclui valores brutos de segredo.
 *
 * Logica pura (sem Supabase, sem Vault, sem I/O), entao nao ha mocks.
 *
 * Nota: a verificacao de "raw nao aparece na serializacao" e feita para
 * chaves de tamanho relevante (>= 8 chars). Para chaves muito curtas, um
 * caractere isolado poderia colidir coincidentemente com campos nao
 * sensiveis (model, timestamp), o que nao caracteriza vazamento; nesses
 * casos validamos apenas a estrutura (is_set + mascara) e maskApiKey != raw.
 *
 * Validates: Requirements 7.4, 7.5, 14.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  maskApiKey,
  getConfigView,
  buildConfigAudit,
  type AiProvider,
  type ConfigPatch,
  type RawAssistantConfig,
} from '../../../services/admin/assistant';

// Caractere de mascara (bullet U+2022). Excluido do espaco de chaves brutas
// para que a mascara seja sempre distinguivel do bruto.
const MASK_BULLET = '\u2022';

// Tamanho a partir do qual maskApiKey revela o sufixo (4 chars). Espelha
// MASK_MIN_LEN_TO_REVEAL do service: abaixo disso a chave e mascarada
// integralmente.
const RELEVANT_KEY_LEN = 8;

const PROVIDERS: readonly AiProvider[] = ['claude', 'gemini', 'grok', 'llama'];

// ----- Geradores -----

// Chave bruta nao vazia (1..64 chars), sem o caractere de mascara para
// manter o bruto sempre distinto da mascara gerada.
const rawKeyGen = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => !s.includes(MASK_BULLET));

const providerGen = fc.constantFrom<AiProvider>('claude', 'gemini', 'grok', 'llama');

// Patch parcial de thresholds (todas as chaves opcionais).
const thresholdsPatchGen = fc.record(
  {
    page_error_rate: fc.integer({ min: 1, max: 1000 }),
    request_failure_rate: fc.integer({ min: 1, max: 1000 }),
    failed_login_burst: fc.integer({ min: 1, max: 1000 }),
  },
  { requiredKeys: [] }
);

// ConfigPatch arbitrario (todas as chaves opcionais). Nao carrega segredo
// por design; o teste confirma que o audit derivado permanece livre do bruto.
const configPatchGen: fc.Arbitrary<ConfigPatch> = fc.record(
  {
    activeProvider: providerGen,
    thresholds: thresholdsPatchGen,
    cronIntervalMinutes: fc.integer({ min: 1, max: 5 }),
    whatsappToggle: fc.boolean(),
  },
  { requiredKeys: [] }
);

describe('CP-11: Nao-vazamento de segredo em saidas legiveis', () => {
  it('getConfigView/maskApiKey/buildConfigAudit nunca expoem o valor bruto', () => {
    fc.assert(
      fc.property(rawKeyGen, providerGen, configPatchGen, (rawKey, activeProvider, patch) => {
        // Config crua com a MESMA chave bruta em todos os provedores
        // (maximiza a superficie de vazamento).
        const raw: RawAssistantConfig = {
          activeProvider,
          model: 'claude-3-5-sonnet-latest',
          thresholds: {
            page_error_rate: 10,
            request_failure_rate: 10,
            failed_login_burst: 5,
          },
          cronIntervalMinutes: 1,
          whatsappToggle: false,
          updatedAt: '2024-01-01T00:00:00.000Z',
          providerKeys: {
            claude: rawKey,
            gemini: rawKey,
            grok: rawKey,
            llama: rawKey,
          },
        };

        const view = getConfigView(raw);

        // 1) A view expoe SOMENTE is_set + mascara por provedor: nenhum campo
        //    de valor bruto, e is_set verdadeiro (chave presente).
        for (const provider of PROVIDERS) {
          const state = view.providerKeys[provider];
          expect(Object.keys(state).sort()).toEqual(['isSet', 'mask']);
          expect(state.isSet).toBe(true);
          // A mascara nunca e igual ao bruto.
          expect(state.mask).not.toBe(rawKey);
        }

        // 2) maskApiKey nunca retorna o bruto; para chaves de tamanho
        //    relevante tambem nao o contem como substring.
        const mask = maskApiKey(rawKey);
        expect(mask).not.toBe(rawKey);
        if (rawKey.length >= RELEVANT_KEY_LEN) {
          expect(mask.includes(rawKey)).toBe(false);
        }

        // 3) Nenhuma serializacao destinada ao frontend ou ao audit contem
        //    o bruto (verificado para chaves de tamanho relevante, evitando
        //    colisoes coincidentes de chaves de 1 char com campos nao
        //    sensiveis).
        const audit = buildConfigAudit(patch, view);
        if (rawKey.length >= RELEVANT_KEY_LEN) {
          expect(JSON.stringify(view).includes(rawKey)).toBe(false);
          expect(JSON.stringify(audit).includes(rawKey)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: admin-marketing, Property 7: Token ausente de qualquer payload voltado ao frontend
/**
 * CP-7 — Token ausente de toda resposta voltada ao cliente (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 7 (CP-7)
 *   - requirements.md §Padrões de Sucesso (CP-7); Reqs 3.3, 3.5, 4.2, 4.8,
 *     9.6, 9.7, 12.1, 12.2, 12.4
 *
 * Funções sob teste (src/services/admin/marketing.ts):
 *   - maskToken(token): expõe SOMENTE os últimos 4 caracteres.
 *   - getConfig(): RPC marketing_config_get → MarketingConfig (apenas
 *     token_last4 + token_is_set; nunca o valor bruto).
 *   - getMetrics(period): Edge meta-marketing-read → MetricsResult (nenhum
 *     campo de token).
 *   - mapMarketingError(err): mapeia erros estruturados das Edges sem expor
 *     segredos.
 *
 * Invariantes verificadas (para tokens arbitrários):
 *   1. maskToken NUNCA revela mais que os últimos 4 chars: comprimento
 *      preservado, prefixo só com `*`, sufixo == token.slice(-4), contagem de
 *      não-`*` == min(4, len); para len > 4 o token bruto NÃO é substring da
 *      saída mascarada.
 *   2. getConfig: mesmo que a RPC devolva (indevidamente) um campo extra com o
 *      token bruto, o mapeamento por whitelist o descarta — o payload
 *      serializado contém apenas token_last4 (Masked) + token_is_set, jamais o
 *      token bruto.
 *   3. getMetrics (sucesso): o mapeamento por whitelist do MetricsResult
 *      descarta qualquer campo rogue (ex.: access_token) — o payload serializado
 *      não contém o token bruto nem sequer a chave `token`.
 *   4. getMetrics (erro) + mapMarketingError: o erro tipado lançado/derivado a
 *      partir do contrato da Edge (que nunca inclui o token) não contém o token
 *      bruto na forma serializada (message + code + details).
 *
 * Mock hoisted de `../../../services/supabase` (convenção do projeto): spies
 * expostos via globalThis; resultados controláveis por teste. `../audit`
 * também é mockado para isolar (getConfig/getMetrics não o usam, mas marketing.ts
 * o importa).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mocks hoisted (NÃO referenciar variáveis externas no factory) -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  const invokeSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp7RpcSpy = rpcSpy;
  (globalThis as Record<string, unknown>).__cp7InvokeSpy = invokeSpy;
  return {
    supabase: {
      rpc: (name: string, args?: Record<string, unknown>) => {
        rpcSpy(name, args);
        const result = (globalThis as Record<string, unknown>).__cp7RpcResult as
          | { data?: unknown; error?: unknown }
          | undefined;
        return Promise.resolve(result ?? { data: null, error: null });
      },
      functions: {
        invoke: (name: string, opts?: Record<string, unknown>) => {
          invokeSpy(name, opts);
          const result = (globalThis as Record<string, unknown>).__cp7InvokeResult as
            | { data?: unknown; error?: unknown }
            | undefined;
          return Promise.resolve(result ?? { data: null, error: null });
        },
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => ({}),
    },
  };
});

vi.mock('../../../services/admin/audit', () => ({
  executeAdminMutation: async <T>(_input: unknown, fn: () => Promise<T>) => fn(),
  logAdminAction: async () => null,
}));

import {
  maskToken,
  getConfig,
  getMetrics,
  mapMarketingError,
  MarketingError,
  type MetricPeriod,
} from '../../../services/admin/marketing';

// ----- Helpers de controle dos mocks -----
const rpcSpy = (globalThis as Record<string, unknown>).__cp7RpcSpy as ReturnType<typeof vi.fn>;
const invokeSpy = (globalThis as Record<string, unknown>).__cp7InvokeSpy as ReturnType<
  typeof vi.fn
>;

function setRpcResult(result: { data?: unknown; error?: unknown }): void {
  (globalThis as Record<string, unknown>).__cp7RpcResult = result;
}

function setInvokeResult(result: { data?: unknown; error?: unknown }): void {
  (globalThis as Record<string, unknown>).__cp7InvokeResult = result;
}

/**
 * Serializa um MarketingError de forma abrangente: além das próprias props
 * enumeráveis (code/details), captura `message` (não-enumerável em Error) e o
 * String(err), garantindo que o token não escape por nenhuma via.
 */
function serializeError(err: unknown): string {
  if (err instanceof MarketingError) {
    return JSON.stringify({
      name: err.name,
      message: err.message,
      code: err.code,
      details: err.details,
      asString: String(err),
    });
  }
  return JSON.stringify({ asString: String(err), raw: err });
}

// ----- Geradores de token -----
// Tokens sem o caractere de máscara `*`, para que a contagem de não-`*` na
// saída mascarada seja exatamente min(4, len) sem ambiguidade. Convenção do
// projeto: fc.string({ minLength, maxLength }).filter(...).

// Tokens de qualquer comprimento (inclui <= 4 para o ramo "token inteiro visível").
const anyTokenGen = fc.string({ minLength: 0, maxLength: 60 }).filter((s) => !s.includes('*'));

// Tokens "reais" com mais de 4 chars, para os checks de vazamento de maskToken
// (substring). maskToken não interage com nenhum payload fixo, então pode ser
// puramente arbitrário.
const longTokenGen = fc.string({ minLength: 5, maxLength: 60 }).filter((s) => !s.includes('*'));

// Tokens para os checks de vazamento em getConfig/getMetrics. Prefixados com um
// sentinela distintivo que NUNCA ocorre nos valores fixos dos payloads de teste
// (datas/números/ids), tornando a verificação de "token bruto ausente" robusta
// (sem colisões coincidentes de substring). O sufixo aleatório continua
// exercitando a derivação de `token_last4`.
const leakTokenGen = fc
  .string({ minLength: 5, maxLength: 60 })
  .filter((s) => !s.includes('*'))
  .map((s) => `SECRETTOKEN_${s}`);

const periodGen = fc.constantFrom<MetricPeriod>('today', '7d', '30d');

describe('CP-7: maskToken — nunca revela mais que os últimos 4 caracteres', () => {
  it('preserva o comprimento, mascara o prefixo com `*` e expõe só os últimos 4', () => {
    fc.assert(
      fc.property(anyTokenGen, (token) => {
        const masked = maskToken(token);

        // Derivação independente da semântica "últimos 4 chars".
        const visible = token.slice(-4); // len <= 4 ⇒ token inteiro
        const maskedCount = token.length - visible.length;
        const expected = '*'.repeat(maskedCount) + visible;

        // 1. Comprimento preservado.
        expect(masked).toHaveLength(token.length);

        // 2. Saída exatamente como o esperado (prefixo `*` + sufixo visível).
        expect(masked).toBe(expected);

        // 3. Prefixo mascarado contém SOMENTE `*`.
        expect(masked.slice(0, maskedCount)).toBe('*'.repeat(maskedCount));

        // 4. Sufixo visível == token.slice(-4).
        expect(masked.slice(maskedCount)).toBe(visible);

        // 5. Contagem de chars não-`*` == min(4, len).
        const nonMaskCount = masked.split('').filter((c) => c !== '*').length;
        expect(nonMaskCount).toBe(Math.min(4, token.length));
      }),
      { numRuns: 100 }
    );
  });

  it('para tokens com mais de 4 chars, o token bruto NÃO é substring da saída mascarada', () => {
    fc.assert(
      fc.property(longTokenGen, (token) => {
        const masked = maskToken(token);
        // Mesmo comprimento e ao menos 1 char mascarado ⇒ difere do bruto ⇒
        // não pode ser substring.
        expect(masked).not.toBe(token);
        expect(masked.includes(token)).toBe(false);
        // O prefixo (tudo menos os últimos 4) é só `*`.
        expect(masked.slice(0, token.length - 4)).toBe('*'.repeat(token.length - 4));
      }),
      { numRuns: 100 }
    );
  });
});

describe('CP-7: getConfig — payload mascarado, token bruto ausente', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    invokeSpy.mockClear();
  });

  it('serializa apenas token_last4 + token_is_set; descarta qualquer token bruto rogue', async () => {
    await fc.assert(
      fc.asyncProperty(leakTokenGen, async (token) => {
        const last4 = token.slice(-4);
        // Simula o contrato da RPC marketing_config_get: só metadados mascarados.
        // Injeta campos rogue (access_token/decrypted_secret) para provar que o
        // mapeamento por whitelist os descarta (defesa em profundidade CP-7).
        setRpcResult({
          data: {
            ad_account_id: 'act_123456789',
            pixel_id: '987654321',
            default_period: '7d',
            consent_required: true,
            token_is_set: true,
            token_last4: last4,
            updated_at: '2025-01-08T12:00:00.000Z',
            updated_by: '00000000-0000-0000-0000-000000000000',
            // Campos rogue que NUNCA deveriam existir — devem ser descartados.
            access_token: token,
            decrypted_secret: token,
            token: token,
          },
          error: null,
        });

        const config = await getConfig();
        const serialized = JSON.stringify(config);

        // Expõe apenas o Masked_Token + indicador.
        expect(config.token_is_set).toBe(true);
        expect(config.token_last4).toBe(last4);

        // O token bruto (len > 4) NUNCA aparece no payload serializado.
        expect(serialized.includes(token)).toBe(false);

        // Nenhum campo rogue sobreviveu ao mapeamento por whitelist.
        expect(serialized.includes('access_token')).toBe(false);
        expect(serialized.includes('decrypted_secret')).toBe(false);

        // Chamou a RPC correta.
        expect(rpcSpy).toHaveBeenCalledWith('marketing_config_get', undefined);
      }),
      { numRuns: 100 }
    );
  });
});

describe('CP-7: getMetrics + mapMarketingError — token ausente de respostas e erros', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    invokeSpy.mockClear();
  });

  it('getMetrics (sucesso): MetricsResult não contém token bruto nem chave `access_token`', async () => {
    await fc.assert(
      fc.asyncProperty(periodGen, leakTokenGen, async (period, token) => {
        // Resposta de sucesso conforme contrato da Edge — SEM token. Injeta
        // campos rogue (access_token/token) para provar que o mapeamento por
        // whitelist do MetricsResult os descarta.
        setInvokeResult({
          data: {
            ok: true,
            period,
            range: { from: '2025-01-01T00:00:00.000Z', to: '2025-01-08T00:00:00.000Z' },
            campaign: {
              spend: 100,
              impressions: 1000,
              clicks: 50,
              leads: 5,
              conversions: 3,
              ctr: 0.05,
              cpc: 2,
              cpl: 20,
              access_token: token, // rogue
            },
            creatives: [
              {
                creative_id: 'c1',
                name: 'Criativo 1',
                spend: 10,
                impressions: 100,
                clicks: 5,
                leads: 1,
                ctr: 0.05,
                cpc: 2,
                cpl: 10,
                access_token: token, // rogue
              },
            ],
            series: [{ date: '2025-01-01', spend: 10, impressions: 100, clicks: 5 }],
            stale: false,
            fetched_at: '2025-01-08T12:00:00.000Z',
            // Campos rogue de topo — devem ser descartados.
            access_token: token,
            token: token,
          },
          error: null,
        });

        const result = await getMetrics(period);
        const serialized = JSON.stringify(result);

        // O token bruto NUNCA aparece e o MetricsResult não tem chave de token.
        expect(serialized.includes(token)).toBe(false);
        expect(serialized.includes('access_token')).toBe(false);
        // MetricsResult não possui nenhuma chave relacionada a token.
        expect(Object.keys(result)).not.toContain('token');
        expect(Object.keys(result)).not.toContain('access_token');

        expect(invokeSpy).toHaveBeenCalledWith('meta-marketing-read', { body: { period } });
      }),
      { numRuns: 100 }
    );
  });

  it('getMetrics (erro): MarketingError serializado não contém token bruto', async () => {
    await fc.assert(
      fc.asyncProperty(periodGen, leakTokenGen, async (period, token) => {
        // Erro estruturado conforme contrato — a Edge nunca inclui o token, mas
        // injetamos um campo rogue para provar que getMetrics só repassa o code.
        setInvokeResult({
          data: {
            ok: false,
            error: 'META_API_UNAVAILABLE',
            status: 503,
            access_token: token, // rogue — não deve ser repassado ao erro
          },
          error: null,
        });

        let thrown: unknown;
        try {
          await getMetrics(period);
          throw new Error('getMetrics deveria ter lançado');
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(MarketingError);
        expect((thrown as MarketingError).code).toBe('META_API_UNAVAILABLE');
        // Token bruto ausente da forma serializada do erro (message + details).
        expect(serializeError(thrown).includes(token)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('mapMarketingError: erro derivado do contrato da Edge nunca expõe o token', () => {
    const edgeErrorCodeGen = fc.constantFrom(
      'TOKEN_NOT_CONFIGURED',
      'META_API_UNAVAILABLE',
      'INVALID_PERIOD',
      'INVALID_METRICS',
      'PERMISSION_DENIED'
    );
    fc.assert(
      fc.property(edgeErrorCodeGen, leakTokenGen, (code, token) => {
        // Contrato: erros das Edges carregam só o código (sem token). O
        // MarketingError mapeado nunca contém o token bruto.
        const mapped = mapMarketingError({ error: code, status: 503 });
        expect(mapped).toBeInstanceOf(MarketingError);
        expect(serializeError(mapped).includes(token)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

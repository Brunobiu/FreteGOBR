/**
 * CP-1: getMetrics e deterministica para o mesmo input + mesma resposta da RPC
 *
 * Para todo (filters, rpcResponse) mockado, executar getMetrics(filters)
 * duas vezes consecutivas (sem mutacoes intermediarias) retorna o mesmo
 * Dashboard_Metrics_Bundle, descontando meta.generatedAt (que reflete NOW()).
 *
 * Validates: Requirements 11.1, 11.2, CP-1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock de supabase.rpc — retorna jsonb fixo determinado por filters
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp1RpcSpy = rpcSpy;
  // Estado controlavel pelo teste para a resposta determinada do rpc
  (globalThis as Record<string, unknown>).__cp1Response = null;

  return {
    supabase: {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        const fixed = (globalThis as Record<string, unknown>).__cp1Response;
        return { data: fixed, error: null };
      }),
    },
  };
});

import {
  getMetrics,
  type DashboardFilters,
  type DashboardMetricsBundle,
} from '../../../services/admin/dashboard';

const rpcSpy = (globalThis as Record<string, unknown>).__cp1RpcSpy as ReturnType<typeof vi.fn>;

function setRpcResponse(value: unknown) {
  (globalThis as Record<string, unknown>).__cp1Response = value;
}

// ----- Geradores -----

const periodGen = fc.constantFrom('today', '7d', '30d');
const userTypeGen = fc.constantFrom('all', 'motorista', 'embarcador');
const ufGen = fc.option(fc.constantFrom('SP', 'RJ', 'MG', 'GO', 'BA'), { nil: null });

const filtersGen: fc.Arbitrary<DashboardFilters> = fc
  .tuple(periodGen, userTypeGen, ufGen)
  .map(([period, userType, uf]) => ({
    period: period as DashboardFilters['period'],
    from: null,
    to: null,
    userType: userType as DashboardFilters['userType'],
    uf: uf as DashboardFilters['uf'],
  }));

// Gerador de bundle "raw" (snake_case) representando resposta da RPC

function buildSampleSeries(days: number) {
  return Array.from({ length: days }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    value: i * 2,
  }));
}

const kpiGen = fc.record({
  value: fc.integer({ min: 0, max: 100000 }),
  previous_value: fc.integer({ min: 0, max: 100000 }),
});

const rawResponseGen = fc
  .record({
    days: fc.integer({ min: 1, max: 7 }),
    usuariosAtivos: kpiGen,
    novosCadastros: kpiGen,
    fretesAtivos: kpiGen,
    fretesPostados: kpiGen,
    fretesEncerrados: kpiGen,
    volumeTransacionado: kpiGen,
  })
  .map((r) => {
    const days = r.days;
    const series = buildSampleSeries(days);
    return {
      meta: {
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-07T23:59:59Z',
        user_type: 'all',
        uf: null,
        previous_from: '2024-12-25T00:00:00Z',
        previous_to: '2025-01-01T00:00:00Z',
        days,
        generated_at: '2025-01-08T12:00:00Z',
      },
      kpis: {
        usuarios_ativos: r.usuariosAtivos,
        novos_cadastros: r.novosCadastros,
        fretes_ativos: r.fretesAtivos,
        fretes_postados: r.fretesPostados,
        fretes_encerrados: r.fretesEncerrados,
        taxa_conversao_pct: { value: 50, previous_value: 45 },
        volume_transacionado: r.volumeTransacionado,
        logins_admin: { value: 10, previous_value: 8 },
        alertas_seguranca_24h: { value: 2, previous_value: 1 },
      },
      series: {
        cadastros_motoristas: series,
        cadastros_embarcadores: series,
        fretes_postados: series,
        fretes_encerrados: series,
        volume_diario: series,
      },
      geo: {
        fretes_ativos: [{ uf: 'SP', count: 10 }],
        usuarios_ativos: [{ uf: 'SP', motoristas: 5, embarcadores: 3, total: 8 }],
      },
      security_alerts: {
        items: [
          {
            action: 'ADMIN_LOGIN_FAILURE',
            count: 3,
            last_at: '2025-01-08T11:00:00Z',
            sample_target_id: 'abc',
          },
        ],
      },
      top_embarcadores: {
        items: [
          {
            id: 'e1',
            name: 'Embarcador 1',
            volume_total: 1000,
            fretes_encerrados: 5,
          },
        ],
      },
      top_motoristas: {
        items: [
          {
            id: 'm1',
            name: 'Motorista 1',
            cliques: 10,
            curtidas: 5,
            total: 15,
          },
        ],
      },
      top_rotas: {
        items: [
          {
            origin: 'goiania, go',
            destination: 'sao paulo, sp',
            label: 'goiania, go → sao paulo, sp',
            count: 7,
          },
        ],
      },
    };
  });

/**
 * Strip de campos volateis (NAO determinados pelo input).
 * meta.generatedAt vem de NOW() na RPC; zeramos para comparacao.
 */
function stripVolatile(b: DashboardMetricsBundle): unknown {
  const { meta, ...rest } = b;
  return {
    ...rest,
    meta: { ...meta, generatedAt: '<stripped>' },
  };
}

describe('CP-1: getMetrics e deterministica', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    setRpcResponse(null);
  });

  it('duas chamadas consecutivas com mesmo filters + mesma resposta RPC = mesmo bundle', async () => {
    await fc.assert(
      fc.asyncProperty(filtersGen, rawResponseGen, async (filters, raw) => {
        rpcSpy.mockClear();
        setRpcResponse(raw);

        const r1 = await getMetrics(filters);
        const r2 = await getMetrics(filters);

        expect(stripVolatile(r1)).toStrictEqual(stripVolatile(r2));

        // RPC chamada 2x (sem cache embutido — cache fica no Page)
        expect(rpcSpy).toHaveBeenCalledTimes(2);
        for (const call of rpcSpy.mock.calls) {
          expect(call[0]).toBe('admin_dashboard_metrics');
        }
      }),
      { numRuns: 30 }
    );
  }, 20000);
});

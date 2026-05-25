/**
 * CP-2: degradacao parcial — bloco corrompido nao derruba os demais
 *
 * Para todo bundle bruto valido `B` e bloco-alvo `K`:
 *   - se substituirmos B[K] por null/undefined, o bundle adaptado tem:
 *     a) bundle.errors[K mapeado] preenchido OU bloco null silenciosamente
 *        (no caso de gating server-side de FINANCEIRO/AUDIT)
 *     b) os demais blocos continuam populados normalmente
 *     c) nenhuma exception e lancada
 *
 * Validates: Requirements 9.5, 9.7, 16.6, CP-2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp2RpcSpy = rpcSpy;
  (globalThis as Record<string, unknown>).__cp2Response = null;
  return {
    supabase: {
      rpc: vi.fn(async () => {
        const fixed = (globalThis as Record<string, unknown>).__cp2Response;
        return { data: fixed, error: null };
      }),
    },
  };
});

import { getMetrics, type DashboardFilters } from '../../../services/admin/dashboard';

function setRpcResponse(value: unknown) {
  (globalThis as Record<string, unknown>).__cp2Response = value;
}

const FILTERS: DashboardFilters = {
  period: '7d',
  from: null,
  to: null,
  userType: 'all',
  uf: null,
};

function buildSeries() {
  return Array.from({ length: 7 }, (_, i) => ({
    date: `2025-01-0${i + 1}`,
    value: i,
  }));
}

function buildValidRaw() {
  const series = buildSeries();
  const kpi = { value: 100, previous_value: 80 };
  return {
    meta: {
      from: '2025-01-01T00:00:00Z',
      to: '2025-01-07T23:59:59Z',
      user_type: 'all',
      uf: null,
      previous_from: '2024-12-25T00:00:00Z',
      previous_to: '2025-01-01T00:00:00Z',
      days: 7,
      generated_at: '2025-01-08T12:00:00Z',
    },
    kpis: {
      usuarios_ativos: kpi,
      novos_cadastros: kpi,
      fretes_ativos: kpi,
      fretes_postados: kpi,
      fretes_encerrados: kpi,
      taxa_conversao_pct: kpi,
      volume_transacionado: kpi,
      logins_admin: kpi,
      alertas_seguranca_24h: kpi,
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
      items: [{ id: 'e1', name: 'E1', volume_total: 1000, fretes_encerrados: 5 }],
    },
    top_motoristas: {
      items: [{ id: 'm1', name: 'M1', cliques: 10, curtidas: 5, total: 15 }],
    },
    top_rotas: {
      items: [
        {
          origin: 'a',
          destination: 'b',
          label: 'a → b',
          count: 1,
        },
      ],
    },
  };
}

type CorruptionTarget = 'kpis' | 'series' | 'geo' | 'top_motoristas' | 'top_rotas';

const targetGen = fc.constantFrom<CorruptionTarget>(
  'kpis',
  'series',
  'geo',
  'top_motoristas',
  'top_rotas'
);

function corrupt(raw: ReturnType<typeof buildValidRaw>, target: CorruptionTarget) {
  const copy: Record<string, unknown> = { ...raw };
  copy[target] = null;
  return copy;
}

describe('CP-2: degradacao parcial', () => {
  beforeEach(() => {
    setRpcResponse(null);
  });

  it('sub-objeto null preenche errors[bloco] e nao quebra os demais', async () => {
    await fc.assert(
      fc.asyncProperty(targetGen, async (target) => {
        const valid = buildValidRaw();
        const corrupted = corrupt(valid, target);
        setRpcResponse(corrupted);

        // NAO deve lancar
        const bundle = await getMetrics(FILTERS);

        // Bloco corrompido refletido em errors
        if (target === 'kpis') {
          expect(bundle.errors.kpis).toBeDefined();
        } else if (target === 'series') {
          expect(bundle.errors.cadastros).toBeDefined();
          expect(bundle.errors.fretes).toBeDefined();
        } else if (target === 'geo') {
          expect(bundle.errors.geo).toBeDefined();
        } else if (target === 'top_motoristas') {
          expect(bundle.errors.top_motoristas).toBeDefined();
        } else if (target === 'top_rotas') {
          expect(bundle.errors.top_rotas).toBeDefined();
        }

        // Demais blocos continuam populados (quando nao corrompidos)
        if (target !== 'kpis') {
          expect(bundle.kpis.usuariosAtivos.value).toBe(100);
          expect(bundle.errors.kpis).toBeUndefined();
        }
        if (target !== 'series') {
          expect(bundle.series.cadastrosMotoristas.length).toBe(7);
          expect(bundle.errors.cadastros).toBeUndefined();
          expect(bundle.errors.fretes).toBeUndefined();
        }
        if (target !== 'geo') {
          expect(bundle.geo.fretesAtivos.length).toBe(1);
          expect(bundle.errors.geo).toBeUndefined();
        }
        if (target !== 'top_motoristas') {
          expect(bundle.topMotoristas.items.length).toBe(1);
          expect(bundle.errors.top_motoristas).toBeUndefined();
        }
        if (target !== 'top_rotas') {
          expect(bundle.topRotas.items.length).toBe(1);
          expect(bundle.errors.top_rotas).toBeUndefined();
        }
      }),
      { numRuns: 20 }
    );
  }, 15000);

  it('quando RPC retorna null/undefined inteiro, ainda gera bundle vazio sem exception', async () => {
    setRpcResponse(null);
    const bundle = await getMetrics(FILTERS);
    // Sub-objetos vem zerados / vazios, mas nao explode
    expect(bundle.kpis.usuariosAtivos.value).toBe(0);
    expect(bundle.series.cadastrosMotoristas).toEqual([]);
    expect(bundle.geo.fretesAtivos).toEqual([]);
    expect(bundle.topMotoristas.items).toEqual([]);
  });
});

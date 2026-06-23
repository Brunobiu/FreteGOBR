// Feature: admin-rastreamento-inteligente — Funnel_Metrics helpers (unit).
//
// Cobre clamp01 (não-finito / negativo / >1) e computeFunnelMetrics com
// contagens degeneradas (zeros / não-finitas) — ramos não exercitados pelo CP7.
//
// Validates: Requirements 8.4, 8.6, 8.7

import { describe, it, expect } from 'vitest';

import {
  clamp01,
  computeFunnelMetrics,
  aggregateFunnelCounts,
  type StageCounts,
} from '../../../services/admin/rastreamento/funnelMetrics';
import { FUNNEL_ORDER } from '../../../services/admin/rastreamento/domain';

describe('clamp01', () => {
  it('clampa não-finito ⇒ 0, negativo ⇒ 0, >1 ⇒ 1, dentro ⇒ identidade', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});

describe('computeFunnelMetrics — bordas', () => {
  it('todas as contagens zero ⇒ todas as taxas 0, sem erro', () => {
    const counts = {} as StageCounts;
    for (const s of FUNNEL_ORDER) counts[s] = 0;
    const m = computeFunnelMetrics(counts);
    expect(m.overall_conversion_rate).toBe(0);
    expect(m.retention_rate).toBe(0);
    expect(m.churn_rate).toBe(0);
    expect(m.activation_rate).toBe(0);
    for (const s of FUNNEL_ORDER) {
      expect(m.stage_conversion_rate[s]).toBe(0);
      expect(m.stage_abandonment_rate[s]).toBe(0);
    }
  });

  it('contagens não-finitas são tratadas como 0 (countOf guard)', () => {
    const counts = {} as StageCounts;
    for (const s of FUNNEL_ORDER) counts[s] = Number.NaN;
    const m = computeFunnelMetrics(counts);
    expect(m.overall_conversion_rate).toBe(0);
  });
});

describe('aggregateFunnelCounts', () => {
  it('contagem cumulativa: usuário na etapa X conta em 0..X', () => {
    const counts = aggregateFunnelCounts(['VISITOR', 'SUBSCRIPTION_PAID', 'RECURRING_USER']);
    expect(counts.VISITOR).toBe(3); // todos passam pelo topo
    expect(counts.SUBSCRIPTION_PAID).toBe(2); // SUBSCRIPTION_PAID + RECURRING_USER
    expect(counts.RECURRING_USER).toBe(1);
  });
});

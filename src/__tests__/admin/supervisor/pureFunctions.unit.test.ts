/**
 * Exemplos/edge do núcleo puro da IA Supervisora (admin-ia-supervisora).
 * Complementa as property tests CP1–CP5/CP8/CP9 com casos concretos.
 */

import { describe, it, expect } from 'vitest';
import { classifySeverity, notifyImmediately } from '../../../services/admin/supervisor/severityClassifier';
import {
  detectAnomalies,
  reconcileInsights,
  anomalyDedupKey,
} from '../../../services/admin/supervisor/anomalyDetector';
import { applyInsightOp } from '../../../services/admin/supervisor/insightLifecycle';
import { buildSummaryText, summaryDedupKey } from '../../../services/admin/supervisor/summaryBuilder';
import { compareInsights, compareDiagnostics } from '../../../services/admin/supervisor/ordering';
import { planIntents } from '../../../services/admin/supervisor/questionContextPlan';
import { sanitizeSupervisorDetail } from '../../../services/admin/supervisor/sanitize';
import { expectNoSecrets } from '../../_helpers/logAssertions';

describe('severityClassifier — exemplos', () => {
  it('módulo crítico => CRITICAL; comum baixo => WARNING default', () => {
    expect(classifySeverity({ module: 'financeiro', occurrenceCount: 1 })).toBe('CRITICAL');
    expect(classifySeverity({ module: 'whatsapp', occurrenceCount: 1 })).toBe('WARNING');
    expect(classifySeverity({ module: 'whatsapp', severity: 'INFO', occurrenceCount: 1 })).toBe('INFO');
    expect(classifySeverity({ module: 'whatsapp', occurrenceCount: 25, criticalThreshold: 20 })).toBe('CRITICAL');
    expect(notifyImmediately('CRITICAL')).toBe(true);
    expect(notifyImmediately('INFO')).toBe(false);
  });
});

describe('anomalyDetector — exemplos', () => {
  it('diagnóstico acima do threshold vira ANOMALY com dedupKey estável', () => {
    const out = detectAnomalies({
      diagnostics: [{ dedupKey: 'whatsapp:send:TIMEOUT', module: 'whatsapp', occurrenceCount: 7 }],
      config: { errorThreshold: 5 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].dedupKey).toBe(anomalyDedupKey('whatsapp:send:TIMEOUT'));
    expect(out[0].insightType).toBe('ANOMALY');
  });
  it('abaixo do threshold => nenhuma anomalia', () => {
    expect(
      detectAnomalies({
        diagnostics: [{ dedupKey: 'k', module: 'whatsapp', occurrenceCount: 2 }],
        config: { errorThreshold: 5 },
      })
    ).toEqual([]);
  });
  it('reconcile: situação extinta vai para toDismiss', () => {
    const plan = reconcileInsights([{ dedupKey: 'ANOMALY:diagnostic:x', state: 'OPEN' }], []);
    expect(plan.toDismiss).toEqual(['ANOMALY:diagnostic:x']);
  });
});

describe('insightLifecycle — exemplos', () => {
  it('ack OPEN => ACKNOWLEDGED; ack DISMISSED => invalid_transition', () => {
    expect(
      applyInsightOp({ state: 'OPEN', updatedAt: 't' }, { kind: 'ack', expectedUpdatedAt: 't', nextUpdatedAt: 'u' }).effect
    ).toBe('transition');
    expect(
      applyInsightOp({ state: 'DISMISSED', updatedAt: 't' }, { kind: 'ack', expectedUpdatedAt: 't', nextUpdatedAt: 'u' }).effect
    ).toBe('invalid_transition');
  });
});

describe('summaryBuilder — exemplos', () => {
  it('texto pt-BR + dedupKey', () => {
    expect(buildSummaryText({ signups: 37, subscriptions: 12, ticketsOpen: 3, alertsOpen: 2 })).toBe(
      'Resumo do dia: 37 novos cadastros, 12 assinaturas ativas, 3 atendimentos abertos, 2 alertas para sua atenção.'
    );
    expect(summaryDedupKey('daily', '2026-06-19')).toBe('SUMMARY:daily:2026-06-19');
  });
});

describe('ordering — empates', () => {
  it('mesma severidade => created_at desc; depois id', () => {
    const a = { id: 'a', severity: 'WARNING' as const, createdAt: '2026-06-19T10:00:00Z' };
    const b = { id: 'b', severity: 'WARNING' as const, createdAt: '2026-06-19T12:00:00Z' };
    expect(compareInsights(a, b)).toBeGreaterThan(0); // b (mais novo) vem antes
    expect(compareDiagnostics({ id: 'a', lastSeenAt: 't' }, { id: 'b', lastSeenAt: 't' })).toBeLessThan(0);
  });
});

describe('planIntents — exemplos', () => {
  it('combina múltiplos intents na ordem de CONTEXT_INTENTS', () => {
    const out = planIntents('quantos usuários e quantas assinaturas hoje?');
    expect(out).toEqual(['USERS', 'SUBSCRIPTIONS']);
  });
});

describe('sanitizeSupervisorDetail — não-vazamento', () => {
  it('remove chaves sensíveis e redige valores PII; preserva números', () => {
    const out = sanitizeSupervisorDetail({
      count: 5,
      email: 'a@b.com',
      note: 'cliente joao@x.com ligou',
      nested: { token: 'eyJ' + 'a'.repeat(14) + '.' + 'b'.repeat(14) + '.' + 'c'.repeat(14), n: 3 },
    });
    expect(out.count).toBe(5);
    expect(out.email).toBeUndefined();
    expect((out.nested as Record<string, unknown>).token).toBeUndefined();
    expect((out.nested as Record<string, unknown>).n).toBe(3);
    expectNoSecrets(out);
  });
  it('entrada não-objeto => {}', () => {
    expect(sanitizeSupervisorDetail(null)).toEqual({});
    expect(sanitizeSupervisorDetail('x')).toEqual({});
    expect(sanitizeSupervisorDetail([1, 2])).toEqual({});
  });
});

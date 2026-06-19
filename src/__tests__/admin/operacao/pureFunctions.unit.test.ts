// Unit (exemplo/edge) das funções puras de operacao.
// Spec: .kiro/specs/admin-central-operacao (Task 2.17).

import { describe, it, expect } from 'vitest';
import { adaptOperationsBundle, buildKpi } from '../../../services/admin/operacao/metricsShape';
import {
  initRefresh,
  reduce,
  REFRESH_FLOOR_MS,
} from '../../../services/admin/operacao/realtimeRefresh';
import { evaluate, ALERT_SEVERITY_MAP } from '../../../services/admin/operacao/alertEvaluator';
import { compareAlerts, compareLogs } from '../../../services/admin/operacao/ordering';
import { LOG_EVENT_LABEL, resolveActionCodes } from '../../../services/admin/operacao/logEventMap';

const CFG = {
  now: '2026-06-19T12:00:00Z',
  expiringWindowDays: 3,
  awaitingThresholdMin: 30,
  integrationFailureThreshold: 1,
};

describe('metricsShape', () => {
  it('buildKpi: fonte indisponível => {value:null, available:false}', () => {
    expect(buildKpi(null)).toEqual({ value: null, available: false });
    expect(buildKpi({ value: 0, available: false })).toEqual({ value: null, available: false });
    expect(buildKpi({ value: 42, available: true })).toEqual({ value: 42, available: true });
  });

  it('adaptOperationsBundle: USERS_ONLINE sem fonte => indisponível (nunca 0)', () => {
    const b = adaptOperationsBundle({
      kpis: { USERS_TOTAL: { value: 10, available: true }, USERS_ONLINE: { value: null, available: false } },
    });
    expect(b.kpis.USERS_TOTAL).toEqual({ value: 10, available: true });
    expect(b.kpis.USERS_ONLINE).toEqual({ value: null, available: false });
  });

  it('adaptOperationsBundle: grupo em errors zera os KPIs do grupo', () => {
    const b = adaptOperationsBundle({
      kpis: { MESSAGES_SENT: { value: 5, available: true } },
      errors: { messages: 'Bloco indisponível.' },
    });
    expect(b.kpis.MESSAGES_SENT).toEqual({ value: null, available: false });
    expect(b.errors.messages).toBe('Bloco indisponível.');
  });
});

describe('realtimeRefresh', () => {
  it('piso de intervalo (edge 4.5)', () => {
    expect(initRefresh(1_000).intervalMs).toBe(REFRESH_FLOOR_MS);
    expect(initRefresh(60_000).intervalMs).toBe(60_000);
  });
  it('tick pausado quando aba oculta', () => {
    let s = initRefresh(REFRESH_FLOOR_MS);
    s = reduce(s, { kind: 'visibility', visible: false }).state;
    const dec = reduce(s, { kind: 'tick', deltaMs: 999_999 });
    expect(dec.startFetch).toBe(false);
  });
  it('tick visível além do intervalo dispara 1 fetch; durante in-flight não dispara', () => {
    let s = initRefresh(REFRESH_FLOOR_MS);
    const d1 = reduce(s, { kind: 'tick', deltaMs: REFRESH_FLOOR_MS });
    expect(d1.startFetch).toBe(true);
    s = d1.state;
    const d2 = reduce(s, { kind: 'tick', deltaMs: REFRESH_FLOOR_MS });
    expect(d2.startFetch).toBe(false); // já em voo
  });
});

describe('alertEvaluator: cada um dos 6 tipos com fonte concreta', () => {
  it('WHATSAPP_DISCONNECTED', () => {
    const out = evaluate({ whatsappSessions: [{ instanceId: 'i1', status: 'DISCONNECTED' }], config: CFG });
    expect(out).toEqual([
      { alertType: 'WHATSAPP_DISCONNECTED', source: { sourceType: 'whatsapp_session', sourceId: 'i1' }, severity: 'CRITICAL' },
    ]);
  });
  it('CAMPAIGN_PAUSED + CAMPAIGN_ERROR', () => {
    const out = evaluate({
      dispatchJobs: [{ dispatchId: 'd1', status: 'PAUSED' }, { dispatchId: 'd2', status: 'FAILED' }],
      config: CFG,
    });
    expect(out.map((s) => s.alertType).sort()).toEqual(['CAMPAIGN_ERROR', 'CAMPAIGN_PAUSED']);
    expect(ALERT_SEVERITY_MAP.CAMPAIGN_ERROR).toBe('CRITICAL');
    expect(ALERT_SEVERITY_MAP.CAMPAIGN_PAUSED).toBe('WARNING');
  });
  it('INTEGRATION_FAILURE (>= threshold)', () => {
    const out = evaluate({ integrations: [{ key: 'asaas', failures: 3 }], config: CFG });
    expect(out[0]?.alertType).toBe('INTEGRATION_FAILURE');
  });
  it('SUBSCRIPTION_EXPIRING (dentro da janela)', () => {
    const out = evaluate({
      subscriptions: [
        { userId: 'u1', status: 'active', nextChargeAt: '2026-06-20T00:00:00Z' }, // dentro de 3 dias
        { userId: 'u2', status: 'active', nextChargeAt: '2026-07-30T00:00:00Z' }, // fora
      ],
      config: CFG,
    });
    expect(out.map((s) => s.source.sourceId)).toEqual(['u1']);
  });
  it('CUSTOMER_AWAITING (acima do threshold, não terminal)', () => {
    const out = evaluate({
      awaitingTickets: [
        { ticketId: 't1', state: 'in_progress', waitingMinutes: 45 },
        { ticketId: 't2', state: 'resolved', waitingMinutes: 999 },
      ],
      config: CFG,
    });
    expect(out.map((s) => s.source.sourceId)).toEqual(['t1']);
  });
});

describe('ordering: empates', () => {
  it('compareAlerts desempata por id quando severidade+lastSeenAt iguais', () => {
    const a = { id: 'a', severity: 'WARNING' as const, lastSeenAt: 'x' };
    const b = { id: 'b', severity: 'WARNING' as const, lastSeenAt: 'x' };
    expect(compareAlerts(a, b)).toBeLessThan(0);
  });
  it('compareLogs ordena occurred_at desc', () => {
    const older = { id: '1', occurredAt: '2026-06-18T00:00:00Z', eventType: 'LOGIN' };
    const newer = { id: '2', occurredAt: '2026-06-19T00:00:00Z', eventType: 'LOGIN' };
    expect(compareLogs(newer, older)).toBeLessThan(0); // newer vem antes
  });
});

describe('logEventMap: rótulos pt-BR + dependências futuras', () => {
  it('rótulos fixos', () => {
    expect(LOG_EVENT_LABEL.LOGIN).toBe('Login realizado');
    expect(LOG_EVENT_LABEL.HUMAN_TAKEOVER).toBe('Atendimento humano assumiu');
  });
  it('LOGOUT/CLIENT_CREATED sem emissor => []', () => {
    expect(resolveActionCodes('LOGOUT')).toEqual([]);
    expect(resolveActionCodes('CLIENT_CREATED')).toEqual([]);
    expect(resolveActionCodes('LOGIN')).toContain('ADMIN_LOGIN_SUCCESS');
  });
});

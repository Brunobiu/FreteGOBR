/**
 * Geradores fast-check locais da Central de Operação (admin-central-operacao).
 * Reusam os helpers canônicos de _helpers/generators (uuidLike/safeText) e
 * `fc.constantFrom` para domínios fechados (project-conventions).
 */

import fc from 'fast-check';
import { uuidLike, safeText } from '../../_helpers/generators';
import {
  OPERATIONS_KPI_KEYS,
  type OperationsGroupKey,
} from '../../../services/admin/operacao/metricsShape';
import type { RefreshEvent } from '../../../services/admin/operacao/realtimeRefresh';
import { LOG_EVENT_TYPES } from '../../../services/admin/operacao/logEventMap';
import type { AlertSeverity, EvaluatorInput } from '../../../services/admin/operacao/alertEvaluator';

export const kpiKeyGen = fc.constantFrom(...OPERATIONS_KPI_KEYS);
export const groupGen = fc.constantFrom<OperationsGroupKey>(
  'users',
  'subscriptions',
  'tickets',
  'messages'
);
export const rawKpiGen = fc.record({
  value: fc.option(fc.nat({ max: 100_000 }), { nil: null }),
  available: fc.boolean(),
});

export const refreshEventGen: fc.Arbitrary<RefreshEvent> = fc.oneof(
  fc.record({ kind: fc.constant('tick' as const), deltaMs: fc.integer({ min: -5_000, max: 120_000 }) }),
  fc.record({ kind: fc.constant('visibility' as const), visible: fc.boolean() }),
  fc.constant({ kind: 'manual' as const }),
  fc.constant({ kind: 'request_done' as const })
);

export const logEventTypeGen = fc.constantFrom(...LOG_EVENT_TYPES);
export const severityGen = fc.constantFrom<AlertSeverity>('CRITICAL', 'WARNING', 'INFO');

// ── Alert evaluator snapshot ──
const sessionGen = fc.record({
  instanceId: uuidLike(),
  status: fc.constantFrom('DISCONNECTED', 'EXPIRED', 'CONNECTED', 'QR_PENDING'),
});
const jobGen = fc.record({
  dispatchId: uuidLike(),
  status: fc.constantFrom('PAUSED', 'FAILED', 'RUNNING', 'COMPLETED', 'DRAFT'),
});
const integrationGen = fc.record({ key: safeText(2, 12), failures: fc.nat({ max: 10 }) });
const subGen = fc.record({
  userId: uuidLike(),
  status: fc.constantFrom('active', 'past_due', 'canceled'),
  nextChargeAt: fc.option(
    fc.constantFrom('2026-06-20T00:00:00Z', '2026-07-30T00:00:00Z', '2025-01-01T00:00:00Z'),
    { nil: null }
  ),
});
const ticketGen = fc.record({
  ticketId: uuidLike(),
  state: fc.constantFrom('open', 'in_progress', 'resolved', 'closed', 'waiting_customer'),
  waitingMinutes: fc.nat({ max: 120 }),
});

/** Snapshot do Alert_Evaluator; arrays opcionais (undefined = módulo ausente). */
export const evaluatorInputGen: fc.Arbitrary<EvaluatorInput> = fc.record({
  whatsappSessions: fc.option(fc.array(sessionGen, { maxLength: 5 }), { nil: undefined }),
  dispatchJobs: fc.option(fc.array(jobGen, { maxLength: 5 }), { nil: undefined }),
  integrations: fc.option(fc.array(integrationGen, { maxLength: 5 }), { nil: undefined }),
  subscriptions: fc.option(fc.array(subGen, { maxLength: 5 }), { nil: undefined }),
  awaitingTickets: fc.option(fc.array(ticketGen, { maxLength: 5 }), { nil: undefined }),
  config: fc.constant({
    now: '2026-06-19T12:00:00Z',
    expiringWindowDays: 3,
    awaitingThresholdMin: 30,
    integrationFailureThreshold: 1,
  }),
});

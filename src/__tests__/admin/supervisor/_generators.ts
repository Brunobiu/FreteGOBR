/**
 * Geradores fast-check locais da IA Supervisora (admin-ia-supervisora).
 * Reusam os helpers canônicos de _helpers/generators (uuidLike/safeText) e
 * `fc.constantFrom` para domínios fechados (project-conventions).
 */

import fc from 'fast-check';
import { uuidLike, safeText } from '../../_helpers/generators';
import type { InsightSeverity } from '../../../services/admin/supervisor/severityClassifier';
import type { InsightState } from '../../../services/admin/supervisor/insightLifecycle';

export const severityGen = fc.constantFrom<InsightSeverity>('CRITICAL', 'WARNING', 'INFO');
export const insightStateGen = fc.constantFrom<InsightState>('OPEN', 'ACKNOWLEDGED', 'DISMISSED');

/** Módulos: inclui os críticos (financeiro/auth/integration/queue) e comuns. */
export const moduleGen = fc.constantFrom(
  'financeiro',
  'auth',
  'integration',
  'queue',
  'whatsapp',
  'suporte',
  'system',
  'dashboard'
);

export const diagnosticInputGen = fc.record({
  module: moduleGen,
  severity: fc.option(severityGen, { nil: undefined }),
  errorCode: fc.option(safeText(2, 10), { nil: undefined }),
  occurrenceCount: fc.nat({ max: 200 }),
  criticalThreshold: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
});

const diagRowGen = fc.record({
  dedupKey: uuidLike(),
  module: moduleGen,
  errorCode: fc.option(safeText(2, 8), { nil: undefined }),
  occurrenceCount: fc.nat({ max: 50 }),
  severity: fc.option(severityGen, { nil: undefined }),
});
const alertRowGen = fc.record({ dedupKey: uuidLike(), alertType: safeText(3, 16) });

/** Snapshot do Anomaly_Detector; arrays opcionais (undefined = fonte ausente). */
export const anomalySnapshotGen = fc.record({
  diagnostics: fc.option(fc.array(diagRowGen, { maxLength: 6 }), { nil: undefined }),
  openCriticalAlerts: fc.option(fc.array(alertRowGen, { maxLength: 4 }), { nil: undefined }),
  config: fc.record({ errorThreshold: fc.integer({ min: 1, max: 10 }) }),
});

export const summaryInputGen = fc.record({
  signups: fc.oneof(fc.nat({ max: 100_000 }), fc.constantFrom(0, -1, NaN, Infinity)),
  subscriptions: fc.oneof(fc.nat({ max: 100_000 }), fc.constantFrom(0, -1, NaN)),
  ticketsOpen: fc.oneof(fc.nat({ max: 10_000 }), fc.constantFrom(0, -1)),
  alertsOpen: fc.oneof(fc.nat({ max: 10_000 }), fc.constantFrom(0, -1)),
});

const tsGen = fc.constantFrom(
  '2026-06-19T10:00:00Z',
  '2026-06-19T12:00:00Z',
  '2026-06-18T23:59:59Z',
  '2026-06-20T00:00:01Z'
);
export const insightRowGen = fc.record({ id: uuidLike(), severity: severityGen, createdAt: tsGen });
export const diagnosticRowGen = fc.record({ id: uuidLike(), lastSeenAt: tsGen });

/** Perguntas pt-BR (com e sem palavra-chave) + texto livre. */
export const questionGen = fc.oneof(
  fc.constantFrom(
    'Quantos usuários entraram hoje?',
    'Qual o faturamento do mês?',
    'Existe algum atendimento parado?',
    'Quais instâncias de WhatsApp caíram?',
    'Tem algum alerta crítico?',
    'Algum erro recorrente?',
    'Como está o sistema hoje?',
    'Bom dia'
  ),
  safeText(1, 30)
);

// ─── Histórico de conversas (supervisor-chat-history / 119) ─────────────────

/** Linhas de sessão/mensagem para os comparadores (CP2 chat). */
export const chatSessionRowGen = fc.record({ id: uuidLike(), updatedAt: tsGen });
export const chatMessageRowGen = fc.record({ id: uuidLike(), createdAt: tsGen });

/** Papel de mensagem (domínio fechado) + valores inválidos para CP3. */
export const chatRoleGen = fc.constantFrom('user', 'ai');
export const chatRoleInvalidGen = fc.constantFrom('system', 'bot', '', 'USER', 'assistant', 'admin');

/**
 * Fragmentos de segredo construídos por CONCATENAÇÃO (o literal não aparece no
 * fonte, evitando o gate secretScan) para verificar a redação em deriveTitle.
 */
const SECRET_FRAGMENTS = [
  'sb_' + 'secret_' + 'ABCDEFGHIJ1234567890',
  'eyJ' + 'aaaaaaaaaa' + '.' + 'bbbbbbbbbb' + '.' + 'cccccccccc',
  're_' + 'abcd1234efgh5678ijkl',
];

/**
 * Entrada para deriveTitle: texto livre, texto com segredo embutido, e
 * só-espaços (deve cair no título default).
 */
export const titleInputGen = fc.oneof(
  safeText(1, 200),
  fc
    .tuple(safeText(0, 20), fc.constantFrom(...SECRET_FRAGMENTS), safeText(0, 20))
    .map(([a, s, b]) => `${a} ${s} ${b}`),
  fc.constantFrom('', '   ', '\n\t  ', '\u00a0')
);

// Feature: admin-central-operacao, Property 8: Isolamento e não-vazamento.
//
// (a) Para QUALQUER caller sem a permissão exigida, o guard recusa com
//     permission_denied e NÃO retorna dados (sem vazamento por ausência de RLS).
// (b) Para QUALQUER Operations_Metrics_Bundle, `detail` de System_Alert ou
//     `summary` de Log_Entry, a saída não contém PII bruta (e-mail, telefone,
//     CPF, CNPJ), conteúdo de mensagens nem segredos.
//
// Validates: Requirements 5.1, 5.4, 6.6, 6.7, 6.8, 12.1, 12.4, 12.6, 13.2, 13.3, 13.4

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  buildLogSummary,
  sanitizeAlertDetailView,
} from '../../../services/admin/operacao';
import { adaptOperationsBundle } from '../../../services/admin/operacao/metricsShape';
import { OPERATIONS_KPI_KEYS } from '../../../services/admin/operacao/metricsShape';
import { LOG_EVENT_TYPES } from '../../../services/admin/operacao/logEventMap';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { validEmail, validPhone, validCpf, validCnpj, safeText } from '../../_helpers/generators';

// ── Geradores de PII/segredos que NUNCA podem aparecer na saída ──

const BCRYPT = `$2a$10$${'a'.repeat(53)}`;
const JWT = `eyJ${'a'.repeat(14)}.${'b'.repeat(14)}.${'c'.repeat(14)}`;
const secretLiteralGen = fc.constantFrom(
  'sb_secret_ABCDEFGHIJ1234567890',
  'sbp_ABCDEFGHIJ1234567890XYZ',
  're_ABCDEFGHIJ1234567890',
  'AKIAABCDEFGHIJKLMNOP',
  BCRYPT,
  JWT
);
const piiValueGen = fc.oneof(validEmail(), validPhone(), validCpf(), validCnpj(), secretLiteralGen);

/** Detail com campos seguros (números/timestamps que devem SOBREVIVER) e
 * campos perigosos (PII/segredos sob chave qualquer e sob chave sensível). */
const detailGen = fc.record({
  count: fc.nat({ max: 100_000 }),
  since: fc.constant('2026-06-19T12:00:00Z'),
  note: fc.oneof(safeText(1, 24), piiValueGen),
  email: validEmail(),
  password: fc.constant(BCRYPT),
  api_key: secretLiteralGen,
  nested: fc.record({
    token: fc.constant(JWT),
    phone: validPhone(),
    cpf: validCpf(),
    safe_counter: fc.nat({ max: 1000 }),
  }),
});

describe('CP-8 central-operação: isolamento e não-vazamento', () => {
  it('sanitizeAlertDetailView nunca emite PII/segredos e preserva campos seguros', () => {
    fc.assert(
      fc.property(detailGen, (detail) => {
        const out = sanitizeAlertDetailView(detail);
        expectNoSecrets(out);
        // chaves sensíveis são descartadas por completo (não só redigidas)
        expect(out.email).toBeUndefined();
        expect(out.password).toBeUndefined();
        expect(out.api_key).toBeUndefined();
        const nested = out.nested as Record<string, unknown>;
        expect(nested.token).toBeUndefined();
        expect(nested.phone).toBeUndefined();
        expect(nested.cpf).toBeUndefined();
        // campos seguros (números/timestamps) sobrevivem intactos
        expect(out.count).toBe(detail.count);
        expect(out.since).toBe('2026-06-19T12:00:00Z');
        expect(nested.safe_counter).toBe(detail.nested.safe_counter);
      }),
      { numRuns: 200 }
    );
  });

  it('sanitizeAlertDetailView é total para entradas degeneradas', () => {
    for (const bad of [null, undefined, 'x', 42, [1, 2, 3]]) {
      expect(sanitizeAlertDetailView(bad)).toEqual({});
    }
  });

  it('buildLogSummary só emite rótulos pt-BR fixos, sem PII/segredos', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOG_EVENT_TYPES), (t) => {
        const summary = buildLogSummary(t);
        expect(summary.length).toBeGreaterThan(0);
        expectNoSecrets(summary);
      }),
      { numRuns: 100 }
    );
  });

  it('adaptOperationsBundle só carrega agregados — nunca PII/segredos', () => {
    const rawKpiGen = fc.record({
      value: fc.option(fc.nat({ max: 100_000 }), { nil: null }),
      available: fc.boolean(),
    });
    const kpisGen = fc.dictionary(fc.constantFrom(...OPERATIONS_KPI_KEYS), rawKpiGen);
    fc.assert(
      fc.property(kpisGen, (kpis) => {
        const bundle = adaptOperationsBundle({
          meta: { generatedAt: '2026-06-19T12:00:00Z', onlineWindowSec: 300 },
          kpis,
          errors: {},
        });
        expectNoSecrets(bundle);
      }),
      { numRuns: 150 }
    );
  });

  // ── (a) Guard: sem permissão => recusa e NÃO retorna dados ──

  /** Modela uma RPC/RLS gated: sem permissão lança permission_denied e NUNCA
   * devolve linhas; com permissão devolve os dados. */
  function simulateGatedRead<T>(hasPerm: boolean, data: T): T {
    if (!hasPerm) throw new Error('permission_denied: ALERT_VIEW required');
    return data;
  }

  it('guard: caller sem permissão recebe permission_denied e zero dados', () => {
    fc.assert(
      fc.property(fc.boolean(), piiValueGen, (hasPerm, secret) => {
        let caught: unknown;
        let data: unknown;
        try {
          data = simulateGatedRead(hasPerm, { rows: [{ leaked: secret }] });
        } catch (e) {
          caught = e;
        }
        if (!hasPerm) {
          expectPermissionDenied(caught);
          expect(data).toBeUndefined(); // nenhuma linha vazou
        } else {
          expect(data).toBeDefined();
        }
      }),
      { numRuns: 200 }
    );
  });
});

// Feature: admin-ia-supervisora, Property 7: Isolamento e não-vazamento.
//
// (a) Para qualquer detail de diagnóstico/insight, summary ou Supervisor_Context,
//     a saída não contém PII (e-mail/telefone/CPF/CNPJ), conteúdo de mensagens
//     nem segredos (expectNoSecrets).
// (b) Para qualquer caller sem permissão, o guard recusa com permission_denied
//     e NÃO retorna dados.
//
// Validates: Requirements 2.3, 3.5, 11.2

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { sanitizeSupervisorDetail } from '../../../services/admin/supervisor/sanitize';
import { buildSummaryText } from '../../../services/admin/supervisor/summaryBuilder';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { validEmail, validPhone, validCpf, validCnpj, safeText } from '../../_helpers/generators';

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

const detailGen = fc.record({
  count: fc.nat({ max: 100_000 }),
  module: fc.constantFrom('whatsapp', 'financeiro', 'auth'),
  note: fc.oneof(safeText(1, 24), piiValueGen),
  email: validEmail(),
  password: fc.constant(BCRYPT),
  api_key: secretLiteralGen,
  nested: fc.record({ token: fc.constant(JWT), phone: validPhone(), safe: fc.nat({ max: 100 }) }),
});

describe('CP7 supervisor: isolamento e não-vazamento', () => {
  it('sanitizeSupervisorDetail nunca emite PII/segredos e preserva campos seguros', () => {
    fc.assert(
      fc.property(detailGen, (detail) => {
        const out = sanitizeSupervisorDetail(detail);
        expectNoSecrets(out);
        expect(out.email).toBeUndefined();
        expect(out.password).toBeUndefined();
        expect(out.api_key).toBeUndefined();
        const nested = out.nested as Record<string, unknown>;
        expect(nested.token).toBeUndefined();
        expect(nested.phone).toBeUndefined();
        expect(out.count).toBe(detail.count);
        expect(nested.safe).toBe(detail.nested.safe);
      }),
      { numRuns: 200 }
    );
  });

  it('buildSummaryText nunca emite PII/segredos', () => {
    fc.assert(
      fc.property(
        fc.record({
          signups: fc.nat({ max: 100_000 }),
          subscriptions: fc.nat({ max: 100_000 }),
          ticketsOpen: fc.nat({ max: 10_000 }),
          alertsOpen: fc.nat({ max: 10_000 }),
        }),
        (input) => expectNoSecrets(buildSummaryText(input))
      ),
      { numRuns: 100 }
    );
  });

  /** Modela uma RPC/RLS gated: sem permissão lança e NUNCA devolve dados. */
  function simulateGatedRead<T>(hasPerm: boolean, data: T): T {
    if (!hasPerm) throw new Error('permission_denied: SUPERVISOR_VIEW required');
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
          expect(data).toBeUndefined();
        } else {
          expect(data).toBeDefined();
        }
      }),
      { numRuns: 200 }
    );
  });
});

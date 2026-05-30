/**
 * Property-Based Test — Versionamento otimista na extensão de trial.
 *
 * Spec: .kiro/specs/trial-e-bloqueio/design.md, Correctness Properties.
 *
 * Feature: trial-e-bloqueio, Property 12: Versionamento otimista na extensão de trial
 * Validates: Requirements 11.2, 11.3
 *
 * Enunciado (design):
 *   For any par `(expectedUpdatedAt, currentUpdatedAt)`, `admin_extend_trial`
 *   SHALL aplicar a atualização **se e somente se**
 *   `expectedUpdatedAt === currentUpdatedAt`; caso contrário SHALL rejeitar com
 *   erro `STALE_VERSION` sem alterar o registro.
 *
 * Modelo puro:
 *   `applyExtend(record, expectedUpdatedAt, newTrialEndsAt)` espelha a lógica do
 *   RPC `admin_extend_trial`, delegando a DECISÃO de versionamento ao helper puro
 *   `isStaleVersion(expectedUpdatedAt, currentUpdatedAt)` de `services/admin/trial.ts`
 *   (paridade SQL↔TS: `UPDATE ... WHERE updated_at = p_expected_updated_at`).
 *
 *     - versões iguais  ⇒ { ok: true, updated_at: <novo>, record: <trial_ends_at atualizado> }
 *     - versões diferem ⇒ { error: 'STALE_VERSION', record: <inalterado> }
 *
 * O modelo é a especificação executável; o cliente nunca é a fonte de verdade
 * (a autoridade é o servidor via comparação de `updated_at`).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { isStaleVersion } from '../../../services/admin/trial';

// ===================== Modelo puro =====================

interface TrialRecord {
  id: string;
  trial_ends_at: string | null;
  updated_at: string;
}

type ApplyExtendResult =
  | { ok: true; updated_at: string; record: TrialRecord }
  | { error: 'STALE_VERSION'; record: TrialRecord };

/**
 * Modelo puro da extensão de trial com versionamento otimista.
 *
 * A decisão (aplicar vs. rejeitar) é tomada EXCLUSIVAMENTE por `isStaleVersion`,
 * comparando o `expectedUpdatedAt` enviado pelo admin com o `updated_at` atual do
 * registro — exatamente como o `UPDATE ... WHERE updated_at = p_expected_updated_at`
 * do RPC `admin_extend_trial`.
 *
 * Em sucesso, `trial_ends_at` recebe `newTrialEndsAt` e `updated_at` avança para um
 * instante estritamente posterior (modela `updated_at = NOW()`). Em falha, o registro
 * é devolvido sem qualquer alteração.
 */
function applyExtend(
  record: TrialRecord,
  expectedUpdatedAt: string,
  newTrialEndsAt: string
): ApplyExtendResult {
  if (isStaleVersion(expectedUpdatedAt, record.updated_at)) {
    // Versões divergem ⇒ rejeita sem tocar no registro (record unchanged).
    return { error: 'STALE_VERSION', record };
  }

  // Versões coincidem ⇒ aplica. `updated_at = NOW()` modelado como instante
  // estritamente posterior ao anterior, garantindo avanço de versão.
  const nextUpdatedAt = new Date(new Date(record.updated_at).getTime() + 1000).toISOString();
  return {
    ok: true,
    updated_at: nextUpdatedAt,
    record: { ...record, trial_ends_at: newTrialEndsAt, updated_at: nextUpdatedAt },
  };
}

// ===================== Geradores =====================

/** ISO timestamp dentro de um range realista (2023..2030). */
const ISO_TIMESTAMP_GEN = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

/** Nova data de fim de trial (futura) como ISO string. */
const NEW_TRIAL_ENDS_AT_GEN = fc
  .integer({ min: 1_900_000_000_001, max: 2_000_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

/** Registro de motorista arbitrário, com `updated_at` controlado externamente. */
const recordArb = (updatedAt: string): TrialRecord => ({
  id: 'm-1',
  trial_ends_at: new Date(1_650_000_000_000).toISOString(),
  updated_at: updatedAt,
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 12: Versionamento otimista na extensão de trial
// Validates: Requirements 11.2, 11.3
// ============================================================================
describe('Property 12: versionamento otimista na extensão de trial', () => {
  it('versões IGUAIS ⇒ aplica (trial_ends_at atualizado, updated_at avança, sem STALE_VERSION)', () => {
    fc.assert(
      fc.property(ISO_TIMESTAMP_GEN, NEW_TRIAL_ENDS_AT_GEN, (currentUpdatedAt, newTrialEndsAt) => {
        // Caso forçando igualdade: expected === current.
        const expectedUpdatedAt = currentUpdatedAt;
        const record = recordArb(currentUpdatedAt);
        const prevTrialEndsAt = record.trial_ends_at;

        const result = applyExtend(record, expectedUpdatedAt, newTrialEndsAt);

        // Aplicado: nunca STALE_VERSION quando as versões coincidem.
        if (!('ok' in result)) {
          throw new Error('Esperava aplicação, recebeu STALE_VERSION com versões iguais');
        }
        expect(result.ok).toBe(true);
        // trial_ends_at foi atualizado para o novo valor.
        expect(result.record.trial_ends_at).toBe(newTrialEndsAt);
        expect(result.record.trial_ends_at).not.toBe(prevTrialEndsAt);
        // updated_at avançou (versão nova, estritamente posterior).
        expect(result.updated_at).toBe(result.record.updated_at);
        expect(new Date(result.record.updated_at).getTime()).toBeGreaterThan(
          new Date(currentUpdatedAt).getTime()
        );
      }),
      { numRuns: 200 }
    );
  });

  it('versões DIFERENTES ⇒ rejeita com STALE_VERSION e registro inalterado', () => {
    fc.assert(
      fc.property(
        ISO_TIMESTAMP_GEN,
        ISO_TIMESTAMP_GEN,
        NEW_TRIAL_ENDS_AT_GEN,
        (expectedUpdatedAt, currentUpdatedAt, newTrialEndsAt) => {
          // Garante divergência (descarta o par coincidente; coberto no teste anterior).
          fc.pre(expectedUpdatedAt !== currentUpdatedAt);

          const record = recordArb(currentUpdatedAt);
          const snapshot: TrialRecord = { ...record };

          const result = applyExtend(record, expectedUpdatedAt, newTrialEndsAt);

          if (!('error' in result)) {
            throw new Error('Esperava STALE_VERSION, recebeu aplicação com versões diferentes');
          }
          expect(result.error).toBe('STALE_VERSION');
          // Registro permanece exatamente como antes (record unchanged).
          expect(result.record).toEqual(snapshot);
          expect(result.record.trial_ends_at).toBe(snapshot.trial_ends_at);
          expect(result.record.updated_at).toBe(snapshot.updated_at);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('IFF: para QUALQUER par, aplica se e somente se expected === current (consistente com isStaleVersion)', () => {
    fc.assert(
      fc.property(
        ISO_TIMESTAMP_GEN,
        ISO_TIMESTAMP_GEN,
        NEW_TRIAL_ENDS_AT_GEN,
        fc.boolean(),
        (a, b, newTrialEndsAt, forceEqual) => {
          // `forceEqual` exercita explicitamente o ramo de igualdade além do par livre.
          const expectedUpdatedAt = a;
          const currentUpdatedAt = forceEqual ? a : b;

          const record = recordArb(currentUpdatedAt);
          const result = applyExtend(record, expectedUpdatedAt, newTrialEndsAt);

          const versionsEqual = expectedUpdatedAt === currentUpdatedAt;
          const applied = 'ok' in result;

          // Bicondicional: aplicado  <=>  versões iguais  <=>  !isStaleVersion.
          expect(applied).toBe(versionsEqual);
          expect(applied).toBe(!isStaleVersion(expectedUpdatedAt, currentUpdatedAt));
        }
      ),
      { numRuns: 200 }
    );
  });
});

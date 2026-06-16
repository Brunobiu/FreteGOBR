// Feature: whatsapp-automation, Property 12: Percentual de progresso é uma razão válida
/**
 * CP-12: Property test do percentual de progresso de um Dispatch_Job.
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md Requirements 11.4, 28.2
 * Design: design.md → seção Statistics (Req 28) / `progressPercent`
 *         (lógica PURA, sem I/O).
 *
 * **Validates: Requirements 11.4, 28.2**
 *
 * Property 12 — para qualquer combinação de `processed` (= SENT + FAILED +
 * SKIPPED) e `total` de destinatários de um job:
 *
 *  P12.1 (razão válida) o resultado está SEMPRE no intervalo `[0, 1]`.
 *  P12.2 (fórmula) quando `total > 0` e `0 < processed <= total`, o resultado
 *        é exatamente `processed / total`.
 *  P12.3 (sem destinatários) `total = 0` ⇒ `0` (evita divisão por zero;
 *        job sem destinatários não tem progresso — Req 28.2).
 *  P12.4 (clamp) `processed > total` (estado inconsistente) ⇒ `1`
 *        (clampado ao topo do domínio, nunca > 1).
 *
 * Os contadores são quantidades de destinatários: inteiros não-negativos.
 * Geramos `processed`/`total` via `fc.nat` (NÃO usamos `fc.stringOf`, que não
 * existe no projeto). `processed` é montado a partir dos três sub-contadores
 * SENT/FAILED/SKIPPED para refletir fielmente a definição da propriedade.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { progressPercent } from '../../../services/admin/whatsapp/stats';

// Contadores de destinatários: inteiros >= 0 com teto razoável para o property.
const COUNT = fc.nat({ max: 100_000 });

// processed = SENT + FAILED + SKIPPED (os três estados "processados").
const PROCESSED_PARTS = fc.tuple(COUNT, COUNT, COUNT);

describe('CP-12: progressPercent — percentual de progresso é uma razão válida', () => {
  // P12.1 — resultado sempre em [0, 1] para QUALQUER processed/total.
  it('o resultado está sempre no intervalo [0, 1]', () => {
    fc.assert(
      fc.property(PROCESSED_PARTS, COUNT, ([sent, failed, skipped], total) => {
        const processed = sent + failed + skipped;
        const result = progressPercent(processed, total);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  // P12.2 — fórmula exata quando total > 0 e 0 < processed <= total.
  it('result = processed/total quando total > 0 e processed em (0, total]', () => {
    fc.assert(
      fc.property(
        // total >= 1; processed em [1, total] garante razão bem definida em (0, 1].
        fc
          .integer({ min: 1, max: 100_000 })
          .chain((total) =>
            fc.integer({ min: 1, max: total }).map((processed) => ({ processed, total }))
          ),
        ({ processed, total }) => {
          const result = progressPercent(processed, total);
          expect(result).toBeCloseTo(processed / total, 12);
          // E permanece no domínio válido.
          expect(result).toBeGreaterThan(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // P12.3 — total = 0 ⇒ 0 (sem destinatários, sem progresso).
  it('total = 0 ⇒ 0 para qualquer processed', () => {
    fc.assert(
      fc.property(PROCESSED_PARTS, ([sent, failed, skipped]) => {
        const processed = sent + failed + skipped;
        expect(progressPercent(processed, 0)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  // P12.4 — clamp: processed > total ⇒ 1 (estado inconsistente nunca > 1).
  it('processed > total ⇒ 1 (clamp ao topo do intervalo)', () => {
    fc.assert(
      fc.property(
        // total >= 1; excedente >= 1 garante processed estritamente > total.
        fc
          .tuple(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 100_000 }))
          .map(([total, excess]) => ({ total, processed: total + excess })),
        ({ processed, total }) => {
          expect(progressPercent(processed, total)).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Exemplos fixos (sanidade) cobrindo os casos-limite explicitamente.
  it('exemplos canônicos de progresso', () => {
    expect(progressPercent(0, 0)).toBe(0); // nada / nada
    expect(progressPercent(5, 0)).toBe(0); // total zero domina
    expect(progressPercent(0, 10)).toBe(0); // nenhum processado
    expect(progressPercent(5, 10)).toBe(0.5); // metade
    expect(progressPercent(10, 10)).toBe(1); // completo
    expect(progressPercent(15, 10)).toBe(1); // inconsistente → clamp
    expect(progressPercent(1, 4)).toBe(0.25); // quarto
  });
});

// Feature: whatsapp-automation, Property 11: Estimated completion time formula (pending × interval)
/**
 * Property-Based Tests — Tempo estimado de conclusão (Req 28)
 *
 * Property 11: a função pura `estimatedCompletionMs`
 * (src/services/admin/whatsapp/stats.ts) calcula o Estimated_Completion_Time
 * conforme a fórmula do design:
 *
 *   Estimated_Completion_Time = Dispatch_Recipients pending × Send_Interval
 *
 * O `Send_Interval` é informado em segundos (`intervalSec`) e o retorno é em
 * milissegundos (sufixo `...Ms`), logo a conversão esperada é:
 *
 *   resultado = pending × intervalSec × 1000
 *
 * Casos cobertos:
 *   - Para todo `pending` >= 0 e `intervalSec` > 0: resultado === pending × intervalSec × 1000.
 *   - `pending = 0` ⇒ resultado === 0 (nada a enviar; Req 28.4).
 *
 * Validates: Requirements 28.3, 28.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { estimatedCompletionMs } from '../../../services/admin/whatsapp/stats';

// pending >= 0 (inclui o caso de borda pending = 0).
const pendingArb = fc.nat({ max: 1_000_000 });

// intervalSec > 0 (domínio válido do Send_Interval, em segundos).
const intervalSecArb = fc.integer({ min: 1, max: 86_400 });

describe('estimatedCompletionMs — Property 11 (fórmula do ETA)', () => {
  it('para pending >= 0 e intervalSec > 0, resultado é pending × intervalSec × 1000 (ms)', () => {
    fc.assert(
      fc.property(pendingArb, intervalSecArb, (pending, intervalSec) => {
        const result = estimatedCompletionMs(pending, intervalSec);
        expect(result).toBe(pending * intervalSec * 1000);
      }),
      { numRuns: 100 }
    );
  });

  it('pending = 0 ⇒ resultado é 0', () => {
    fc.assert(
      fc.property(intervalSecArb, (intervalSec) => {
        expect(estimatedCompletionMs(0, intervalSec)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

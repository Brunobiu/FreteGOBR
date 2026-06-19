// Feature: admin-central-operacao, Property 2: Não-sobreposição do Realtime_Refresh.
//
// Para qualquer sequência de eventos, reduce NUNCA emite startFetch com inFlight=true
// (<= 1 requisição em voo); atualizações automáticas só com aba visível e após
// intervalMs >= REFRESH_FLOOR_MS; manual zera o temporizador.
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  initRefresh,
  reduce,
  REFRESH_FLOOR_MS,
  type RefreshState,
} from '../../../services/admin/operacao/realtimeRefresh';
import { refreshEventGen } from './_generators';

describe('CP-2 operações: não-sobreposição do Realtime_Refresh', () => {
  it('nunca mais de 1 requisição em voo; manual zera o timer; piso de intervalo', () => {
    const scenario = fc.record({
      intervalMs: fc.oneof(
        fc.integer({ min: -5_000, max: 120_000 }),
        fc.constantFrom(0, 1_000, REFRESH_FLOOR_MS, 30_000)
      ),
      events: fc.array(refreshEventGen, { maxLength: 40 }),
    });

    fc.assert(
      fc.property(scenario, ({ intervalMs, events }) => {
        let state: RefreshState = initRefresh(intervalMs);
        expect(state.intervalMs).toBeGreaterThanOrEqual(REFRESH_FLOOR_MS); // piso (Req 4.5)
        let inFlight = 0;

        for (const ev of events) {
          const dec = reduce(state, ev);
          if (dec.startFetch) {
            expect(state.inFlight).toBe(false); // nunca inicia com requisição em voo
            inFlight += 1;
            expect(inFlight).toBeLessThanOrEqual(1);
          }
          if (ev.kind === 'request_done') inFlight = 0; // requisição concluída
          if (ev.kind === 'manual') expect(dec.state.elapsedMs).toBe(0); // manual reinicia o timer
          // intervalMs nunca cai abaixo do piso
          expect(dec.state.intervalMs).toBeGreaterThanOrEqual(REFRESH_FLOOR_MS);
          state = dec.state;
        }
      }),
      { numRuns: 200 }
    );
  });
});

/**
 * operacao/realtimeRefresh.ts — máquina determinística do Realtime_Refresh.
 *
 * Decide QUANDO iniciar uma requisição de métricas garantindo UMA única em voo
 * (CP2), pausa por visibilidade da aba e reinicia o temporizador no refresh
 * manual. Sem I/O — a página fornece os ticks/eventos.
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.3).
 */

export const REFRESH_FLOOR_MS = 10_000; // piso de seguranca (Req 4.5)
export const DEFAULT_INTERVAL_MS = 30_000; // valor inicial (Req 4.1)

export interface RefreshState {
  intervalMs: number; // sempre >= REFRESH_FLOOR_MS
  elapsedMs: number; // tempo desde o ultimo start (so corre quando visivel)
  visible: boolean;
  inFlight: boolean; // ha uma requisicao de metricas em voo
}

export type RefreshEvent =
  | { kind: 'tick'; deltaMs: number }
  | { kind: 'visibility'; visible: boolean }
  | { kind: 'manual' }
  | { kind: 'request_done' };

export interface RefreshDecision {
  state: RefreshState;
  startFetch: boolean;
}

export function initRefresh(intervalMs = DEFAULT_INTERVAL_MS): RefreshState {
  return {
    intervalMs: Math.max(REFRESH_FLOOR_MS, intervalMs),
    elapsedMs: 0,
    visible: true,
    inFlight: false,
  };
}

/** Único ponto que pode emitir startFetch; nunca o faz com inFlight=true (CP2). */
export function reduce(state: RefreshState, event: RefreshEvent): RefreshDecision {
  switch (event.kind) {
    case 'visibility':
      return { state: { ...state, visible: event.visible }, startFetch: false };
    case 'tick': {
      if (!state.visible) return { state, startFetch: false }; // pausado (Req 4.2)
      const elapsedMs = state.elapsedMs + Math.max(0, event.deltaMs);
      if (elapsedMs >= state.intervalMs && !state.inFlight) {
        // dispara 1 em voo (Req 4.3)
        return { state: { ...state, elapsedMs: 0, inFlight: true }, startFetch: true };
      }
      return { state: { ...state, elapsedMs }, startFetch: false };
    }
    case 'manual': {
      if (state.inFlight) return { state: { ...state, elapsedMs: 0 }, startFetch: false }; // reinicia timer; sem sobrepor
      return { state: { ...state, elapsedMs: 0, inFlight: true }, startFetch: true }; // imediato + reinicia (Req 4.4)
    }
    case 'request_done':
      return { state: { ...state, inFlight: false }, startFetch: false };
  }
}

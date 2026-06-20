/**
 * supervisor/insightLifecycle.ts — redutor puro do ciclo ack/dismiss (alvo de CP4).
 *
 * Modela OPEN → ACKNOWLEDGED → DISMISSED espelhando a semântica das RPCs
 * supervisor_insight_acknowledge / supervisor_insight_dismiss (sem I/O):
 *   - ack de ACKNOWLEDGED / dismiss de DISMISSED ⇒ _SKIPPED (sem mutar);
 *   - expected_updated_at divergente ⇒ STALE (sem mutar);
 *   - DISMISSED é terminal (ack de DISMISSED ⇒ INVALID_STATE_TRANSITION);
 *   - a checagem de estado (skip/invalid) precede a de versão, igual à RPC.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.3).
 */

export type InsightState = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED';
export type InsightOpKind = 'ack' | 'dismiss';

export interface InsightLifecycleState {
  state: InsightState;
  updatedAt: string;
}

export interface InsightOp {
  kind: InsightOpKind;
  /** Versão otimista que o caller acredita ser a atual. */
  expectedUpdatedAt: string;
  /** updated_at que a transição efetiva gravaria (now()). */
  nextUpdatedAt: string;
}

export type InsightOpEffect = 'transition' | 'skipped' | 'stale' | 'invalid_transition';

export interface InsightOpResult {
  effect: InsightOpEffect;
  state: InsightLifecycleState; // inalterado salvo em 'transition'
  reason?: 'ALREADY_ACKNOWLEDGED' | 'ALREADY_DISMISSED';
}

/** Aplica uma operação ao estado, retornando o efeito e o estado resultante. */
export function applyInsightOp(
  current: InsightLifecycleState,
  op: InsightOp
): InsightOpResult {
  if (op.kind === 'ack') {
    if (current.state === 'ACKNOWLEDGED')
      return { effect: 'skipped', state: current, reason: 'ALREADY_ACKNOWLEDGED' };
    if (current.state === 'DISMISSED') return { effect: 'invalid_transition', state: current };
    // state === 'OPEN'
    if (op.expectedUpdatedAt !== current.updatedAt) return { effect: 'stale', state: current };
    return { effect: 'transition', state: { state: 'ACKNOWLEDGED', updatedAt: op.nextUpdatedAt } };
  }
  // kind === 'dismiss'
  if (current.state === 'DISMISSED')
    return { effect: 'skipped', state: current, reason: 'ALREADY_DISMISSED' };
  // state === 'OPEN' | 'ACKNOWLEDGED'
  if (op.expectedUpdatedAt !== current.updatedAt) return { effect: 'stale', state: current };
  return { effect: 'transition', state: { state: 'DISMISSED', updatedAt: op.nextUpdatedAt } };
}

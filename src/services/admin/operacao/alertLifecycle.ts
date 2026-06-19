/**
 * operacao/alertLifecycle.ts — redutor puro do ciclo de ack/resolve (alvo de CP6).
 *
 * Modela OPEN → ACKNOWLEDGED → RESOLVED espelhando a semântica das RPCs
 * admin_alert_acknowledge / admin_alert_resolve (sem I/O):
 *   - ack de ACKNOWLEDGED / resolve de RESOLVED ⇒ _SKIPPED (sem mutar);
 *   - expected_updated_at divergente ⇒ STALE_VERSION (sem mutar);
 *   - RESOLVED é terminal (ack de RESOLVED ⇒ INVALID_STATE_TRANSITION; não volta);
 *   - a checagem de estado (skip/invalid) precede a de versão, igual à RPC.
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.9).
 */

import type { AlertState } from './alertEvaluator';

export type AlertOpKind = 'ack' | 'resolve';

export interface AlertLifecycleState {
  state: AlertState;
  updatedAt: string;
}

export interface AlertOp {
  kind: AlertOpKind;
  /** Versão otimista que o caller acredita ser a atual. */
  expectedUpdatedAt: string;
  /** updated_at que a transição efetiva gravaria (now()). */
  nextUpdatedAt: string;
}

export type AlertOpEffect = 'transition' | 'skipped' | 'stale' | 'invalid_transition';

export interface AlertOpResult {
  effect: AlertOpEffect;
  state: AlertLifecycleState; // estado resultante (inalterado salvo em 'transition')
  reason?: 'ALREADY_ACKNOWLEDGED' | 'ALREADY_RESOLVED';
}

/** Aplica uma operação ao estado, retornando o efeito e o estado resultante. */
export function applyAlertOp(current: AlertLifecycleState, op: AlertOp): AlertOpResult {
  if (op.kind === 'ack') {
    if (current.state === 'ACKNOWLEDGED')
      return { effect: 'skipped', state: current, reason: 'ALREADY_ACKNOWLEDGED' };
    if (current.state === 'RESOLVED') return { effect: 'invalid_transition', state: current };
    // state === 'OPEN'
    if (op.expectedUpdatedAt !== current.updatedAt) return { effect: 'stale', state: current };
    return { effect: 'transition', state: { state: 'ACKNOWLEDGED', updatedAt: op.nextUpdatedAt } };
  }
  // kind === 'resolve'
  if (current.state === 'RESOLVED')
    return { effect: 'skipped', state: current, reason: 'ALREADY_RESOLVED' };
  // state === 'OPEN' | 'ACKNOWLEDGED'
  if (op.expectedUpdatedAt !== current.updatedAt) return { effect: 'stale', state: current };
  return { effect: 'transition', state: { state: 'RESOLVED', updatedAt: op.nextUpdatedAt } };
}

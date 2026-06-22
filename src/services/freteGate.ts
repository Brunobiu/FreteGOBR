/**
 * Camada pura de gating da conversa de frete.
 *
 * Converte o estado do frete vinculado à conversa em uma decisão de UI
 * (`FreteGate`) e na aparência do selo de status (`BadgeView`). Todas as
 * funções são puras (sem I/O) e isoladas para permitir property-based testing
 * sem montar componente React. Badge, bloqueio de input e drag-and-drop derivam
 * exclusivamente destas funções, garantindo consistência entre os canais.
 */

import type { FreteStatus, FreteSource } from './fretes';

/** Decisão de UI derivada do estado do frete da conversa. */
export type FreteGate = 'active' | 'blocked' | 'unknown';

/** Aparência do Status_Badge derivada do gate. */
export interface BadgeView {
  label: string;
  /** classes Tailwind (tema escuro via overrides globais do index.css). */
  className: string;
}

/**
 * Mapeador puro central. Converte o status do frete (ou `null` quando
 * indisponível) na decisão de gating da conversa.
 *  - `null`                      → `'unknown'` (Status_Indisponivel)
 *  - `'ativo'`                   → `'active'`
 *  - `'encerrado'` | `'cancelado'` → `'blocked'`
 */
export function freteStatusToGate(status: FreteStatus | null): FreteGate {
  if (status === null) return 'unknown';
  return status === 'ativo' ? 'active' : 'blocked';
}

/**
 * Disponibilidade do frete vinculado à conversa, resolvida no servidor pela
 * RPC `get_conversation_chat_state` (SECURITY DEFINER). Diferente do caminho
 * antigo (`getFreteStatus` + RLS do feed), esta fonte enxerga o estado REAL do
 * frete mesmo para o motorista — que não conseguiria ler por SELECT direto um
 * frete não-`ativo` (a RLS do feed só expõe `status='ativo'`). É isso que
 * permite o bloqueio refletir nos DOIS lados da conversa.
 */
export interface FreteAvailability {
  /** A conversa está vinculada a um frete? (`false` ⇒ sem gating, `unknown`). */
  linked: boolean;
  /** O frete ainda está disponível para negociação (`status='ativo'`)? */
  available: boolean;
}

/**
 * Mapeia a disponibilidade autoritativa do frete na decisão de gating.
 *  - `null` ou não vinculado          → `'unknown'` (não bloqueia, fail-safe)
 *  - vinculado e disponível            → `'active'`
 *  - vinculado e indisponível          → `'blocked'`
 *    (excluído/encerrado/cancelado — reflete para motorista E embarcador)
 */
export function availabilityToGate(state: FreteAvailability | null): FreteGate {
  if (!state || !state.linked) return 'unknown';
  return state.available ? 'active' : 'blocked';
}

/**
 * Resolve o status efetivo considerando a origem do frete. Frete Comunidade
 * (`source === 'comunidade'`) nunca bloqueia — é tratado como indisponível,
 * assim como a ausência de informação (`info === null`).
 */
export function effectiveStatus(
  info: { status: FreteStatus; source?: FreteSource | null } | null
): FreteStatus | null {
  if (!info) return null;
  if (info.source === 'comunidade') return null;
  return info.status;
}

/** `true` se a conversa deve bloquear o input. Bloqueia somente em `'blocked'`. */
export function isInputBlocked(gate: FreteGate): boolean {
  return gate === 'blocked';
}

/**
 * Mapeia o gate para a aparência do Status_Badge.
 *  - `'active'`  → verde "Ativo"
 *  - `'blocked'` → vermelho "Desativado"
 *  - `'unknown'` → `null` (badge omitido)
 */
export function gateToBadge(gate: FreteGate): BadgeView | null {
  switch (gate) {
    case 'active':
      return { label: 'Ativo', className: 'bg-green-100 text-green-700 border border-green-200' };
    case 'blocked':
      return {
        label: 'Indisponível',
        className: 'bg-red-100 text-red-700 border border-red-200',
      };
    case 'unknown':
      return null;
  }
}

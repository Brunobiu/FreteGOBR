/**
 * SuporteBadges — badges de status e prioridade (padrão compacto, tema escuro).
 *
 * SuporteStatusBadge usa STATUS_DISPLAY_MAP (rótulo pt-BR + marcador).
 * SuportePriorityBadge destaca o Nível 3 (alta prioridade) imediatamente (Req 10.8).
 */

import { STATUS_DISPLAY_MAP, type TicketStatus } from '../../../services/admin/suporte/statusMachine';
import type { PriorityLevel } from '../../../services/admin/suporte/priorityClassifier';
import type { ResponderMode } from '../../../services/admin/suporte/responderModeReducer';

const STATUS_BADGE_CLS: Record<TicketStatus, string> = {
  open: 'bg-green-500/15 text-green-300 border-green-500/30',
  in_progress: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  waiting_customer: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  resolved: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  closed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function SuporteStatusBadge({ status }: { status: TicketStatus }) {
  const { label, marker } = STATUS_DISPLAY_MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_BADGE_CLS[status]}`}
    >
      <span aria-hidden="true">{marker}</span>
      {label}
    </span>
  );
}

const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  1: 'Nível 1',
  2: 'Nível 2',
  3: 'Crítico',
};

export function SuportePriorityBadge({ level }: { level: PriorityLevel }) {
  const cls =
    level === 3
      ? 'bg-red-500/20 text-red-200 border-red-500/40 font-semibold'
      : level === 2
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}
    >
      {level === 3 && <span aria-hidden="true">⚠</span>}
      {PRIORITY_LABEL[level]}
    </span>
  );
}

export function SuporteModeBadge({ mode }: { mode: ResponderMode }) {
  const cls =
    mode === 'ai'
      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
      : 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  return (
    <span
      className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}
    >
      {mode === 'ai' ? 'IA' : 'Humano'}
    </span>
  );
}

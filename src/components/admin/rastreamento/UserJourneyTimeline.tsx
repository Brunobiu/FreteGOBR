/**
 * UserJourneyTimeline — linha do tempo cronológica da jornada de um usuário.
 *
 * Eventos por `occurred_at` crescente, com rótulo pt-BR + superfície + data/hora.
 * Indica o `Funnel_Stage` atual (onde o usuário parou). Estado vazio
 * `Nenhum evento de jornada registrado.` mantendo a estrutura visível (sem erro).
 * Link para `/admin/users/<id>` abre a Cliente_360_View existente. Sem PII bruta.
 *
 * _Requirements: 1.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
 */

import { Link } from 'react-router-dom';
import type { TimelineEvent } from '../../../services/admin/rastreamento';
import type { FunnelStage } from '../../../services/admin/rastreamento/domain';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { EVENT_TYPE_LABELS, FUNNEL_STAGE_LABELS, SURFACE_LABELS } from './labels';

interface Props {
  userId: string;
  userName?: string;
  events: TimelineEvent[];
  currentStage: FunnelStage;
  loading?: boolean;
  error?: string;
  onRetry: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function UserJourneyTimeline({
  userId,
  userName,
  events,
  currentStage,
  loading,
  error,
  onRetry,
}: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Jornada</div>
          <div className="text-sm font-semibold text-gray-100">{userName || 'Usuário'}</div>
        </div>
        <Link
          to={`/admin/users/${userId}`}
          className="text-xs text-cyan-300 hover:underline shrink-0"
        >
          Ver perfil completo
        </Link>
      </div>

      <div className="text-xs text-gray-400">
        Etapa atual:{' '}
        <span className="text-gray-200 font-medium">{FUNNEL_STAGE_LABELS[currentStage]}</span>
      </div>

      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="text-xs text-gray-500 py-4 text-center">Carregando…</div>
      ) : events.length === 0 ? (
        <div className="border-l border-gray-800 pl-3 py-2 text-xs text-gray-400">
          Nenhum evento de jornada registrado.
        </div>
      ) : (
        <ol className="border-l border-gray-800 pl-3 space-y-2">
          {events.map((ev, i) => (
            <li key={`${ev.event_type}-${ev.occurred_at}-${i}`} className="relative">
              <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-cyan-500" />
              <div className="text-xs text-gray-200">{EVENT_TYPE_LABELS[ev.event_type]}</div>
              <div className="text-[11px] text-gray-500">
                {SURFACE_LABELS[ev.surface]} · {formatDateTime(ev.occurred_at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * StatisticsPanel (task 20.14, Req 28.1, 28.5)
 *
 * Painel de Dispatch_Statistics de um Dispatch_Job: totais (enviado/pendente/
 * concluído/erro) + Estimated_Completion_Time, via `getDispatchStatistics`
 * (estado persistido, escopado por instância). Componente reutilizável por job
 * (usado no detalhe do Campaign_History e onde houver um job em contexto).
 * Atualização manual; tempo real fica na task 21.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getDispatchStatistics,
  type DispatchStatistics,
} from '../../../services/admin/whatsapp/stats';

interface Props {
  instanceId: string;
  jobId: string;
}

/** Formata o ETA (ms) em texto pt-BR compacto (— quando não há pendentes). */
function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function StatisticsPanel({ instanceId, jobId }: Props) {
  const [stats, setStats] = useState<DispatchStatistics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getDispatchStatistics(instanceId, jobId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, jobId]);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] uppercase tracking-wider text-gray-500">Estatísticas</h4>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <Stat label="Total" value={stats?.totalCount} />
        <Stat label="Enviados" value={stats?.sentCount} />
        <Stat label="Pendentes" value={stats?.pendingCount} />
        <Stat label="Com erro" value={stats?.failedCount} danger={!!stats && stats.failedCount > 0} />
        <Stat label="Conclusão est." text={stats ? formatEta(stats.estimatedCompletionMs) : '—'} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  text,
  danger,
}: {
  label: string;
  value?: number;
  text?: string;
  danger?: boolean;
}) {
  const display = text ?? (typeof value === 'number' ? String(value) : '—');
  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${danger ? 'text-red-300' : 'text-gray-100'}`}>
        {display}
      </p>
    </div>
  );
}

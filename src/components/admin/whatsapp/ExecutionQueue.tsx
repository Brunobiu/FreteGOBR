/**
 * ExecutionQueue (task 20.11, Req 22.1, 22.2, 22.3, 22.5, 22.7)
 *
 * Fila de execução da Active_Instance agrupada por estado (Aguardando, Em
 * execução, Pausada, Agendada, Concluída, Cancelada, Erro), com progresso
 * (enviados/total) e data relevante, via `getExecutionQueue` (rótulos já em
 * pt-BR). Em cada item, as ações de controle válidas para o estado (pausar/
 * continuar/cancelar) aparecem apenas com `SETTINGS_EDIT` (Req 22.5), reusando
 * `transitionDispatch`; agendados são cancelados via `cancelScheduledDispatch`.
 * Tempo real fica na task 21; aqui há refresh manual + poll leve.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { useRealtimeDispatch } from '../../../hooks/useRealtimeDispatch';
import {
  getExecutionQueue,
  type ExecutionQueueItem,
  type QueueGroup,
} from '../../../services/admin/whatsapp/queue';
import { transitionDispatch, type DispatchAction } from '../../../services/admin/whatsapp/dispatch';
import { cancelScheduledDispatch } from '../../../services/admin/whatsapp/scheduled';

interface Props {
  instanceId: string;
}

/** Ordem de exibição dos grupos da fila. */
const GROUP_ORDER: QueueGroup[] = [
  'RUNNING',
  'QUEUED',
  'PAUSED',
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
];

const ACTIVE_GROUPS: QueueGroup[] = ['QUEUED', 'RUNNING', 'PAUSED'];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export default function ExecutionQueue({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [items, setItems] = useState<ExecutionQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getExecutionQueue(instanceId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar a fila.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  // Tempo real (Req 22.3) + fallback de polling (task 21.3): reflete mudanças
  // de estado dos jobs/agendados da instância na fila.
  useRealtimeDispatch(instanceId, load);

  const handleControl = async (item: ExecutionQueueItem, action: DispatchAction) => {
    setError(null);
    try {
      await transitionDispatch(instanceId, item.jobId, action, item.updatedAt);
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Atualizando a fila.' : message);
      load();
    }
  };

  const handleCancelScheduled = async (item: ExecutionQueueItem) => {
    if (!item.scheduledId) return;
    setError(null);
    try {
      await cancelScheduledDispatch(instanceId, item.scheduledId, item.updatedAt);
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível cancelar.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Atualizando a fila.' : message);
      load();
    }
  };

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    label: items.find((i) => i.queueGroup === g)?.label ?? g,
    rows: items.filter((i) => i.queueGroup === g),
  })).filter((s) => s.rows.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500">Fila de execução</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Carregando...' : '↻ Atualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}

      {grouped.length === 0 && !loading && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
          Nenhum disparo na fila.
        </div>
      )}

      {grouped.map((section) => (
        <div key={section.group} className="space-y-1.5">
          <h4 className="text-[10px] uppercase tracking-wider text-gray-500">
            {section.label} ({section.rows.length})
          </h4>
          {section.rows.map((item) => (
            <div
              key={`${item.jobId}-${item.scheduledId ?? ''}`}
              className="rounded-lg border border-gray-800 bg-gray-900 p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs text-gray-300">
                    {item.kind === 'GROUP' ? 'Grupos' : 'Contatos'} · {item.totalCount} destinatário(s)
                  </span>
                  <div className="text-[11px] text-gray-500">{formatDateTime(item.relevantAt)}</div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5">
                    {item.queueGroup === 'RUNNING' && (
                      <QueueBtn label="Pausar" onClick={() => void handleControl(item, 'PAUSE')} />
                    )}
                    {item.queueGroup === 'PAUSED' && (
                      <QueueBtn label="Continuar" onClick={() => void handleControl(item, 'RESUME')} />
                    )}
                    {ACTIVE_GROUPS.includes(item.queueGroup) && (
                      <QueueBtn label="Cancelar" danger onClick={() => void handleControl(item, 'CANCEL')} />
                    )}
                    {item.queueGroup === 'SCHEDULED' && (
                      <QueueBtn label="Cancelar" danger onClick={() => void handleCancelScheduled(item)} />
                    )}
                  </div>
                )}
              </div>

              {item.totalCount > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {item.sentCount}/{item.totalCount} enviados
                    {item.failedCount > 0 && ` · ${item.failedCount} com erro`}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function QueueBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[11px] ${
        danger
          ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

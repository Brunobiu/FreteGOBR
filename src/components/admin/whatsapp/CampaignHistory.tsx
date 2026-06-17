/**
 * CampaignHistory (task 20.12, Req 20.2-20.5, 20.9-20.12)
 *
 * Histórico de disparos executados da Active_Instance (`listCampaignHistory`):
 * data, tipo, status final, total de contatos, enviados/erros e
 * Execution_Duration. Ao abrir um item (`getCampaignDetail`), mostra os
 * conteúdos + estatísticas (StatisticsPanel) + falhas (ErrorLog) e as ações
 * Duplicar / Reenviar / Reutilizar como nova (`duplicateCampaign`, gated
 * `SETTINGS_EDIT`), preservando o disparo histórico original.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  listCampaignHistory,
  getCampaignDetail,
  duplicateCampaign,
  type CampaignHistoryItem,
  type CampaignDetail,
  type DuplicateCampaignMode,
} from '../../../services/admin/whatsapp/history';
import StatisticsPanel from './StatisticsPanel';
import ErrorLog from './ErrorLog';

interface Props {
  instanceId: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: 'Concluída', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  FAILED: { label: 'Erro', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  CANCELLED: { label: 'Cancelada', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  RUNNING: { label: 'Em execução', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  PAUSED: { label: 'Pausada', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}min ${s}s` : `${min}min`;
}

export default function CampaignHistory({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [items, setItems] = useState<CampaignHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCampaignHistory(instanceId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar o histórico.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  const toggleDetail = async (jobId: string) => {
    if (openId === jobId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(jobId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getCampaignDetail(instanceId, jobId);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o detalhe.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAction = async (jobId: string, mode: DuplicateCampaignMode) => {
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await duplicateCampaign(instanceId, jobId, mode);
      if ('ok' in res) {
        setNotice(
          mode === 'RESEND'
            ? 'Reenvio criado e enfileirado.'
            : mode === 'REUSE'
              ? 'Cópia criada como rascunho para edição.'
              : 'Campanha duplicada como rascunho.'
        );
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500">Histórico de disparos</h3>
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
      {notice && (
        <div className="rounded border border-green-900/40 bg-green-500/10 px-2 py-1 text-[11px] text-green-300">
          {notice}
        </div>
      )}

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
          Nenhum disparo no histórico.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const badge = STATUS_BADGE[item.status] ?? {
              label: item.status,
              cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
            };
            const open = openId === item.id;
            return (
              <li key={item.id} className="rounded-lg border border-gray-800 bg-gray-900">
                <button
                  type="button"
                  onClick={() => void toggleDetail(item.id)}
                  className="flex w-full items-center justify-between gap-2 p-2.5 text-left hover:bg-gray-800/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-gray-300">
                        {item.kind === 'GROUP' ? 'Grupos' : 'Contatos'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {formatDateTime(item.startedAt ?? item.createdAt)} · {item.totalCount} destinatário(s) ·{' '}
                      {item.sentCount} enviados
                      {item.failedCount > 0 && ` · ${item.failedCount} erros`} · duração{' '}
                      {formatDuration(item.executionDurationSec)}
                    </div>
                  </div>
                  <span className="shrink-0 text-gray-500">{open ? '▲' : '▼'}</span>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-gray-800 p-2.5">
                    {detailLoading ? (
                      <div className="text-[11px] text-gray-500">Carregando detalhe...</div>
                    ) : detail && detail.id === item.id ? (
                      <>
                        <StatisticsPanel instanceId={instanceId} jobId={item.id} />

                        {detail.contents.length > 0 && (
                          <div className="space-y-1">
                            <h4 className="text-[10px] uppercase tracking-wider text-gray-500">
                              Conteúdos ({detail.contents.length})
                            </h4>
                            {detail.contents.map((c) => (
                              <div
                                key={c.id}
                                className="rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-[11px] text-gray-300"
                              >
                                {c.body ? (
                                  <span className="whitespace-pre-wrap break-words">{c.body}</span>
                                ) : (
                                  <span className="text-gray-500">(somente mídia)</span>
                                )}
                                {c.media.length > 0 && (
                                  <span className="ml-1 text-gray-500">+{c.media.length} mídia(s)</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {item.failedCount > 0 && <ErrorLog instanceId={instanceId} jobId={item.id} />}

                        {canEdit && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <HistoryAction label="Duplicar" busy={actionBusy} onClick={() => void handleAction(item.id, 'DUPLICATE')} />
                            <HistoryAction label="Reenviar" busy={actionBusy} onClick={() => void handleAction(item.id, 'RESEND')} />
                            <HistoryAction label="Reutilizar como nova" busy={actionBusy} onClick={() => void handleAction(item.id, 'REUSE')} />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[11px] text-gray-500">Detalhe indisponível.</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryAction({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

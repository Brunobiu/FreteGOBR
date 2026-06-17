/**
 * ConversationInbox (task 20.9, Req 30.1-30.5, 31.6, 31.7, 31.9)
 *
 * Central de Conversas da Active_Instance: lista (contato, prévia, horário e
 * indicador de Conversation_Mode 🤖/👤/⏸/🔄) + histórico completo da conversa
 * selecionada, com transferência híbrida "Assumir Atendimento" (`humanTakeover`)
 * e "Retornar para IA" (`returnToAi`) — gated `SETTINGS_EDIT`. Leituras via
 * `listConversations`/`getConversation`. Tempo real fica na task 21.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { useRealtimeDispatch } from '../../../hooks/useRealtimeDispatch';
import {
  listConversations,
  getConversation,
  humanTakeover,
  returnToAi,
  type ConversationListItem,
  type ConversationDetail,
  type ConversationMode,
} from '../../../services/admin/whatsapp/conversations';

interface Props {
  instanceId: string;
}

const MODE_PRESENTATION: Record<ConversationMode, { icon: string; label: string }> = {
  AI_MODE: { icon: '🤖', label: 'IA' },
  HUMAN_MODE: { icon: '👤', label: 'Humano' },
  AI_PAUSED: { icon: '⏸', label: 'IA pausada' },
  RETURNED_TO_AI: { icon: '🔄', label: 'Devolvido à IA' },
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '';
  }
}

export default function ConversationInbox({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [list, setList] = useState<ConversationListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(() => {
    let cancelled = false;
    setLoadingList(true);
    listConversations(instanceId)
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar conversas.');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => loadList(), [loadList]);

  const openConversation = useCallback(
    (conversationId: string) => {
      setSelectedId(conversationId);
      setDetail(null);
      setLoadingDetail(true);
      setError(null);
      getConversation(instanceId, conversationId)
        .then(setDetail)
        .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao abrir a conversa.'))
        .finally(() => setLoadingDetail(false));
    },
    [instanceId]
  );

  // Tempo real (Req 30.5) + fallback de polling: novas mensagens/mudança de
  // modo refrescam a lista e (se aberta) a conversa selecionada.
  useRealtimeDispatch(instanceId, () => {
    loadList();
    if (selectedId) openConversation(selectedId);
  });

  const handleAction = async (action: 'TAKEOVER' | 'RETURN') => {
    if (!detail) return;
    setActionBusy(true);
    setError(null);
    try {
      const fn = action === 'TAKEOVER' ? humanTakeover : returnToAi;
      await fn(instanceId, detail.id, detail.updatedAt);
      // Recarrega detalhe (novo modo/updatedAt) + lista (indicador mudou).
      openConversation(detail.id);
      loadList();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível alterar o atendimento.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Reabrindo a conversa.' : message);
      openConversation(detail.id);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[280px_1fr]">
      {/* Lista de conversas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500">
            Conversas {list.length > 0 && `(${list.length})`}
          </h3>
          <button
            type="button"
            onClick={loadList}
            disabled={loadingList}
            className="text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {loadingList ? '...' : '↻'}
          </button>
        </div>

        {list.length === 0 && !loadingList ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
            Nenhuma conversa.
          </div>
        ) : (
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
            {list.map((c) => {
              const mode = MODE_PRESENTATION[c.mode] ?? MODE_PRESENTATION.AI_MODE;
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={`w-full rounded-lg border p-2 text-left ${
                      active
                        ? 'border-green-500/40 bg-green-500/10'
                        : 'border-gray-800 bg-gray-900 hover:bg-gray-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs text-gray-100">{c.contactPhone}</span>
                      <span className="shrink-0 text-[11px]" title={mode.label}>
                        {mode.icon}
                      </span>
                    </div>
                    {c.lastMessagePreview && (
                      <div className="mt-0.5 truncate text-[11px] text-gray-500">
                        {c.lastMessagePreview}
                      </div>
                    )}
                    <div className="text-[10px] text-gray-600">{formatTime(c.lastMessageAt)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Detalhe da conversa */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
        {error && (
          <div className="mb-2 rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
            {error}
          </div>
        )}

        {!selectedId ? (
          <div className="flex h-40 items-center justify-center text-xs text-gray-500">
            Selecione uma conversa.
          </div>
        ) : loadingDetail ? (
          <div className="flex h-40 items-center justify-center text-xs text-gray-500">
            Carregando...
          </div>
        ) : detail ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2">
              <div>
                <span className="font-mono text-sm text-gray-100">{detail.contactPhone}</span>
                <span className="ml-2 text-[11px] text-gray-400">
                  {MODE_PRESENTATION[detail.mode]?.icon} {MODE_PRESENTATION[detail.mode]?.label}
                </span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  {detail.mode !== 'HUMAN_MODE' ? (
                    <button
                      type="button"
                      onClick={() => void handleAction('TAKEOVER')}
                      disabled={actionBusy}
                      className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                    >
                      Assumir atendimento
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleAction('RETURN')}
                      disabled={actionBusy}
                      className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                    >
                      Retornar para IA
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Histórico cronológico */}
            <div className="max-h-[24rem] space-y-1.5 overflow-y-auto">
              {detail.messages.length === 0 ? (
                <div className="text-xs text-gray-500">Sem mensagens.</div>
              ) : (
                detail.messages.map((m) => {
                  const outbound = m.direction === 'OUTBOUND';
                  return (
                    <div key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm ${
                          outbound
                            ? 'rounded-tr-none bg-green-900/30 text-gray-100'
                            : 'rounded-tl-none bg-gray-800 text-gray-100'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body ?? ''}</div>
                        <div className="mt-0.5 text-right text-[10px] text-gray-500">
                          {formatTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-gray-500">
            Conversa indisponível.
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  listSupportConversations,
  getSupportConversationMessages,
  postAdminReply,
  resolveSupportConversation,
  SupportChatError,
  type SupportConversation,
  type SupportChatMessage,
  type SupportConversationStatus,
} from '../../services/admin/supportChat';
import { useAdminPermission } from '../../hooks/useAdminPermission';

const STATUS_LABEL: Record<SupportConversationStatus, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  resolvida: 'Resolvida',
};

const STATUS_BADGE: Record<SupportConversationStatus, string> = {
  aberta: 'bg-blue-900/40 text-blue-300',
  em_andamento: 'bg-yellow-900/40 text-yellow-300',
  resolvida: 'bg-green-900/40 text-green-300',
};

/**
 * Página admin `/admin/suporte/chat` — layout 2 colunas.
 * Esquerda: lista de conversas. Direita: conversa selecionada.
 */
export default function AdminSupportChatPage() {
  const { allowed: canReply } = useAdminPermission('SUPORTE_REPLY');
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    msg: string;
  } | null>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const loadConversations = async () => {
    setLoadingList(true);
    setError(null);
    try {
      const data = await listSupportConversations({ limit: 100 });
      setConversations(data.items);
      // Auto-seleciona primeira não-resolvida
      if (!selectedId && data.items.length > 0) {
        const first = data.items.find((c) => c.status !== 'resolvida') ?? data.items[0];
        setSelectedId(first.id);
      }
    } catch (err) {
      setError(err instanceof SupportChatError ? err.message : 'Erro ao carregar.');
    } finally {
      setLoadingList(false);
    }
  };

  const loadMessages = async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const msgs = await getSupportConversationMessages(convId);
      setMessages(msgs);
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof SupportChatError ? err.message : 'Erro ao carregar mensagens.',
      });
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
    setReplyText('');
    setFeedback(null);
  }, [selectedId]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    setPosting(true);
    setFeedback(null);
    try {
      await postAdminReply(selected.id, replyText.trim(), selected.updatedAt);
      setReplyText('');
      await loadMessages(selected.id);
      await loadConversations();
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof SupportChatError ? err.message : 'Erro ao enviar.',
      });
      if (err instanceof SupportChatError && err.code === 'STALE_VERSION') {
        await loadConversations();
      }
    } finally {
      setPosting(false);
    }
  };

  const handleResolve = async () => {
    if (!selected) return;
    if (!confirm(`Marcar conversa de ${selected.userName ?? 'usuario'} como resolvida?`)) return;
    setResolving(true);
    try {
      const result = await resolveSupportConversation(selected.id, selected.updatedAt);
      if ('skipped' in result) {
        setFeedback({ type: 'warning', msg: 'Conversa ja estava resolvida.' });
      } else {
        setFeedback({ type: 'success', msg: 'Conversa resolvida.' });
      }
      await loadConversations();
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof SupportChatError ? err.message : 'Erro ao resolver.',
      });
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="p-6 h-[calc(100vh-3rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-100">Chat de Suporte</h1>
        <p className="text-sm text-gray-400 mt-1">
          Conversas em tempo real com motoristas e embarcadores.
        </p>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 flex gap-3 min-h-0">
        {/* Coluna esquerda: lista de conversas */}
        <div className="w-72 flex-shrink-0 bg-gray-800 border border-gray-700 rounded-lg flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-gray-700">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-medium">
              Conversas ({conversations.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <p className="p-4 text-xs text-gray-400 text-center">Carregando...</p>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-xs text-gray-400 text-center">Nenhuma conversa.</p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-700/40 transition-colors ${
                        selectedId === c.id ? 'bg-gray-700/60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-100 font-medium truncate">
                            {c.userName ?? 'Usuário'}
                          </p>
                          {c.lastMessage && (
                            <p className="text-[11px] text-gray-400 truncate mt-0.5">
                              {c.lastMessage.isAdmin ? 'Você: ' : ''}
                              {c.lastMessage.body}
                            </p>
                          )}
                        </div>
                        {c.unreadCount && c.unreadCount > 0 ? (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {c.unreadCount > 9 ? '9+' : c.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1">
                        <span
                          className={`px-1.5 py-0 rounded-full text-[9px] font-medium ${STATUS_BADGE[c.status]}`}
                        >
                          {STATUS_LABEL[c.status]}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Coluna direita: conversa */}
        <div className="flex-1 bg-gray-800 border border-gray-700 rounded-lg flex flex-col min-h-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Selecione uma conversa à esquerda.
            </div>
          ) : (
            <>
              {/* Header da conversa */}
              <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">
                    {selected.userName ?? 'Usuário'}
                  </p>
                  <span
                    className={`inline-block mt-0.5 px-1.5 py-0 rounded-full text-[10px] font-medium ${STATUS_BADGE[selected.status]}`}
                  >
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
                {canReply && selected.status !== 'resolvida' && (
                  <button
                    onClick={handleResolve}
                    disabled={resolving}
                    className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    {resolving ? 'Resolvendo...' : 'Marcar como resolvida'}
                  </button>
                )}
              </div>

              {/* Lista de mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {loadingMsgs ? (
                  <p className="text-xs text-gray-400 text-center">Carregando mensagens...</p>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center">
                    Nenhuma mensagem ainda nessa conversa.
                  </p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.isAdmin ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 ${
                          m.isAdmin
                            ? 'bg-blue-900/30 border border-blue-500/30 text-gray-100'
                            : 'bg-gray-900 border border-gray-700 text-gray-100'
                        }`}
                      >
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 font-medium">
                          {m.isAdmin ? 'Admin' : (selected.userName ?? 'Usuário')}
                        </p>
                        <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {new Date(m.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {feedback && (
                <div
                  className={`px-4 py-2 text-xs ${
                    feedback.type === 'success'
                      ? 'bg-green-900/20 text-green-300 border-t border-green-500/30'
                      : feedback.type === 'warning'
                        ? 'bg-yellow-900/20 text-yellow-300 border-t border-yellow-500/30'
                        : 'bg-red-900/20 text-red-300 border-t border-red-500/30'
                  }`}
                >
                  {feedback.msg}
                </div>
              )}

              {/* Caixa de resposta */}
              {canReply && selected.status !== 'resolvida' && (
                <form onSubmit={handleReply} className="p-3 border-t border-gray-700">
                  <div className="flex gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      maxLength={5000}
                      placeholder="Resposta para o usuário..."
                      className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={posting || !replyText.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                    >
                      {posting ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                </form>
              )}

              {selected.status === 'resolvida' && (
                <div className="px-4 py-3 border-t border-gray-700 text-center text-xs text-green-400">
                  Conversa resolvida. Aguardando nova mensagem do usuário para reabrir.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

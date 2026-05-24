import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  getUserConversations,
  getTotalUnreadCount,
  type FreteConversation,
} from '../services/chatFrete';
import { supabase } from '../services/supabase';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveProfilePhotoUrl } from '../services/documents';

const TOGGLE_CHAT_EVENT = 'fretego-toggle-chat';
const UNREAD_COUNT_EVENT = 'fretego-chat-unread-count';

/**
 * Widget de mensagens flutuante (apenas preview).
 *
 * - Renderizado globalmente em todas as páginas, exceto `/mensagens`.
 * - Listagem das conversas com avatar, nome, frete e preview da última mensagem.
 * - Clique em uma conversa → navega pra `/mensagens?conversation=<id>`.
 * - Click-outside fecha o painel automaticamente.
 * - Realtime: novas mensagens atualizam o badge no header e o preview da lista.
 *
 * O painel é aberto via evento `fretego-toggle-chat` disparado pelo ícone
 * de mensagens no AppHeader.
 */
export default function FreteChatWidget() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isOnMensagensPage = location.pathname === '/mensagens';

  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<FreteConversation[]>([]);
  const [convPhotos, setConvPhotos] = useState<Record<string, string | null>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isEligible =
    isAuthenticated && (user?.userType === 'motorista' || user?.userType === 'embarcador');

  // Conta inicial de não lidas
  useEffect(() => {
    if (!isEligible || !user) return;
    getTotalUnreadCount(user.id)
      .then(setTotalUnread)
      .catch(() => {});
  }, [isEligible, user]);

  // Emite o totalUnread pro AppHeader (que mostra o badge no ícone)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<number>(UNREAD_COUNT_EVENT, { detail: totalUnread })
    );
  }, [totalUnread]);

  // Escuta toggle vindo do ícone do header
  useEffect(() => {
    if (!isEligible) return;
    const handler = () => setIsOpen((v) => !v);
    window.addEventListener(TOGGLE_CHAT_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_CHAT_EVENT, handler);
  }, [isEligible]);

  // Click-outside fecha o painel
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    // setTimeout pra não fechar no mesmo clique que abriu
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [isOpen]);

  // Carrega conversas quando abre o widget
  useEffect(() => {
    if (!isOpen || !isEligible || !user) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const list = await getUserConversations(user.id);
        if (cancelled) return;
        setConversations(list);

        // Resolve fotos em paralelo
        const photoEntries = await Promise.all(
          list.map(async (c) => {
            const src = c.otherUser?.photo;
            if (!src) return [c.id, null] as const;
            const url = await resolveProfilePhotoUrl(src);
            return [c.id, url] as const;
          })
        );
        if (!cancelled) setConvPhotos(Object.fromEntries(photoEntries));

        // Atualiza unread total
        const unread = list.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
        if (!cancelled) setTotalUnread(unread);
      } catch (err) {
        console.error('Erro ao carregar conversas:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isEligible, user]);

  // Realtime global: atualiza preview e badge ao chegar mensagem nova
  useEffect(() => {
    if (!isEligible || !user) return;
    const channel = supabase
      .channel(`messages-widget-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as {
            sender_id: string;
            conversation_id: string;
            content: string | null;
            attachment_type: string | null;
          };
          if (row.sender_id === user.id) return;

          // Incrementa badge global
          setTotalUnread((c) => c + 1);

          let preview = row.content && row.content.trim() !== '' ? row.content : '';
          if (!preview && row.attachment_type === 'image') preview = '🖼 Imagem';
          else if (!preview && row.attachment_type === 'audio') preview = '🎤 Áudio';
          else if (!preview && row.attachment_type === 'file') preview = '📎 Arquivo';

          // Atualiza a lista local (caso esteja aberta)
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === row.conversation_id);
            if (idx === -1) return prev;
            const conv = prev[idx];
            const updated: FreteConversation = {
              ...conv,
              lastMessage: preview || conv.lastMessage,
              unreadCount: (conv.unreadCount ?? 0) + 1,
            };
            return [updated, ...prev.filter((_, i) => i !== idx)];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isEligible, user]);

  const goToConversation = (convId: string) => {
    setIsOpen(false);
    navigate(`/mensagens?conversation=${convId}`);
  };

  const goToAll = () => {
    setIsOpen(false);
    navigate('/mensagens');
  };

  const formatPreview = (conv: FreteConversation) => {
    if (conv.lastMessage) return conv.lastMessage;
    return 'Sem mensagens';
  };

  if (!isEligible || isOnMensagensPage) return null;

  return (
    <>
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed top-16 right-4 sm:right-6 w-[22rem] max-w-[calc(100vw-2rem)] max-h-[28rem] bg-white border border-gray-200 rounded-lg shadow-2xl flex flex-col z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-green-600 shrink-0">
            <h3 className="text-sm font-semibold text-white truncate">Mensagens FreteGO</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-green-100 hover:text-white"
              aria-label="Fechar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Lista de conversas */}
          <div className="flex-1 overflow-y-auto bg-white min-h-0">
            {isLoading ? (
              <p className="text-xs text-gray-500 text-center py-8">Carregando...</p>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 px-4">
                <svg
                  className="w-10 h-10 text-gray-300 mx-auto mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <p className="text-sm text-gray-500">Nenhuma conversa ainda</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Inicie uma conversa a partir de um frete
                </p>
              </div>
            ) : (
              conversations.slice(0, 5).map((conv) => {
                const photo = convPhotos[conv.id] ?? null;
                const initials = (conv.otherUser?.name ?? '?').charAt(0).toUpperCase();
                const unread = conv.unreadCount ?? 0;
                return (
                  <button
                    key={conv.id}
                    onClick={() => goToConversation(conv.id)}
                    className="w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50 transition-colors flex items-center gap-2.5"
                  >
                    {photo ? (
                      <img
                        src={photo}
                        alt={conv.otherUser?.name ?? ''}
                        className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-sm shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-800 truncate leading-tight">
                        {conv.otherUser?.name ?? 'Usuário'}
                      </p>
                      {conv.frete && (
                        <p className="text-[10px] text-gray-400 truncate leading-tight">
                          {conv.frete.origin} → {conv.frete.destination}
                        </p>
                      )}
                      <p
                        className={`text-[11px] truncate leading-tight ${
                          unread > 0 ? 'text-gray-800 font-medium' : 'text-gray-500'
                        }`}
                      >
                        {formatPreview(conv)}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span className="bg-green-600 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer "Ver todas" */}
          <button
            onClick={goToAll}
            className="w-full px-3 py-2 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-t border-gray-200 shrink-0"
          >
            Ver todas as mensagens →
          </button>
        </div>
      )}
    </>
  );
}

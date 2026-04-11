import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  getUserConversations,
  getFreteMessages,
  sendFreteMessage,
  markFreteMessagesAsRead,
  getTotalUnreadCount,
  subscribeToFreteMessages,
  type FreteConversation,
  type FreteMessage,
} from '../services/chatFrete';

const ACTIVE_CHAT_KEY = 'fretego-active-chat';

export default function FreteChatWidget() {
  const { user, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<FreteConversation[]>([]);
  const [activeConv, setActiveConv] = useState<FreteConversation | null>(null);
  const [messages, setMessages] = useState<FreteMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [totalUnread, setTotalUnread] = useState(0);
  const [isLoadingConvs, setIsLoadingConvs] = useState(false);
  const [isLoadingMsgs, setIsLoadingMsgs] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isEligible =
    isAuthenticated && (user?.userType === 'motorista' || user?.userType === 'embarcador');

  // Carrega contagem de não lidas ao montar
  useEffect(() => {
    if (!isEligible || !user) return;
    getTotalUnreadCount(user.id)
      .then(setTotalUnread)
      .catch(() => {});
  }, [isEligible, user]);

  // Verifica localStorage para abrir conversa específica
  useEffect(() => {
    if (!isEligible) return;

    const handleOpenChatEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId) {
        setIsOpen(true);
        loadConversations(detail.conversationId);
      }
    };

    window.addEventListener('fretego-open-chat', handleOpenChatEvent);

    const stored = localStorage.getItem(ACTIVE_CHAT_KEY);
    if (stored) {
      localStorage.removeItem(ACTIVE_CHAT_KEY);
      setIsOpen(true);
      loadConversations(stored);
    }

    return () => {
      window.removeEventListener('fretego-open-chat', handleOpenChatEvent);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEligible]);

  // Carrega conversas quando abre o widget
  useEffect(() => {
    if (isOpen && isEligible && user) {
      loadConversations();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEligible, user]);

  // Realtime para conversa ativa
  useEffect(() => {
    if (!activeConv) return;
    const unsub = subscribeToFreteMessages(activeConv.id, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (msg.senderId !== user?.id) {
        if (isOpen) {
          markFreteMessagesAsRead(activeConv.id, user?.id || '');
        } else {
          setTotalUnread((c) => c + 1);
        }
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv, isOpen]);

  // Scroll para o fim
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async (targetConvId?: string) => {
    if (!user) return;
    setIsLoadingConvs(true);
    try {
      const convs = await getUserConversations(user.id);
      setConversations(convs);

      // Atualiza total de não lidas
      const unread = convs.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
      setTotalUnread(unread);

      // Abre conversa específica se solicitado
      if (targetConvId) {
        const target = convs.find((c) => c.id === targetConvId);
        if (target) openConversation(target);
      }
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
    } finally {
      setIsLoadingConvs(false);
    }
  };

  const openConversation = async (conv: FreteConversation) => {
    if (!user) return;
    setActiveConv(conv);
    setIsLoadingMsgs(true);
    try {
      const msgs = await getFreteMessages(conv.id);
      setMessages(msgs);
      await markFreteMessagesAsRead(conv.id, user.id);
      // Atualiza unread local
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
      );
      setTotalUnread((prev) => Math.max(0, prev - (conv.unreadCount || 0)));
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
    } finally {
      setIsLoadingMsgs(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !activeConv || !user) return;
    setIsSending(true);
    try {
      await sendFreteMessage(activeConv.id, user.id, newMessage.trim());
      setNewMessage('');
    } catch (err) {
      console.error('Erro ao enviar:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setActiveConv(null);
    setMessages([]);
  };

  if (!isEligible) return null;

  return (
    <>
      {/* Botão flutuante - offset do ChatWidget (bottom-6 right-6), fica acima dele */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-24 right-6 w-14 h-14 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg flex items-center justify-center z-50 transition-transform hover:scale-105"
          title="Chat com Motoristas/Embarcadores"
        >
          {/* Truck + chat icon */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Painel do chat */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-80 h-[28rem] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-green-600 rounded-t-lg">
            <div className="flex items-center space-x-2">
              {activeConv && (
                <button
                  onClick={() => { setActiveConv(null); setMessages([]); }}
                  className="text-green-200 hover:text-white mr-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <h3 className="text-sm font-semibold text-white">
                {activeConv ? (activeConv.otherUser?.name || 'Conversa') : 'Mensagens FreteGO'}
              </h3>
            </div>
            <button onClick={handleClose} className="text-green-200 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Lista de conversas */}
          {!activeConv && (
            <div className="flex-1 overflow-y-auto bg-white">
              {isLoadingConvs ? (
                <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
              ) : conversations.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm text-gray-500">Nenhuma conversa ainda</p>
                  <p className="text-xs text-gray-400 mt-1">Inicie uma conversa a partir de um frete</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => openConversation(conv)}
                    className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {conv.otherUser?.name || 'Usuário'}
                      </span>
                      {(conv.unreadCount || 0) > 0 && (
                        <span className="ml-2 min-w-[20px] h-5 bg-green-600 text-white text-xs rounded-full flex items-center justify-center px-1">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {conv.frete && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {conv.frete.origin} → {conv.frete.destination}
                      </p>
                    )}
                    {conv.lastMessage && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{conv.lastMessage}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Thread de mensagens */}
          {activeConv && (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
                {isLoadingMsgs ? (
                  <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500">Nenhuma mensagem ainda</p>
                    <p className="text-xs text-gray-400 mt-1">Inicie a conversa!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.senderId === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] ${isMine ? '' : ''}`}>
                          {!isMine && msg.senderName && (
                            <p className="text-[10px] text-gray-500 mb-1 ml-1">{msg.senderName}</p>
                          )}
                          <div
                            className={`px-3 py-2 rounded-lg text-sm ${
                              isMine
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            <p>{msg.content}</p>
                            <p className="text-[10px] opacity-60 mt-1">
                              {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-3 py-3 border-t border-gray-200 bg-white rounded-b-lg">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value.slice(0, 500))}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    maxLength={500}
                    placeholder="Digite sua mensagem..."
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <button
                    onClick={handleSend}
                    disabled={isSending || !newMessage.trim()}
                    className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

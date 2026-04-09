import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  getOrCreateConversation,
  sendMessage,
  getMessages,
  markMessagesAsRead,
  getUnreadCount,
  subscribeToMessages,
  type ChatMessage,
} from '../services/chat';
import InputValidator, { INPUT_LIMITS } from '../utils/inputValidator';

export default function ChatWidget() {
  const { user, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Inicializa conversa quando abre
  useEffect(() => {
    if (isOpen && isAuthenticated && user && !conversationId) {
      initConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isAuthenticated, user]);

  // Realtime
  useEffect(() => {
    if (!conversationId) return;
    const unsub = subscribeToMessages(conversationId, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (msg.senderId !== user?.id) {
        if (isOpen) {
          markMessagesAsRead(conversationId, user?.id || '');
        } else {
          setUnreadCount((c) => c + 1);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isOpen]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check unread on mount
  useEffect(() => {
    if (isAuthenticated && user) {
      getOrCreateConversation(user.id)
        .then((conv) => {
          setConversationId(conv.id);
          getUnreadCount(conv.id, user.id).then(setUnreadCount);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  const initConversation = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const conv = await getOrCreateConversation(user.id);
      setConversationId(conv.id);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      await markMessagesAsRead(conv.id, user.id);
      setUnreadCount(0);
    } catch (err) {
      console.error('Erro ao iniciar chat:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !conversationId || !user) return;
    setIsSending(true);
    try {
      await sendMessage(conversationId, user.id, newMessage.trim());
      setNewMessage('');
    } catch (err) {
      console.error('Erro ao enviar:', err);
    } finally {
      setIsSending(false);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <>
      {/* Botão flutuante */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center z-50 transition-transform hover:scale-105"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 h-[28rem] bg-gray-900 border border-gray-800 rounded-lg shadow-xl flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">Suporte FreteGO</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {isLoading ? (
              <p className="text-sm text-gray-500 text-center">Carregando...</p>
            ) : messages.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Olá! Como podemos ajudar?</p>
                <p className="text-xs text-gray-500 mt-1">Envie uma mensagem para iniciar</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderId === user?.id ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                      msg.senderId === user?.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-200'
                    }`}
                  >
                    {msg.isAdmin && msg.senderId !== user?.id && (
                      <p className="text-xs text-blue-400 mb-1">Suporte</p>
                    )}
                    <p>{msg.message}</p>
                    <p className="text-[10px] opacity-60 mt-1">
                      {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-gray-800">
            <div className="flex flex-col space-y-1">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value.length <= INPUT_LIMITS.MAX_CHAT_MESSAGE) {
                      const validation = InputValidator.validateChatMessage(value);
                      if (validation.isValid || value.length === 0) {
                        setNewMessage(value);
                      } else {
                        setNewMessage(validation.sanitizedValue);
                      }
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  maxLength={INPUT_LIMITS.MAX_CHAT_MESSAGE}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleSend}
                  disabled={isSending || !newMessage.trim()}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
              <span className="text-[10px] text-gray-500 text-right">
                {newMessage.length}/{INPUT_LIMITS.MAX_CHAT_MESSAGE}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

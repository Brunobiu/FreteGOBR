import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  openMySupportConversation,
  getSupportConversationMessages,
  postSupportMessage,
  SupportChatError,
  type SupportConversation,
  type SupportChatMessage,
} from '../services/admin/supportChat';
import AppHeader from '../components/AppHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../hooks/useAuth';

/**
 * Página `/suporte/chat` — chat de suporte para o usuário logado.
 * Cada usuário tem uma única conversa (chat_conversations.user_id UNIQUE).
 */
export default function SupportChatPage() {
  useDocumentTitle('Suporte');
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const conv = await openMySupportConversation();
      setConversation(conv);
      const msgs = await getSupportConversationMessages(conv.id);
      setMessages(msgs);
    } catch (err) {
      setError(err instanceof SupportChatError ? err.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Scroll automático ao fim ao receber mensagens novas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setPosting(true);
    try {
      await postSupportMessage(text.trim());
      setText('');
      // Recarrega só as mensagens
      if (conversation) {
        const msgs = await getSupportConversationMessages(conversation.id);
        setMessages(msgs);
      }
    } catch (err) {
      setError(err instanceof SupportChatError ? err.message : 'Erro ao enviar.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <AppHeader />
      <main className="flex-1 max-w-2xl w-full mx-auto px-3 sm:px-4 py-3 pb-24 md:pb-4 flex flex-col min-h-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            onClick={() => navigate(-1)}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            ← Voltar
          </button>
          <h1 className="text-base sm:text-lg font-semibold text-gray-800">Suporte FreteGO</h1>
          <div className="w-12" />
        </div>

        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex-1 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0 overflow-hidden">
          {/* Lista de mensagens */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <p className="text-xs text-gray-500 text-center">Carregando...</p>
            ) : messages.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-700 font-medium mb-1">
                  Olá! Como podemos te ajudar?
                </p>
                <p className="text-xs text-gray-500">
                  Envie sua mensagem e nossa equipe responde por aqui.
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const isMine = m.senderId === user?.id && !m.isAdmin;
                return (
                  <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
                        m.isAdmin
                          ? 'bg-blue-50 border border-blue-200'
                          : 'bg-green-50 border border-green-200'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-medium">
                        {m.isAdmin ? 'Suporte FreteGO' : 'Você'}
                      </p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                        {m.message}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(m.createdAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Caixa de envio */}
          {conversation && (
            <form
              onSubmit={handleSend}
              className="border-t border-gray-200 p-3 flex gap-2 bg-gray-50"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                maxLength={5000}
                placeholder="Digite sua mensagem..."
                className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                disabled={posting || !text.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {posting ? '...' : 'Enviar'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

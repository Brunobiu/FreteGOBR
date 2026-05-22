import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Página de mensagens estilo WhatsApp.
 * Layout: lista de conversas à esquerda, conversa aberta à direita.
 *
 * Estado atual: esqueleto sem funcionalidade ativa. O backend de mensagens
 * (tabelas conversations/messages) já existe, mas a integração será
 * implementada quando o fluxo de motorista estiver pronto.
 */

interface ConversationPreview {
  id: string;
  contactName: string;
  contactInitials: string;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
}

export default function MensagensPage() {
  useDocumentTitle('Mensagens');
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Placeholder — virá da API quando o fluxo do motorista estiver ativo.
  const conversations: ConversationPreview[] = [];

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">Mensagens</h1>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 h-[calc(100vh-200px)]">
            {/* Lista de conversas */}
            <aside className="border-r border-gray-200 overflow-y-auto bg-gray-50/40">
              <div className="px-4 py-3 border-b border-gray-200 bg-white">
                <input
                  type="text"
                  placeholder="Buscar conversa..."
                  className="w-full px-3 py-1.5 text-sm bg-gray-100 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {conversations.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      className="w-6 h-6 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700">Nenhuma mensagem ainda</p>
                  <p className="text-xs text-gray-500 mt-1">
                    As conversas com motoristas aparecerão aqui.
                  </p>
                </div>
              ) : (
                <ul>
                  {conversations.map((conv) => (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(conv.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-100 transition-colors text-left ${
                          selectedId === conv.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold shrink-0">
                          {conv.contactInitials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {conv.contactName}
                            </p>
                            <span className="text-[10px] text-gray-400 shrink-0">
                              {conv.lastTime}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{conv.lastMessage}</p>
                        </div>
                        {conv.unreadCount > 0 && (
                          <span className="bg-blue-600 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                            {conv.unreadCount}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            {/* Conversa aberta */}
            <section className="md:col-span-2 flex flex-col">
              {!selected ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
                  <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                    <svg
                      className="w-10 h-10 text-blue-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-800">Selecione uma conversa</h2>
                  <p className="text-sm text-gray-500 mt-1 max-w-sm">
                    Quando um motorista entrar em contato sobre algum frete, a conversa aparecerá
                    aqui.
                  </p>
                </div>
              ) : (
                <>
                  {/* Header da conversa */}
                  <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
                    <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold">
                      {selected.contactInitials}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{selected.contactName}</p>
                      <p className="text-[11px] text-gray-500">Online</p>
                    </div>
                  </header>

                  {/* Mensagens */}
                  <div className="flex-1 overflow-y-auto bg-gray-50 p-4 space-y-2">
                    <p className="text-center text-xs text-gray-400">
                      Histórico de mensagens em construção.
                    </p>
                  </div>

                  {/* Input */}
                  <footer className="border-t border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Anexar"
                        disabled
                        className="p-2 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                          />
                        </svg>
                      </button>
                      <input
                        type="text"
                        placeholder="Digite uma mensagem..."
                        disabled
                        className="flex-1 px-3 py-2 text-sm bg-gray-100 border border-gray-200 rounded-full focus:outline-none disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        disabled
                        className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                          />
                        </svg>
                      </button>
                    </div>
                  </footer>
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

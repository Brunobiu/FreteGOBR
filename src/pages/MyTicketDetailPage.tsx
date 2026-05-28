import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getMyTicket,
  postMyTicketReply,
  TicketError,
  type SupportTicket,
  type TicketMessage,
  type TicketStatus,
} from '../services/admin/tickets';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-700',
};

/**
 * Página `/tickets/:id` — detalhe de um ticket próprio do usuário.
 * Lista mensagens em ordem cronológica + caixa de resposta no fim.
 */
export default function MyTicketDetailPage() {
  useDocumentTitle('Ticket');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [posting, setPosting] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getMyTicket(id);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof TicketError ? err.message : 'Nao foi possivel carregar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !replyBody.trim()) return;
    setPosting(true);
    try {
      await postMyTicketReply(id, replyBody.trim());
      setReplyBody('');
      await load();
    } catch (err) {
      setError(err instanceof TicketError ? err.message : 'Nao foi possivel enviar.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-3 sm:px-4 py-4 pb-24 md:pb-4">
        <button
          onClick={() => navigate('/tickets')}
          className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-3"
        >
          ← Voltar
        </button>

        {loading ? (
          <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
        ) : !ticket ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-700">{error ?? 'Ticket nao encontrado.'}</p>
          </div>
        ) : (
          <>
            {/* Header do ticket */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h1 className="text-base sm:text-lg font-semibold text-gray-800 flex-1 min-w-0">
                  {ticket.subject}
                </h1>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[ticket.status]}`}
                >
                  {STATUS_LABEL[ticket.status]}
                </span>
              </div>
              <p className="text-[10px] text-gray-400">
                Aberto em {new Date(ticket.createdAt).toLocaleString('pt-BR')}
              </p>
            </div>

            {/* Lista de mensagens */}
            <div className="space-y-2 mb-3">
              {messages.map((m) => {
                const isMine = m.authorId === user?.id;
                return (
                  <div
                    key={m.id}
                    className={`flex ${m.isAdmin ? 'justify-start' : isMine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 ${
                        m.isAdmin
                          ? 'bg-blue-50 border border-blue-200 text-gray-800'
                          : 'bg-white border border-gray-200 text-gray-800'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-medium">
                        {m.isAdmin ? 'Suporte FreteGO' : 'Voce'}
                      </p>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
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
              })}
            </div>

            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Caixa de resposta */}
            {ticket.status !== 'resolved' && (
              <form
                onSubmit={handleReply}
                className="bg-white border border-gray-200 rounded-lg p-3"
              >
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  required
                  placeholder="Escreva sua resposta..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-400">{replyBody.length} / 5000</span>
                  <button
                    type="submit"
                    disabled={posting || replyBody.trim().length === 0}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    {posting ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
            )}

            {ticket.status === 'resolved' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-sm text-green-800">
                  Este ticket foi marcado como <strong>resolvido</strong>.
                </p>
                <p className="text-xs text-green-700 mt-1">
                  Precisa de mais ajuda?{' '}
                  <button
                    onClick={() => navigate('/tickets/novo')}
                    className="underline font-medium"
                  >
                    Abrir novo ticket
                  </button>
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listMyTickets,
  TicketError,
  type SupportTicket,
  type TicketStatus,
} from '../services/admin/tickets';
import AppHeader from '../components/AppHeader';
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
 * Página `/tickets` para usuário logado listar seus tickets.
 */
export default function MyTicketsPage() {
  useDocumentTitle('Meus Tickets');
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMyTickets()
      .then((items) => {
        if (!cancelled) setTickets(items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof TicketError ? err.message : 'Nao foi possivel carregar.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 pb-24 md:pb-4">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div>
            <h1 className="text-base sm:text-lg font-semibold text-gray-800">Meus Tickets</h1>
            <p className="text-xs text-gray-500 mt-0.5">Acompanhe suas solicitacoes ao suporte.</p>
          </div>
          <button
            onClick={() => navigate('/tickets/novo')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            + Novo ticket
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
        ) : tickets.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
            <h3 className="text-base font-semibold text-gray-800 mb-1">Nenhum ticket por aqui</h3>
            <p className="text-xs text-gray-500 mb-4">
              Quando voce abrir um ticket, ele aparece nesta lista.
            </p>
            <button
              onClick={() => navigate('/tickets/novo')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
            >
              Abrir primeiro ticket
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/tickets/${t.id}`}
                    className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{t.subject}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Criado em{' '}
                          {new Date(t.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[t.status]}`}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

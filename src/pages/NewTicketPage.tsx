import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import UserTicketForm from '../components/UserTicketForm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Página `/tickets/novo` — wrapper para `UserTicketForm` com navegação.
 */
export default function NewTicketPage() {
  useDocumentTitle('Novo Ticket');
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-md mx-auto px-3 sm:px-4 py-4 pb-24 md:pb-4">
        <div className="mb-4">
          <button
            onClick={() => navigate('/tickets')}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            ← Voltar para meus tickets
          </button>
          <h1 className="text-base sm:text-lg font-semibold text-gray-800 mt-2">
            Abrir novo ticket
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Conte o que aconteceu e nossa equipe responde por aqui.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <UserTicketForm
            onSuccess={(ticket) => {
              // Após criar, leva direto para o detalhe
              setTimeout(() => navigate(`/tickets/${ticket.id}`), 800);
            }}
            onCancel={() => navigate('/tickets')}
          />
        </div>
      </main>
    </div>
  );
}

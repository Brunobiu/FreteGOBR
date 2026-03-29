import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import TripSuggestion from '../components/TripSuggestion';
import FreteModal from '../components/FreteModal';
import type { Frete } from '../services/fretes';

export default function MotoristaHomePage() {
  const { user } = useAuth();
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFreteSelect = (frete: Frete) => {
    setSelectedFrete(frete);
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Bem-vindo, {user?.name}!</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Fretes Disponíveis</h2>
              <svg
                className="w-8 h-8 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">-</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>

          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Meus Fretes</h2>
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">-</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>

          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Ganhos do Mês</h2>
              <svg
                className="w-8 h-8 text-yellow-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">R$ -</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>
        </div>

        {/* Sugestão de Viagem */}
        <div className="mb-8">
          <TripSuggestion onFreteSelect={handleFreteSelect} />
        </div>
      </div>

      <FreteModal
        frete={selectedFrete}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedFrete(null);
        }}
      />
    </div>
  );
}

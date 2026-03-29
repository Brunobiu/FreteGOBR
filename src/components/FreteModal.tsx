import { useEffect } from 'react';
import type { Frete } from '../services/fretes';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface FreteModalProps {
  frete: Frete | null;
  isOpen: boolean;
  onClose: () => void;
  embarcadorWhatsApp?: string;
}

export default function FreteModal({
  frete,
  isOpen,
  onClose,
  embarcadorWhatsApp,
}: FreteModalProps) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !frete) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatWeight = (weight: number) => {
    if (weight >= 1000) {
      return `${(weight / 1000).toFixed(2)} toneladas`;
    }
    return `${weight} kg`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  const handleContratar = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (user?.userType !== 'motorista') {
      alert('Apenas motoristas podem contratar fretes');
      return;
    }

    // Open WhatsApp
    if (embarcadorWhatsApp) {
      const phone = embarcadorWhatsApp.replace(/\D/g, '');
      const message = encodeURIComponent(
        `Olá! Tenho interesse no frete de ${frete.origin} para ${frete.destination}.`
      );
      window.open(`https://wa.me/55${phone}?text=${message}`, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-75" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-gray-900 rounded-lg max-w-3xl w-full border border-gray-800 shadow-xl">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {/* Content */}
          <div className="p-8">
            <h2 className="text-2xl font-bold text-white mb-6">Detalhes do Frete</h2>

            {/* Route */}
            <div className="mb-6">
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <p className="text-sm text-gray-400 mb-1">Origem</p>
                  <p className="text-lg font-semibold text-white">{frete.origin}</p>
                </div>
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
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-gray-400 mb-1">Destino</p>
                  <p className="text-lg font-semibold text-white">{frete.destination}</p>
                </div>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Tipo de Carga</p>
                <p className="text-white font-medium capitalize">{frete.cargoType}</p>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Tipo de Veículo</p>
                <p className="text-white font-medium capitalize">{frete.vehicleType}</p>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Peso</p>
                <p className="text-white font-medium">{formatWeight(frete.weight)}</p>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Valor</p>
                <p className="text-green-400 font-bold text-lg">{formatCurrency(frete.value)}</p>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Prazo de Entrega</p>
                <p className="text-white font-medium">{formatDate(frete.deadline)}</p>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <p className="text-sm text-gray-400 mb-1">Tempo de Carga/Descarga</p>
                <p className="text-white font-medium">
                  {frete.loadingTime}min / {frete.unloadingTime}min
                </p>
              </div>
            </div>

            {/* Specifications */}
            {frete.specifications && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">Especificações</h3>
                <div className="bg-gray-800 p-4 rounded-lg">
                  <p className="text-gray-300">{frete.specifications}</p>
                </div>
              </div>
            )}

            {/* Analytics */}
            <div className="flex items-center space-x-6 mb-6 text-sm text-gray-400">
              <span className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path
                    fillRule="evenodd"
                    d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                    clipRule="evenodd"
                  />
                </svg>
                {frete.viewsCount} visualizações
              </span>
              <span className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                </svg>
                {frete.clicksCount} cliques
              </span>
            </div>

            {/* Action Button */}
            <div className="flex justify-end space-x-4">
              <button
                onClick={onClose}
                className="px-6 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600"
              >
                Fechar
              </button>
              <button
                onClick={handleContratar}
                className="px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                </svg>
                {isAuthenticated ? 'Contratar via WhatsApp' : 'Fazer Login para Contratar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

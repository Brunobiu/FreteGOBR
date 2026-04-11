import type { Frete } from '../services/fretes';
import { useAuth } from '../hooks/useAuth';
import { Link } from 'react-router-dom';

interface FreteCardProps {
  frete: Frete;
  onClick: () => void;
  hidePhone?: boolean;
}

export default function FreteCard({ frete, onClick }: FreteCardProps) {
  const { isAuthenticated } = useAuth();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatWeight = (weight: number) => {
    if (weight >= 1000) return `${(weight / 1000).toFixed(1)}t`;
    return `${weight}kg`;
  };

  const formatDate = (date: Date) => new Date(date).toLocaleDateString('pt-BR');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ativo': return 'bg-green-100 text-green-700 border-green-300';
      case 'encerrado': return 'bg-gray-100 text-gray-600 border-gray-300';
      case 'cancelado': return 'bg-red-100 text-red-700 border-red-300';
      default: return 'bg-gray-100 text-gray-600 border-gray-300';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'ativo': return 'Ativo';
      case 'encerrado': return 'Encerrado';
      case 'cancelado': return 'Cancelado';
      default: return status;
    }
  };

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer shadow-sm"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-800 mb-1">
            {frete.origin} → {frete.destination}
          </h3>
          <p className="text-sm text-gray-500">
            {frete.cargoType} • {frete.vehicleType}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(frete.status)}`}>
          {getStatusLabel(frete.status)}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Peso</p>
          <p className="text-sm font-medium text-gray-800">{formatWeight(frete.weight)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Valor</p>
          {isAuthenticated ? (
            <p className="text-sm font-medium text-green-600">{formatCurrency(frete.value)}</p>
          ) : (
            <Link
              to="/login"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-500 hover:text-blue-600 underline"
            >
              Faça login para ver
            </Link>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Prazo</p>
          <p className="text-sm font-medium text-gray-800">{formatDate(frete.deadline)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Visualizações</p>
          <p className="text-sm font-medium text-gray-800">{frete.viewsCount}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-200">
        <div className="flex items-center space-x-4 text-xs text-gray-500">
          <span className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
            {frete.viewsCount}
          </span>
        </div>
        <button className="text-blue-500 hover:text-blue-600 text-sm font-medium">
          Ver detalhes →
        </button>
      </div>

      {/* Banner para visitantes */}
      {!isAuthenticated && (
        <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg text-center">
          <p className="text-xs text-blue-600">
            <Link to="/login" onClick={(e) => e.stopPropagation()} className="font-medium underline">
              Crie uma conta grátis
            </Link>{' '}
            para ver valores e entrar em contato
          </p>
        </div>
      )}
    </div>
  );
}

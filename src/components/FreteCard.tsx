import type { Frete } from '../services/fretes';

interface FreteCardProps {
  frete: Frete;
  onClick: () => void;
  hidePhone?: boolean;
}

export default function FreteCard({ frete, onClick, hidePhone = false }: FreteCardProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatWeight = (weight: number) => {
    if (weight >= 1000) {
      return `${(weight / 1000).toFixed(1)}t`;
    }
    return `${weight}kg`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('pt-BR');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ativo':
        return 'bg-green-900/50 text-green-300 border-green-700';
      case 'encerrado':
        return 'bg-gray-700/50 text-gray-300 border-gray-600';
      case 'cancelado':
        return 'bg-red-900/50 text-red-300 border-red-700';
      default:
        return 'bg-gray-700/50 text-gray-300 border-gray-600';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'ativo':
        return 'Ativo';
      case 'encerrado':
        return 'Encerrado';
      case 'cancelado':
        return 'Cancelado';
      default:
        return status;
    }
  };

  return (
    <div
      onClick={onClick}
      className="bg-gray-900 border border-gray-800 rounded-lg p-6 hover:border-blue-500 transition-colors cursor-pointer"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white mb-1">
            {frete.origin} → {frete.destination}
          </h3>
          <p className="text-sm text-gray-400">
            {frete.cargoType} • {frete.vehicleType}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(frete.status)}`}
        >
          {getStatusLabel(frete.status)}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Peso</p>
          <p className="text-sm font-medium text-white">{formatWeight(frete.weight)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Valor</p>
          <p className="text-sm font-medium text-green-400">{formatCurrency(frete.value)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Prazo</p>
          <p className="text-sm font-medium text-white">{formatDate(frete.deadline)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Visualizações</p>
          <p className="text-sm font-medium text-white">{frete.viewsCount}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-800">
        <div className="flex items-center space-x-4 text-xs text-gray-400">
          <span className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
            {frete.viewsCount}
          </span>
          <span className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
            </svg>
            {frete.clicksCount}
          </span>
        </div>
        <button className="text-blue-400 hover:text-blue-300 text-sm font-medium">
          Ver detalhes →
        </button>
      </div>

      {hidePhone && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <p className="text-xs text-yellow-300">Faça login para ver informações de contato</p>
        </div>
      )}
    </div>
  );
}

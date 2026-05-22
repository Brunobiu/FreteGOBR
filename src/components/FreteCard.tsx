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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  const statusStyles: Record<string, string> = {
    ativo: 'bg-green-100 text-green-700',
    encerrado: 'bg-gray-100 text-gray-600',
    cancelado: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<string, string> = {
    ativo: 'Ativo',
    encerrado: 'Encerrado',
    cancelado: 'Cancelado',
  };

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer shadow-sm"
    >
      {/* Header: rota + status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">
          {frete.origin} → {frete.destination}
        </h3>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            statusStyles[frete.status] || 'bg-gray-100 text-gray-600'
          }`}
        >
          {statusLabels[frete.status] || frete.status}
        </span>
      </div>

      {/* Produto + Veículo (compacto, em uma linha cada) */}
      <div className="space-y-1 mb-2">
        {frete.product && (
          <p className="text-xs text-gray-700">
            <span className="text-gray-400">Produto:</span>{' '}
            <span className="font-medium">{frete.product}</span>
          </p>
        )}
        <p className="text-[11px] text-gray-500 truncate" title={frete.vehicleType}>
          {frete.vehicleType}
        </p>
      </div>

      {/* Linha de stats: valor + km + data */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="flex-1 min-w-0">
          {isAuthenticated ? (
            <p className="text-sm font-semibold text-green-600">{formatCurrency(frete.value)}</p>
          ) : (
            <Link
              to="/login"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-blue-500 hover:text-blue-600 underline"
            >
              Login para ver
            </Link>
          )}
        </div>
        {frete.distanceKm ? (
          <span className="text-[11px] text-gray-500 shrink-0">
            {frete.distanceKm.toLocaleString('pt-BR')} km
          </span>
        ) : null}
        <span className="text-[11px] text-gray-400 shrink-0">{formatDate(frete.createdAt)}</span>
      </div>

      {/* Banner para visitantes */}
      {!isAuthenticated && (
        <div className="mt-2 p-1.5 bg-blue-50 border border-blue-100 rounded text-center">
          <p className="text-[10px] text-blue-600">
            <Link
              to="/login"
              onClick={(e) => e.stopPropagation()}
              className="font-medium underline"
            >
              Crie uma conta grátis
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

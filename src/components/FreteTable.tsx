import { useState } from 'react';
import type { Frete } from '../services/fretes';

interface FreteTableProps {
  fretes: Frete[];
  isLoading?: boolean;
  onFreteClick: (frete: Frete) => void;
  onDelete?: (freteId: string) => void;
  showActions?: boolean;
}

type SortKey = 'origin' | 'destination' | 'cargoType' | 'vehicleType' | 'status' | 'deadline' | 'value';
type SortDir = 'asc' | 'desc';

const ITEMS_PER_PAGE = 10;

const STATUS_STYLES: Record<string, string> = {
  ativo: 'bg-green-100 text-green-700',
  encerrado: 'bg-gray-100 text-gray-600',
  cancelado: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  ativo: 'Ativo',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

export default function FreteTable({ fretes, isLoading, onFreteClick, onDelete, showActions }: FreteTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('deadline');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sorted = [...fretes].sort((a, b) => {
    let aVal: string | number = a[sortKey] as string | number;
    let bVal: string | number = b[sortKey] as string | number;
    if (sortKey === 'deadline') {
      aVal = new Date(a.deadline).getTime();
      bVal = new Date(b.deadline).getTime();
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE);
  const paginated = sorted.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none";

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
        <p className="text-gray-500">Carregando...</p>
      </div>
    );
  }

  if (fretes.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
        <p className="text-gray-600 font-medium">Nenhum frete encontrado</p>
        <p className="text-gray-400 text-sm mt-1">Os fretes aparecerão aqui quando forem publicados.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className={thClass} onClick={() => handleSort('origin')}>
                  Origem <SortIcon col="origin" />
                </th>
                <th className={thClass} onClick={() => handleSort('destination')}>
                  Destino <SortIcon col="destination" />
                </th>
                <th className={thClass} onClick={() => handleSort('cargoType')}>
                  Tipo de Carga <SortIcon col="cargoType" />
                </th>
                <th className={thClass} onClick={() => handleSort('vehicleType')}>
                  Veículo <SortIcon col="vehicleType" />
                </th>
                <th className={thClass} onClick={() => handleSort('value')}>
                  Valor <SortIcon col="value" />
                </th>
                <th className={thClass} onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className={thClass} onClick={() => handleSort('deadline')}>
                  Prazo <SortIcon col="deadline" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map((frete) => (
                <tr key={frete.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-800 font-medium">{frete.origin}</td>
                  <td className="px-4 py-3 text-gray-800">{frete.destination}</td>
                  <td className="px-4 py-3 text-gray-600">{frete.cargoType}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[120px] truncate" title={frete.vehicleType}>
                    {frete.vehicleType}
                  </td>
                  <td className="px-4 py-3 text-green-600 font-medium">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(frete.value)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[frete.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[frete.status] || frete.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(frete.deadline).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => onFreteClick(frete)}
                        className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                      >
                        Ver
                      </button>
                      {showActions && frete.status === 'ativo' && onDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(frete.id); }}
                          className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            {sorted.length} frete{sorted.length !== 1 ? 's' : ''} • Página {currentPage} de {totalPages}
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Anterior
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + i;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    page === currentPage
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

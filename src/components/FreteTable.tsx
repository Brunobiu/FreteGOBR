import { useState } from 'react';
import type { Frete } from '../services/fretes';

interface FreteTableProps {
  fretes: Frete[];
  isLoading?: boolean;
  onFreteClick: (frete: Frete) => void;
  onEdit?: (frete: Frete) => void;
  onDelete?: (freteId: string) => void;
  onToggleStatus?: (frete: Frete) => void;
  onValueChange?: (freteId: string, newValue: number) => Promise<void>;
  showActions?: boolean;
}

type SortKey =
  | 'origin'
  | 'destination'
  | 'product'
  | 'vehicleType'
  | 'distanceKm'
  | 'status'
  | 'createdAt'
  | 'value';
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

const formatBRLValue = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const parseBRLDigits = (digits: string): number => {
  if (!digits) return 0;
  return parseInt(digits) / 100;
};

const formatBRLFromDigits = (digits: string): string => {
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const reais = padded.slice(0, -2);
  const cents = padded.slice(-2);
  const formatted = reais.replace(/^0+/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${formatted || '0'},${cents}`;
};

export default function FreteTable({
  fretes,
  isLoading,
  onFreteClick,
  onEdit,
  onDelete,
  onToggleStatus,
  onValueChange,
  showActions,
}: FreteTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingValueDigits, setEditingValueDigits] = useState('');
  const [savingValue, setSavingValue] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sorted = [...fretes].sort((a, b) => {
    let aVal: string | number = (a as unknown as Record<string, string | number>)[sortKey] ?? '';
    let bVal: string | number = (b as unknown as Record<string, string | number>)[sortKey] ?? '';
    if (sortKey === 'createdAt') {
      aVal = new Date(a.createdAt).getTime();
      bVal = new Date(b.createdAt).getTime();
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

  const thClass =
    'px-2 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none';

  const tdClass = 'px-2 py-1.5 text-xs';

  const startEditValue = (frete: Frete) => {
    setEditingValueId(frete.id);
    setEditingValueDigits(Math.round(frete.value * 100).toString());
  };

  const cancelEditValue = () => {
    setEditingValueId(null);
    setEditingValueDigits('');
  };

  const commitEditValue = async (frete: Frete) => {
    if (!onValueChange) return cancelEditValue();
    const newValue = parseBRLDigits(editingValueDigits);
    if (newValue === frete.value) return cancelEditValue();
    setSavingValue(true);
    try {
      await onValueChange(frete.id, newValue);
    } finally {
      setSavingValue(false);
      cancelEditValue();
    }
  };

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
        <p className="text-gray-400 text-sm mt-1">
          Os fretes aparecerão aqui quando forem publicados.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full [&_tbody_td:nth-child(even)]:bg-gray-50/70">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className={thClass} onClick={() => handleSort('origin')}>
                  Origem <SortIcon col="origin" />
                </th>
                <th className={thClass} onClick={() => handleSort('destination')}>
                  Destino <SortIcon col="destination" />
                </th>
                <th className={thClass} onClick={() => handleSort('product')}>
                  Produto <SortIcon col="product" />
                </th>
                <th className={thClass} onClick={() => handleSort('vehicleType')}>
                  Veículo <SortIcon col="vehicleType" />
                </th>
                <th className={thClass} onClick={() => handleSort('distanceKm')}>
                  KM <SortIcon col="distanceKm" />
                </th>
                <th className={thClass} onClick={() => handleSort('value')}>
                  Valor <SortIcon col="value" />
                </th>
                <th className={thClass} onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className={thClass} onClick={() => handleSort('createdAt')}>
                  Postado em <SortIcon col="createdAt" />
                </th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide w-[60px]">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((frete) => (
                <tr
                  key={frete.id}
                  className="hover:bg-blue-50/30 transition-colors border-b border-gray-100"
                >
                  <td className={`${tdClass} text-gray-800 font-medium`}>{frete.origin}</td>
                  <td className={`${tdClass} text-gray-800`}>{frete.destination}</td>
                  <td className={`${tdClass} text-gray-700`}>{frete.product ?? '—'}</td>
                  <td
                    className={`${tdClass} text-gray-600 max-w-[100px] truncate`}
                    title={frete.vehicleType}
                  >
                    {frete.vehicleType}
                  </td>
                  <td className={`${tdClass} text-gray-600`}>
                    {frete.distanceKm ? `${frete.distanceKm.toLocaleString('pt-BR')} km` : '—'}
                  </td>
                  <td className={`${tdClass}`}>
                    {editingValueId === frete.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={editingValueDigits ? formatBRLFromDigits(editingValueDigits) : ''}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            setEditingValueDigits(digits);
                          }}
                          onBlur={() => commitEditValue(frete)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditValue(frete);
                            if (e.key === 'Escape') cancelEditValue();
                          }}
                          disabled={savingValue}
                          className="w-28 px-2 py-0.5 text-xs border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onValueChange) startEditValue(frete);
                        }}
                        className="text-green-600 font-semibold hover:underline"
                        title={onValueChange ? 'Clique para editar o valor' : undefined}
                      >
                        {formatBRLValue(frete.value)}
                      </button>
                    )}
                  </td>
                  <td className={`${tdClass}`}>
                    {showActions && onToggleStatus ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStatus(frete);
                        }}
                        title={
                          frete.status === 'ativo' ? 'Clique para encerrar' : 'Clique para reativar'
                        }
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium hover:opacity-80 cursor-pointer ${
                          STATUS_STYLES[frete.status] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABELS[frete.status] || frete.status}
                      </button>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          STATUS_STYLES[frete.status] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABELS[frete.status] || frete.status}
                      </span>
                    )}
                  </td>
                  <td className={`${tdClass} text-gray-600`}>
                    {new Date(frete.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className={tdClass}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => (onEdit ? onEdit(frete) : onFreteClick(frete))}
                        title={onEdit ? 'Editar' : 'Ver'}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      {showActions && onDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(frete.id);
                          }}
                          title="Excluir"
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
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
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-500">
            {sorted.length} frete{sorted.length !== 1 ? 's' : ''} • Página {currentPage} de{' '}
            {totalPages}
          </p>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Anterior
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + i;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

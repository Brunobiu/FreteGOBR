import { useState } from 'react';
import type { FreteFilters } from '../services/fretes';

interface FreteFiltersProps {
  onFilterChange: (filters: FreteFilters) => void;
  totalResults: number;
  /** Modo compacto: só ícone + popover do painel. */
  compact?: boolean;
}

const CARGO_TYPES = [
  { value: 'geral', label: 'Carga Geral' },
  { value: 'granel', label: 'Granel' },
  { value: 'refrigerada', label: 'Refrigerada' },
  { value: 'perigosa', label: 'Perigosa' },
  { value: 'fragil', label: 'Frágil' },
];

const VEHICLE_TYPES = [
  { value: 'truck', label: 'Caminhão' },
  { value: 'van', label: 'Van' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'carreta', label: 'Carreta' },
];

export default function FreteFilters({
  onFilterChange,
  totalResults,
  compact = false,
}: FreteFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filters, setFilters] = useState<FreteFilters>({});

  const updateFilter = (key: keyof FreteFilters, value: string | number | undefined) => {
    const updated = { ...filters, [key]: value || undefined };
    // Remove undefined keys
    Object.keys(updated).forEach((k) => {
      if (
        updated[k as keyof FreteFilters] === undefined ||
        updated[k as keyof FreteFilters] === ''
      ) {
        delete updated[k as keyof FreteFilters];
      }
    });
    setFilters(updated);
    onFilterChange(updated);
  };

  const clearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  const activeFilterCount = Object.keys(filters).length;

  if (compact) {
    return (
      <div className="relative h-full">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label="Filtros"
          title={`Filtros${activeFilterCount > 0 ? ` (${activeFilterCount} ativos)` : ''}`}
          className="relative w-full h-full flex items-center justify-center bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 transition-colors"
        >
          <svg
            className="w-5 h-5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
            />
          </svg>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {isExpanded && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setIsExpanded(false)}
            />
            <div className="absolute top-full left-0 right-0 sm:right-auto sm:w-[28rem] mt-1 z-40 bg-white border border-gray-200 rounded-md shadow-xl">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-700">Filtros</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">
                    {totalResults} resultado{totalResults !== 1 ? 's' : ''}
                  </span>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearFilters}
                      className="text-[11px] text-red-500 hover:text-red-600"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">{filterFields()}</div>
            </div>
          </>
        )}
      </div>
    );
  }

  function filterFields() {
    return (
      <>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Origem</label>
          <input
            type="text"
            value={filters.origin || ''}
            onChange={(e) => updateFilter('origin', e.target.value)}
            placeholder="Ex: Goiânia, GO"
            className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Destino</label>
          <input
            type="text"
            value={filters.destination || ''}
            onChange={(e) => updateFilter('destination', e.target.value)}
            placeholder="Ex: São Paulo, SP"
            className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
            Tipo de Carga
          </label>
          <select
            value={filters.cargoType || ''}
            onChange={(e) => updateFilter('cargoType', e.target.value)}
            className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {CARGO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
            Tipo de Veículo
          </label>
          <select
            value={filters.vehicleType || ''}
            onChange={(e) => updateFilter('vehicleType', e.target.value)}
            className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {VEHICLE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Peso (kg)</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={filters.minWeight || ''}
              onChange={(e) =>
                updateFilter('minWeight', e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="Mín"
              min={0}
              className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              value={filters.maxWeight || ''}
              onChange={(e) =>
                updateFilter('maxWeight', e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="Máx"
              min={0}
              className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Valor (R$)</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={filters.minValue || ''}
              onChange={(e) =>
                updateFilter('minValue', e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="Mín"
              min={0}
              className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              value={filters.maxValue || ''}
              onChange={(e) =>
                updateFilter('maxValue', e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="Máx"
              min={0}
              className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-md mb-3 shadow-sm">
      {/* Header compacto */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div
          className="flex items-center gap-2 flex-1 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
            />
          </svg>
          <span className="text-gray-700 text-xs font-medium">Filtros</span>
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0 bg-blue-600 text-white text-[10px] rounded-full">
              {activeFilterCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {totalResults} resultado{totalResults !== 1 ? 's' : ''}
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearFilters();
              }}
              className="text-[11px] text-red-500 hover:text-red-600"
            >
              Limpar
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? 'Recolher filtros' : 'Expandir filtros'}
            className="p-0.5 text-gray-400 hover:text-gray-600"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter Fields */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Origem */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Origem</label>
            <input
              type="text"
              value={filters.origin || ''}
              onChange={(e) => updateFilter('origin', e.target.value)}
              placeholder="Ex: Goiânia, GO"
              className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Destino */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Destino</label>
            <input
              type="text"
              value={filters.destination || ''}
              onChange={(e) => updateFilter('destination', e.target.value)}
              placeholder="Ex: São Paulo, SP"
              className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Tipo de Carga */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
              Tipo de Carga
            </label>
            <select
              value={filters.cargoType || ''}
              onChange={(e) => updateFilter('cargoType', e.target.value)}
              className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              {CARGO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Tipo de Veículo */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
              Tipo de Veículo
            </label>
            <select
              value={filters.vehicleType || ''}
              onChange={(e) => updateFilter('vehicleType', e.target.value)}
              className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              {VEHICLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Peso */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Peso (kg)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={filters.minWeight || ''}
                onChange={(e) =>
                  updateFilter('minWeight', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Mín"
                min={0}
                className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                value={filters.maxWeight || ''}
                onChange={(e) =>
                  updateFilter('maxWeight', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Máx"
                min={0}
                className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Valor (R$)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={filters.minValue || ''}
                onChange={(e) =>
                  updateFilter('minValue', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Mín"
                min={0}
                className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                value={filters.maxValue || ''}
                onChange={(e) =>
                  updateFilter('maxValue', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Máx"
                min={0}
                className="w-1/2 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

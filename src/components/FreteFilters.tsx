import { useState } from 'react';
import type { FreteFilters } from '../services/fretes';

interface FreteFiltersProps {
  onFilterChange: (filters: FreteFilters) => void;
  totalResults: number;
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

export default function FreteFilters({ onFilterChange, totalResults }: FreteFiltersProps) {
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

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-6 shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-3">
          <svg
            className="w-5 h-5 text-gray-400"
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
          <span className="text-gray-800 font-medium">Filtros</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
              {activeFilterCount}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">
            {totalResults} resultado{totalResults !== 1 ? 's' : ''}
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearFilters();
              }}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Limpar filtros
            </button>
          )}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Filter Fields */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Origem */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Origem</label>
            <input
              type="text"
              value={filters.origin || ''}
              onChange={(e) => updateFilter('origin', e.target.value)}
              placeholder="Ex: Goiânia, GO"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Destino */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destino</label>
            <input
              type="text"
              value={filters.destination || ''}
              onChange={(e) => updateFilter('destination', e.target.value)}
              placeholder="Ex: São Paulo, SP"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tipo de Carga */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de Carga</label>
            <select
              value={filters.cargoType || ''}
              onChange={(e) => updateFilter('cargoType', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de Veículo</label>
            <select
              value={filters.vehicleType || ''}
              onChange={(e) => updateFilter('vehicleType', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Peso (kg)</label>
            <div className="flex space-x-2">
              <input
                type="number"
                value={filters.minWeight || ''}
                onChange={(e) =>
                  updateFilter('minWeight', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Mín"
                min={0}
                className="w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                value={filters.maxWeight || ''}
                onChange={(e) =>
                  updateFilter('maxWeight', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Máx"
                min={0}
                className="w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$)</label>
            <div className="flex space-x-2">
              <input
                type="number"
                value={filters.minValue || ''}
                onChange={(e) =>
                  updateFilter('minValue', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Mín"
                min={0}
                className="w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                value={filters.maxValue || ''}
                onChange={(e) =>
                  updateFilter('maxValue', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Máx"
                min={0}
                className="w-1/2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

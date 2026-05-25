/**
 * FretesFilters - filtros compactos, expansíveis num popover.
 * Versão enxuta: por padrão exibe só o botão "Filtros" + busca + checkbox.
 */

import { useEffect, useRef, useState } from 'react';
import type { FretesFilters } from '../../../services/admin/fretes';

interface Props {
  filters: FretesFilters;
  onChange: (next: FretesFilters) => void;
  totalFiltered: number;
}

export default function FretesFiltersUI({ filters, onChange, totalFiltered }: Props) {
  const [qLocal, setQLocal] = useState(filters.q);
  const [dateError, setDateError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Debounce do campo de busca (300ms) — só q
  useEffect(() => {
    const id = setTimeout(() => {
      if (qLocal !== filters.q) {
        onChange({ ...filters, q: qLocal, page: 1 });
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  useEffect(() => {
    if (filters.q !== qLocal) setQLocal(filters.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // Click fora fecha popover
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function handleDateChange(field: 'from' | 'to', value: string | null) {
    const next = { ...filters, [field]: value || null, page: 1 };
    if (next.from && next.to && next.from > next.to) {
      setDateError('Data inicial deve ser menor ou igual a final.');
      return;
    }
    setDateError(null);
    onChange(next);
  }

  const activeFilters =
    (filters.status !== 'todos' ? 1 : 0) +
    (filters.sort !== 'created_desc' ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.flagged ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Busca compacta */}
      <input
        type="search"
        value={qLocal}
        onChange={(e) => setQLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQLocal('');
        }}
        placeholder="Buscar..."
        aria-label="Buscar fretes"
        className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 focus:outline-none focus:border-cyan-500 w-44"
      />

      {/* Botão de filtros */}
      <div className="relative" ref={popRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir filtros"
          aria-expanded={open}
          className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
            activeFilters > 0
              ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
          }`}
          title="Filtros"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          {activeFilters > 0 && (
            <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">
              {activeFilters}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    status: e.target.value as FretesFilters['status'],
                    page: 1,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="todos">Todos</option>
                <option value="ativo">Ativos</option>
                <option value="encerrado">Encerrados</option>
                <option value="cancelado">Cancelados</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Ordenar por
              </label>
              <select
                value={filters.sort}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    sort: e.target.value as FretesFilters['sort'],
                    page: 1,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="created_desc">Mais recentes</option>
                <option value="created_asc">Mais antigos</option>
                <option value="value_desc">Maior valor</option>
                <option value="value_asc">Menor valor</option>
                <option value="clicks_desc">Mais cliques</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  De
                </label>
                <input
                  type="date"
                  value={filters.from ?? ''}
                  onChange={(e) => handleDateChange('from', e.target.value || null)}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Até
                </label>
                <input
                  type="date"
                  value={filters.to ?? ''}
                  onChange={(e) => handleDateChange('to', e.target.value || null)}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-300 pt-1">
              <input
                type="checkbox"
                checked={filters.flagged}
                onChange={(e) => onChange({ ...filters, flagged: e.target.checked, page: 1 })}
              />
              Apenas sinalizados
            </label>

            {dateError && (
              <div className="text-[11px] text-red-400" role="alert">
                {dateError}
              </div>
            )}

            <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-800">
              {totalFiltered} fretes filtrados
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * TrialFilters - filtros compactos em popover para a listagem de trial admin.
 *
 * Padrao herdado de `UsersFilters.tsx` / `FretesFilters.tsx` / `BlacklistFilters.tsx`:
 * botao de icone (`SlidersHorizontal`) abre um popover ancorado a direita,
 * NUNCA um painel inline largo. Fecha ao clicar fora ou com Esc.
 *
 * Conteudo do popover:
 *   - Select de status do trial (todos / em trial / expirado / assinante) — Req 10.2.
 *   - Toggle "Prestes a expirar" (`aboutToExpire`: `0 < days_left <= 5`) — Req 10.3.
 *
 * Componente CONTROLADO: recebe `filters` e propaga mudancas via `onChange`,
 * preservando os demais campos de `TrialFilters` (q/sort/page/pageSize) e
 * resetando `page` para 1 a cada alteracao de filtro (padrao da casa).
 *
 * Props `{ filters, onChange }` espelham exatamente a assinatura de
 * `UsersFilters`/`FretesFilters`/`BlacklistFilters` (Req 10.5: estilo de UI
 * compacto consistente do painel admin).
 *
 * O icone SlidersHorizontal e renderizado como SVG inline (mesma geometria do
 * `lucide-react`), seguindo a convencao do projeto de NAO introduzir novas
 * dependencias de icones — todos os filtros admin usam SVG inline.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  TrialFilters as TrialFiltersType,
  TrialStatusFilter,
} from '../../../services/admin/trial';

interface Props {
  filters: TrialFiltersType;
  onChange: (next: TrialFiltersType) => void;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: TrialStatusFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'em_trial', label: 'Em trial' },
  { value: 'expirado', label: 'Expirado' },
  { value: 'assinante', label: 'Assinante' },
];

export default function TrialFilters({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Fecha popover ao clicar fora
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

  // Fecha popover ao pressionar Esc
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const activeFilters = (filters.status !== 'todos' ? 1 : 0) + (filters.aboutToExpire ? 1 : 0);

  return (
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
        {/* SlidersHorizontal (lucide) como SVG inline */}
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <line x1="21" x2="14" y1="4" y2="4" />
          <line x1="10" x2="3" y1="4" y2="4" />
          <line x1="21" x2="12" y1="12" y2="12" />
          <line x1="8" x2="3" y1="12" y2="12" />
          <line x1="21" x2="16" y1="20" y2="20" />
          <line x1="12" x2="3" y1="20" y2="20" />
          <line x1="14" x2="14" y1="2" y2="6" />
          <line x1="8" x2="8" y1="10" y2="14" />
          <line x1="16" x2="16" y1="18" y2="22" />
        </svg>
        {activeFilters > 0 && (
          <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">{activeFilters}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-30 w-64 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Status do trial
            </label>
            <select
              value={filters.status}
              onChange={(e) =>
                onChange({
                  ...filters,
                  status: e.target.value as TrialStatusFilter,
                  page: 1,
                })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.aboutToExpire}
              onChange={(e) =>
                onChange({
                  ...filters,
                  aboutToExpire: e.target.checked,
                  page: 1,
                })
              }
              className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500"
            />
            Prestes a expirar
          </label>
          <p className="text-[10px] text-gray-500 -mt-1">Faltam 5 dias ou menos para expirar.</p>
        </div>
      )}
    </div>
  );
}

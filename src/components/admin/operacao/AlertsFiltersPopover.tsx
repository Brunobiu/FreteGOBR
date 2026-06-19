/**
 * AlertsFiltersPopover — filtros da lista de alertas (estado/tipo/severidade)
 * em popover (ícone funil), tema escuro. A busca só dispara em "Aplicar";
 * click-outside/Esc fecham sem aplicar. Todos os campos são domínios fechados
 * (selects) — sempre válidos.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  AlertFilters,
  AlertSeverity,
  AlertState,
  AlertType,
} from '../../../services/admin/operacao';
import { ALERT_TYPES, ALERT_TYPE_LABEL } from './labels';

interface Props {
  filters: AlertFilters;
  onApply: (next: AlertFilters) => void;
}

const FUNNEL =
  'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z';

const STATE_OPTIONS: Array<[AlertState, string]> = [
  ['OPEN', 'Aberto'],
  ['ACKNOWLEDGED', 'Reconhecido'],
  ['RESOLVED', 'Resolvido'],
];

const SEVERITY_OPTIONS: Array<[AlertSeverity, string]> = [
  ['CRITICAL', 'Crítico'],
  ['WARNING', 'Alerta'],
  ['INFO', 'Info'],
];

export default function AlertsFiltersPopover({ filters, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AlertFilters>(filters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(filters), [filters]);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount =
    (filters.state ? 1 : 0) + (filters.type ? 1 : 0) + (filters.severity ? 1 : 0);

  function apply() {
    onApply(draft);
    setOpen(false);
  }

  function clear() {
    const empty: AlertFilters = {};
    setDraft(empty);
    onApply(empty);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir filtros"
        aria-expanded={open}
        title="Filtros"
        className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
          activeCount > 0
            ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FUNNEL} />
        </svg>
        {activeCount > 0 && (
          <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">{activeCount}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filtros de alertas"
          className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2"
        >
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Estado
            </label>
            <select
              value={draft.state ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, state: (e.target.value || undefined) as AlertState | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              {STATE_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo
            </label>
            <select
              value={draft.type ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, type: (e.target.value || undefined) as AlertType | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              {ALERT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ALERT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Severidade
            </label>
            <select
              value={draft.severity ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  severity: (e.target.value || undefined) as AlertSeverity | undefined,
                })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todas</option>
              {SEVERITY_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-gray-800">
            <button
              type="button"
              onClick={clear}
              className="text-[11px] px-2 py-1 rounded text-gray-400 hover:text-gray-200"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={apply}
              className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

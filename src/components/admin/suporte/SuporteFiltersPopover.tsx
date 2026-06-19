/**
 * SuporteFiltersPopover — filtros em popover (ícone funil), tema escuro.
 *
 * A busca SÓ dispara no botão "Aplicar" (Req 2.5, 2.10): alterar valores sem
 * aplicar mantém a última busca. Click-outside fecha sem aplicar.
 */

import { useEffect, useRef, useState } from 'react';
import { TICKET_STATUSES, type TicketStatus } from '../../../services/admin/suporte/statusMachine';
import type { PriorityLevel } from '../../../services/admin/suporte/priorityClassifier';
import type { ResponderMode } from '../../../services/admin/suporte/responderModeReducer';
import { STATUS_DISPLAY_MAP } from '../../../services/admin/suporte/statusMachine';
import type { ListTicketsFilters } from '../../../services/admin/suporte';

interface Props {
  filters: ListTicketsFilters;
  onApply: (next: ListTicketsFilters) => void;
}

const FUNNEL =
  'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z';

export default function SuporteFiltersPopover({ filters, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListTicketsFilters>(filters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(filters), [filters]);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const activeCount =
    (filters.status ? 1 : 0) +
    (filters.priorityLevel != null ? 1 : 0) +
    (filters.responderMode ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.search && filters.search.trim() ? 1 : 0);

  function apply() {
    onApply(draft);
    setOpen(false);
  }

  function clear() {
    const empty: ListTicketsFilters = {};
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
        <div className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Status</label>
            <select
              value={draft.status ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, status: (e.target.value || undefined) as TicketStatus | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_DISPLAY_MAP[s].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Prioridade</label>
              <select
                value={draft.priorityLevel ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    priorityLevel: e.target.value ? (Number(e.target.value) as PriorityLevel) : undefined,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="">Todas</option>
                <option value="1">Nível 1</option>
                <option value="2">Nível 2</option>
                <option value="3">Crítico</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Responsável</label>
              <select
                value={draft.responderMode ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, responderMode: (e.target.value || undefined) as ResponderMode | undefined })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="">Todos</option>
                <option value="ai">IA</option>
                <option value="human">Humano</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">De</label>
              <input
                type="date"
                value={draft.dateFrom ?? ''}
                onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value || undefined })}
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Até</label>
              <input
                type="date"
                value={draft.dateTo ?? ''}
                onChange={(e) => setDraft({ ...draft, dateTo: e.target.value || undefined })}
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Busca</label>
            <input
              type="search"
              value={draft.search ?? ''}
              onChange={(e) => setDraft({ ...draft, search: e.target.value || undefined })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply();
              }}
              placeholder="Assunto, nome, e-mail..."
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
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

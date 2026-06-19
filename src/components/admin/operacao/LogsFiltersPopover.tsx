/**
 * LogsFiltersPopover — filtros do Painel de Logs (tipo de evento, intervalo de
 * datas, ator, tipo de alvo) em popover (ícone funil).
 *
 * Validação client-side (defesa em profundidade — o backend revalida): ator
 * deve ser um UUID válido; data inicial ≤ final. Quando inválido, o botão
 * "Aplicar" fica desabilitado E uma mensagem pt-BR é exibida (testing-governance).
 * As datas (YYYY-MM-DD) são convertidas para timestamptz ISO ao aplicar.
 */

import { useEffect, useRef, useState } from 'react';
import type { LogFilters, LogEventType } from '../../../services/admin/operacao';
import { LOG_EVENT_TYPES, LOG_EVENT_LABEL } from '../../../services/admin/operacao/logEventMap';

interface Props {
  filters: LogFilters;
  onApply: (next: LogFilters) => void;
}

const FUNNEL =
  'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rascunho local em formato de formulário (datas YYYY-MM-DD, tipo único). */
interface Draft {
  eventType: LogEventType | '';
  fromDate: string;
  toDate: string;
  actor: string;
  targetType: string;
}

function toDraft(f: LogFilters): Draft {
  return {
    eventType: f.eventTypes && f.eventTypes.length === 1 ? f.eventTypes[0] : '',
    fromDate: f.from && DATE_RE.test(f.from.slice(0, 10)) ? f.from.slice(0, 10) : '',
    toDate: f.to && DATE_RE.test(f.to.slice(0, 10)) ? f.to.slice(0, 10) : '',
    actor: f.actor ?? '',
    targetType: f.targetType ?? '',
  };
}

export default function LogsFiltersPopover({ filters, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(filters));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(toDraft(filters)), [filters]);

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

  // Validação (bloqueia "Aplicar" + mensagem pt-BR).
  let validationError: string | null = null;
  if (draft.actor.trim() && !UUID_RE.test(draft.actor.trim())) {
    validationError = 'O ator deve ser um UUID válido.';
  } else if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
    validationError = 'A data inicial deve ser menor ou igual à final.';
  }

  const activeCount =
    (filters.eventTypes && filters.eventTypes.length ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.actor ? 1 : 0) +
    (filters.targetType ? 1 : 0);

  function apply() {
    if (validationError) return;
    const next: LogFilters = {};
    if (draft.eventType) next.eventTypes = [draft.eventType];
    if (draft.fromDate) next.from = `${draft.fromDate}T00:00:00Z`;
    if (draft.toDate) next.to = `${draft.toDate}T23:59:59Z`;
    if (draft.actor.trim()) next.actor = draft.actor.trim();
    if (draft.targetType.trim()) next.targetType = draft.targetType.trim();
    onApply(next);
    setOpen(false);
  }

  function clear() {
    setDraft({ eventType: '', fromDate: '', toDate: '', actor: '', targetType: '' });
    onApply({});
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
          aria-label="Filtros de logs"
          className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2"
        >
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo de evento
            </label>
            <select
              value={draft.eventType}
              onChange={(e) =>
                setDraft({ ...draft, eventType: (e.target.value || '') as LogEventType | '' })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              {LOG_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LOG_EVENT_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">De</label>
              <input
                type="date"
                value={draft.fromDate}
                onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Até</label>
              <input
                type="date"
                value={draft.toDate}
                onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Ator (UUID)
            </label>
            <input
              type="text"
              value={draft.actor}
              onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo de alvo
            </label>
            <input
              type="text"
              value={draft.targetType}
              onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}
              placeholder="ex: system_alerts"
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
          </div>

          {validationError && (
            <div role="alert" className="text-[11px] text-red-400">
              {validationError}
            </div>
          )}

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
              disabled={!!validationError}
              className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

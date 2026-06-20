/**
 * DiagnosticsFiltersPopover — filtros da Central de Diagnóstico (módulo/
 * severidade/intervalo de datas) em popover.
 *
 * Validação client-side (defesa em profundidade): data inicial ≤ final. Quando
 * inválido, "Aplicar" fica desabilitado E uma mensagem pt-BR é exibida
 * (testing-governance). As datas (YYYY-MM-DD) viram timestamptz ISO ao aplicar.
 */

import { useEffect, useRef, useState } from 'react';
import type { DiagnosticFilters, InsightSeverity } from '../../../services/admin/supervisor';

interface Props {
  filters: DiagnosticFilters;
  onApply: (next: DiagnosticFilters) => void;
}

const FUNNEL =
  'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY_OPTIONS: Array<[InsightSeverity, string]> = [
  ['CRITICAL', 'Crítico'],
  ['WARNING', 'Alerta'],
  ['INFO', 'Info'],
];

interface Draft {
  module: string;
  severity: InsightSeverity | '';
  fromDate: string;
  toDate: string;
}

function toDraft(f: DiagnosticFilters): Draft {
  return {
    module: f.module ?? '',
    severity: (f.severity as InsightSeverity) ?? '',
    fromDate: f.from && DATE_RE.test(f.from.slice(0, 10)) ? f.from.slice(0, 10) : '',
    toDate: f.to && DATE_RE.test(f.to.slice(0, 10)) ? f.to.slice(0, 10) : '',
  };
}

export default function DiagnosticsFiltersPopover({ filters, onApply }: Props) {
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

  let validationError: string | null = null;
  if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
    validationError = 'A data inicial deve ser menor ou igual à final.';
  }

  const activeCount =
    (filters.module ? 1 : 0) + (filters.severity ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  function apply() {
    if (validationError) return;
    const next: DiagnosticFilters = {};
    if (draft.module.trim()) next.module = draft.module.trim();
    if (draft.severity) next.severity = draft.severity;
    if (draft.fromDate) next.from = `${draft.fromDate}T00:00:00Z`;
    if (draft.toDate) next.to = `${draft.toDate}T23:59:59Z`;
    onApply(next);
    setOpen(false);
  }
  function clear() {
    setDraft({ module: '', severity: '', fromDate: '', toDate: '' });
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
          aria-label="Filtros de diagnóstico"
          className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2"
        >
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Módulo</label>
            <input
              type="text"
              value={draft.module}
              onChange={(e) => setDraft({ ...draft, module: e.target.value })}
              placeholder="ex: whatsapp, financeiro"
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Severidade</label>
            <select
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: (e.target.value || '') as InsightSeverity | '' })}
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

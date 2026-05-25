/**
 * DashboardFilterPopover - filtros globais do dashboard.
 *
 * Padrao herdado de UsersFilters/FretesFilters/BlacklistFilters: botao de
 * icone com popover. Em mobile (<768px), o popover ocupa quase toda a tela
 * (largura adaptativa).
 *
 * Validacoes client-side:
 *   - period=custom + from > to ⇒ erro inline, botao Aplicar desabilitado
 *   - period=custom + (to - from) > 365 dias ⇒ erro inline
 */

import { useEffect, useRef, useState } from 'react';
import {
  UF_BR,
  type DashboardFilters,
  type DashboardPeriodPreset,
  type DashboardUserType,
  type UF,
} from '../../../services/admin/dashboard';

interface Props {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}

const MAX_DAYS = 365;

function diffDays(fromIso: string, toIso: string): number {
  const f = new Date(`${fromIso}T00:00:00Z`).getTime();
  const t = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(f) || Number.isNaN(t)) return -1;
  return Math.floor((t - f) / (24 * 3600 * 1000));
}

export default function DashboardFilterPopover({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardFilters>(filters);
  const popRef = useRef<HTMLDivElement>(null);

  // Sincroniza rascunho quando filtros externos mudam
  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
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
  if (draft.period === 'custom') {
    if (!draft.from || !draft.to) {
      validationError = 'Informe a data inicial e final.';
    } else if (draft.from > draft.to) {
      validationError = 'Data inicial deve ser menor ou igual à final.';
    } else if (diffDays(draft.from, draft.to) > MAX_DAYS) {
      validationError = `Período máximo de ${MAX_DAYS} dias.`;
    }
  }

  const activeCount =
    (filters.period !== '7d' ? 1 : 0) + (filters.userType !== 'all' ? 1 : 0) + (filters.uf ? 1 : 0);

  function applyDraft() {
    if (validationError) return;
    onChange(draft);
    setOpen(false);
  }

  function cancelDraft() {
    setDraft(filters);
    setOpen(false);
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir filtros"
        aria-expanded={open}
        className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
          activeCount > 0
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
        {activeCount > 0 && (
          <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">{activeCount}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filtros do dashboard"
          className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2"
        >
          <div>
            <label
              htmlFor="dash-period"
              className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
            >
              Período
            </label>
            <select
              id="dash-period"
              value={draft.period}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  period: e.target.value as DashboardPeriodPreset,
                  from: null,
                  to: null,
                })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="custom">Customizado</option>
            </select>
          </div>

          {draft.period === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="dash-from"
                  className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
                >
                  De
                </label>
                <input
                  id="dash-from"
                  type="date"
                  value={draft.from ?? ''}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value || null })}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="dash-to"
                  className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
                >
                  Até
                </label>
                <input
                  id="dash-to"
                  type="date"
                  value={draft.to ?? ''}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value || null })}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="dash-utype"
              className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
            >
              Tipo de usuário
            </label>
            <select
              id="dash-utype"
              value={draft.userType}
              onChange={(e) =>
                setDraft({ ...draft, userType: e.target.value as DashboardUserType })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="all">Todos</option>
              <option value="motorista">Motoristas</option>
              <option value="embarcador">Embarcadores</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="dash-uf"
              className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
            >
              UF
            </label>
            <select
              id="dash-uf"
              value={draft.uf ?? ''}
              onChange={(e) => setDraft({ ...draft, uf: (e.target.value || null) as UF | null })}
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todas</option>
              {UF_BR.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>

          {validationError && (
            <div role="alert" className="text-[11px] text-red-400">
              {validationError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-800">
            <button
              type="button"
              onClick={cancelDraft}
              className="px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={applyDraft}
              disabled={!!validationError}
              className="px-2.5 py-1 rounded text-xs bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

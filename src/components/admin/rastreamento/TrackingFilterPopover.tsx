/**
 * TrackingFilterPopover — filtros do Tracking_Filter em popover (ícone
 * `SlidersHorizontal`), NUNCA painel inline largo. Aplica SOMENTE na ação
 * explícita "Aplicar" (alterar valores sem aplicar mantém a última busca —
 * Req 13.4). Fecha ao clicar fora / Esc.
 *
 * _Requirements: 1.6, 13.1, 13.2, 13.4_
 */

import { useEffect, useRef, useState } from 'react';
import {
  ABANDONMENT_CAUSES,
  RISK_CATEGORIES,
  type AbandonmentCause,
  type RiskCategory,
} from '../../../services/admin/rastreamento/domain';
import type { TrackingFilterInput } from '../../../services/admin/rastreamento/atRiskList';
import { ABANDONMENT_CAUSE_LABELS, RISK_CATEGORY_LABELS } from './labels';

interface Props {
  applied: TrackingFilterInput;
  onApply: (filter: TrackingFilterInput) => void;
}

function countActive(f: TrackingFilterInput): number {
  return [
    f.text,
    f.risk_category,
    f.problem_type,
    f.profile,
    f.min_score,
    f.max_score,
    f.from,
    f.to,
  ].filter((v) => v !== undefined && v !== '').length;
}

export default function TrackingFilterPopover({ applied, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TrackingFilterInput>(applied);
  const ref = useRef<HTMLDivElement>(null);

  // Sincroniza o rascunho quando o filtro aplicado muda externamente.
  useEffect(() => {
    setDraft(applied);
  }, [applied]);

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

  const active = countActive(applied);

  const set = (patch: Partial<TrackingFilterInput>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir filtros"
        aria-expanded={open}
        title="Filtros"
        className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
          active > 0
            ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
        }`}
      >
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
        {active > 0 && (
          <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">{active}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Nome ou telefone
            </label>
            <input
              type="text"
              value={draft.text ?? ''}
              onChange={(e) => set({ text: e.target.value || undefined })}
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              placeholder="Buscar…"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Categoria
            </label>
            <select
              value={draft.risk_category ?? ''}
              onChange={(e) =>
                set({ risk_category: (e.target.value || undefined) as RiskCategory | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todas</option>
              {RISK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {RISK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Tipo de problema
            </label>
            <select
              value={draft.problem_type ?? ''}
              onChange={(e) =>
                set({ problem_type: (e.target.value || undefined) as AbandonmentCause | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              {ABANDONMENT_CAUSES.map((c) => (
                <option key={c} value={c}>
                  {ABANDONMENT_CAUSE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Perfil
            </label>
            <select
              value={draft.profile ?? ''}
              onChange={(e) =>
                set({ profile: (e.target.value || undefined) as 'motorista' | 'embarcador' | undefined })
              }
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            >
              <option value="">Todos</option>
              <option value="motorista">Motorista</option>
              <option value="embarcador">Embarcador</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Score mín.
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.min_score ?? ''}
                onChange={(e) =>
                  set({ min_score: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Score máx.
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.max_score ?? ''}
                onChange={(e) =>
                  set({ max_score: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setDraft({});
                onApply({});
                setOpen(false);
              }}
              className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

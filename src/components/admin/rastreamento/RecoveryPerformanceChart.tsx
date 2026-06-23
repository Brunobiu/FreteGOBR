/**
 * RecoveryPerformanceChart — desempenho da recuperação em SVG inline.
 *
 * Barras por `Contact_Status` (AT_RISK/CONTACTED/REPLIED/CONVERTED) + Recovery_Rate
 * (`CONVERTED/CONTACTED`). Seleção de `Time_Window`. Bloco isolado por
 * `Partial_Degradation`.
 *
 * _Requirements: 11.1, 11.7, 8.8_
 */

import type { RecoveryBundle } from '../../../services/admin/rastreamento';
import { TIME_WINDOWS, type TimeWindow } from '../../../services/admin/rastreamento/domain';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { CONTACT_STATUS_LABELS } from './labels';

interface Props {
  bundle: RecoveryBundle;
  onWindowChange: (window: TimeWindow) => void;
  onRetry: () => void;
}

const ORDER = ['AT_RISK', 'CONTACTED', 'REPLIED', 'CONVERTED'] as const;
const BAR_MAX = 200;
const ROW_H = 26;

export default function RecoveryPerformanceChart({ bundle, onWindowChange, onRetry }: Props) {
  const max = Math.max(1, ...ORDER.map((k) => bundle.counts[k] ?? 0));

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">
          Desempenho da recuperação
        </div>
        <div className="flex gap-1" role="group" aria-label="Janela de tempo">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindowChange(w)}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                bundle.window === w
                  ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {bundle.errors.recovery ? (
        <DashboardBlockError message={bundle.errors.recovery} onRetry={onRetry} />
      ) : (
        <>
          <svg
            role="img"
            aria-label="Contadores de recuperação por status"
            width="100%"
            height={ORDER.length * ROW_H + 8}
            viewBox={`0 0 320 ${ORDER.length * ROW_H + 8}`}
            preserveAspectRatio="none"
          >
            {ORDER.map((key, i) => {
              const count = bundle.counts[key] ?? 0;
              const w = Math.round((count / max) * BAR_MAX);
              const y = i * ROW_H + 4;
              return (
                <g key={key}>
                  <rect x={90} y={y} width={BAR_MAX} height={ROW_H - 10} rx={2} fill="#1f2937" />
                  <rect x={90} y={y} width={w} height={ROW_H - 10} rx={2} fill="#22c55e" />
                  <text x={0} y={y + 11} fontSize={9} fill="#9ca3af">
                    {CONTACT_STATUS_LABELS[key]}
                  </text>
                  <text x={90 + BAR_MAX + 4} y={y + 11} fontSize={9} fill="#e5e7eb">
                    {count}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="rounded border border-gray-800 px-2 py-1 inline-block text-[11px]">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Taxa de recuperação
            </span>{' '}
            <span className="text-gray-200 font-semibold">
              {Math.round(bundle.recovery_rate * 100)}%
            </span>
          </div>
        </>
      )}
    </section>
  );
}

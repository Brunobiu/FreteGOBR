/**
 * ConversionFunnelChart — funil de conversão em SVG inline (sem Recharts/Chart.js).
 *
 * Barras horizontais por `Funnel_Stage` (contagem cumulativa não-crescente) +
 * seleção de `Time_Window` `{24h,7d,30d,90d}`. Bloco isolado por
 * `Partial_Degradation`: em falha renderiza `<DashboardBlockError onRetry />`.
 *
 * _Requirements: 8.1, 8.8, 8.9, 8.10_
 */

import type { FunnelBundle } from '../../../services/admin/rastreamento';
import { FUNNEL_ORDER, TIME_WINDOWS, type TimeWindow } from '../../../services/admin/rastreamento/domain';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { FUNNEL_STAGE_LABELS } from './labels';

interface Props {
  bundle: FunnelBundle;
  onWindowChange: (window: TimeWindow) => void;
  onRetry: () => void;
}

const ROW_H = 26;
const BAR_MAX = 200;

export default function ConversionFunnelChart({ bundle, onWindowChange, onRetry }: Props) {
  const max = Math.max(1, ...FUNNEL_ORDER.map((s) => bundle.counts[s] ?? 0));

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">Funil de conversão</div>
        <WindowSelector value={bundle.window} onChange={onWindowChange} />
      </div>

      {bundle.errors.funnel ? (
        <DashboardBlockError message={bundle.errors.funnel} onRetry={onRetry} />
      ) : (
        <>
          <svg
            role="img"
            aria-label="Funil de conversão por etapa"
            width="100%"
            height={FUNNEL_ORDER.length * ROW_H + 8}
            viewBox={`0 0 320 ${FUNNEL_ORDER.length * ROW_H + 8}`}
            preserveAspectRatio="none"
          >
            {FUNNEL_ORDER.map((stage, i) => {
              const count = bundle.counts[stage] ?? 0;
              const w = Math.round((count / max) * BAR_MAX);
              const y = i * ROW_H + 4;
              return (
                <g key={stage}>
                  <rect x={110} y={y} width={BAR_MAX} height={ROW_H - 10} rx={2} fill="#1f2937" />
                  <rect x={110} y={y} width={w} height={ROW_H - 10} rx={2} fill="#06b6d4" />
                  <text x={0} y={y + 11} fontSize={9} fill="#9ca3af">
                    {FUNNEL_STAGE_LABELS[stage]}
                  </text>
                  <text x={110 + BAR_MAX + 4} y={y + 11} fontSize={9} fill="#e5e7eb">
                    {count}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-400">
            <Metric label="Conversão geral" value={pct(bundle.metrics.overall_conversion_rate)} />
            <Metric label="Retenção" value={pct(bundle.metrics.retention_rate)} />
            <Metric label="Ativação" value={pct(bundle.metrics.activation_rate)} />
          </div>
        </>
      )}
    </section>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-800 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-200 font-semibold">{value}</div>
    </div>
  );
}

function WindowSelector({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (w: TimeWindow) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Janela de tempo">
      {TIME_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={`text-[11px] px-2 py-0.5 rounded border ${
            value === w
              ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

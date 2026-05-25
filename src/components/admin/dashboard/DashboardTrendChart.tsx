/**
 * DashboardTrendChart - grafico de tendencia SVG inline (sem dependencia externa).
 *
 * Renderiza N series sobrepostas como linha + area com fill-opacity 0.1.
 * Toggle "Mostrar como tabela" substitui o SVG por <table> alternativa
 * (acessibilidade equivalente via screen reader).
 */

import { useState } from 'react';
import {
  formatDate,
  formatNumber,
  type DashboardSeriesPoint,
} from '../../../services/admin/dashboard';

interface Series {
  name: string;
  color: string;
  points: DashboardSeriesPoint[];
}

interface Props {
  title: string;
  series: Series[];
  ariaLabel: string;
  formatter?: (n: number) => string;
  height?: number;
  emptyMessage?: string;
}

const SVG_WIDTH = 1000; // viewBox; SVG escala para 100% via preserveAspectRatio
const PAD_X = 40;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const X_TICKS = 7;
const Y_TICKS = 4;

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function takeUniform<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

export default function DashboardTrendChart({
  title,
  series,
  ariaLabel,
  formatter = formatNumber,
  height = 192,
  emptyMessage = 'Sem dados no período.',
}: Props) {
  const [showAsTable, setShowAsTable] = useState(false);

  const allPoints = series.flatMap((s) => s.points);
  const allZero = allPoints.length === 0 || allPoints.every((p) => p.value === 0);

  const refSeries = series[0]?.points ?? [];
  const N = refSeries.length;

  const maxValue = Math.max(1, ...allPoints.map((p) => p.value));

  const y0 = PAD_TOP;
  const y1 = height - PAD_BOTTOM;
  const x0 = PAD_X;
  const x1 = SVG_WIDTH - PAD_X;

  const xFor = (idx: number): number => {
    if (N <= 1) return (x0 + x1) / 2;
    return x0 + (idx / (N - 1)) * (x1 - x0);
  };
  const yFor = (v: number): number => {
    return y1 - (v / maxValue) * (y1 - y0);
  };

  const xLabels = takeUniform(refSeries, X_TICKS);
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    const v = (maxValue / (Y_TICKS - 1)) * i;
    return { v, y: yFor(v) };
  });

  function buildLinePath(points: DashboardSeriesPoint[]): string {
    if (points.length === 0) return '';
    return points
      .map(
        (p, idx) => `${idx === 0 ? 'M' : 'L'}${xFor(idx).toFixed(1)} ${yFor(p.value).toFixed(1)}`
      )
      .join(' ');
  }

  function buildAreaPath(points: DashboardSeriesPoint[]): string {
    if (points.length === 0) return '';
    const top = points
      .map(
        (p, idx) => `${idx === 0 ? 'M' : 'L'}${xFor(idx).toFixed(1)} ${yFor(p.value).toFixed(1)}`
      )
      .join(' ');
    const close = `L${xFor(points.length - 1).toFixed(1)} ${y1} L${xFor(0).toFixed(1)} ${y1} Z`;
    return `${top} ${close}`;
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-300">{title}</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {series.map((s) => (
              <span key={s.name} className="text-[10px] text-gray-400 flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAsTable((v) => !v)}
            className="text-[10px] text-gray-500 hover:text-cyan-400"
          >
            {showAsTable ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </div>

      {allZero ? (
        <div
          role="status"
          className="flex items-center justify-center text-xs text-gray-500"
          style={{ height }}
        >
          {emptyMessage}
        </div>
      ) : showAsTable ? (
        <div className="overflow-auto" style={{ maxHeight: height }}>
          <table className="w-full text-xs">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="bg-gray-800/60 text-gray-400 sticky top-0">
              <tr>
                <th scope="col" className="text-left px-2 py-1 font-medium">
                  Data
                </th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="text-right px-2 py-1 font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {refSeries.map((_, i) => (
                <tr key={i} className="border-t border-gray-800">
                  <td className="px-2 py-1 text-gray-400">{shortDate(refSeries[i].date)}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-gray-200 text-right">
                      {formatter(s.points[i]?.value ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          role="img"
          viewBox={`0 0 ${SVG_WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
        >
          <title>{ariaLabel}</title>

          {/* Eixo Y - linhas guia */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={x0}
                y1={t.y}
                x2={x1}
                y2={t.y}
                stroke="#1f2937"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text x={x0 - 6} y={t.y + 4} fill="#6b7280" fontSize={11} textAnchor="end">
                {formatter(Math.round(t.v))}
              </text>
            </g>
          ))}

          {/* Eixo X - labels */}
          {xLabels.map((p, i) => {
            const realIdx = refSeries.indexOf(p);
            const idx = realIdx === -1 ? 0 : realIdx;
            return (
              <text
                key={`xl-${i}`}
                x={xFor(idx)}
                y={height - 6}
                fill="#6b7280"
                fontSize={11}
                textAnchor="middle"
              >
                {shortDate(p.date)}
              </text>
            );
          })}

          {/* Series: area + line */}
          {series.map((s) => (
            <g key={s.name}>
              <path d={buildAreaPath(s.points)} fill={s.color} fillOpacity={0.1} />
              <path d={buildLinePath(s.points)} stroke={s.color} strokeWidth={1.5} fill="none" />
            </g>
          ))}
        </svg>
      )}

      <div className="mt-2 text-[10px] text-gray-600">
        Período: {refSeries.length > 0 ? formatDate(`${refSeries[0].date}T00:00:00Z`) : '—'} a{' '}
        {refSeries.length > 0
          ? formatDate(`${refSeries[refSeries.length - 1].date}T00:00:00Z`)
          : '—'}
      </div>
    </div>
  );
}

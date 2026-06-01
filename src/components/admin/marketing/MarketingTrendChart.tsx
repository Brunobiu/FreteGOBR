/**
 * MarketingTrendChart - grafico de tendencia SVG inline (polyline) da evolucao
 * de uma metrica de marketing (gasto, impressoes ou cliques) ao longo do
 * periodo selecionado.
 *
 * Convencoes do projeto (project-conventions.md, design.md D8):
 *   - Graficos exclusivamente em SVG inline (polyline). SEM Recharts/Chart.js
 *     nem qualquer dependencia de grafico.
 *   - Acessibilidade (Req 14.6): o <svg> tem role="img" + <title>/<desc>
 *     descrevendo a metrica representada (alternativa textual).
 *   - Padrao compacto do painel admin (sem <h1>, tema escuro, labels pt-BR).
 *
 * Consome a serie temporal retornada por getMetrics (Edge meta-marketing-read)
 * — ver MetricsResult['series'] em services/admin/marketing.ts. Cada ponto tem
 * { date, spend, impressions, clicks }. Para evitar misturar metricas de
 * escalas muito diferentes num unico eixo Y, o componente plota UMA metrica por
 * vez (selecionavel via prop `metric`, default `spend`).
 *
 * _Requirements: 5.13, 14.6_
 */

import type { MetricsResult } from '../../../services/admin/marketing';

/** Ponto da serie temporal, identico ao retornado por getMetrics. */
export type MarketingTrendPoint = MetricsResult['series'][number];

/** Metrica plotavel pelo grafico (subconjunto das chaves numericas do ponto). */
export type MarketingTrendMetric = 'spend' | 'impressions' | 'clicks';

export interface MarketingTrendChartProps {
  /** Serie temporal (date + spend/impressions/clicks), de getMetrics. */
  series: MarketingTrendPoint[];
  /** Metrica a ser plotada. Default: `spend`. */
  metric?: MarketingTrendMetric;
  /** Titulo opcional exibido no topo do card (default derivado da metrica). */
  title?: string;
  /** Altura do grafico em px (viewBox). Default: 192. */
  height?: number;
  /** Mensagem exibida quando a serie esta vazia / toda zero. */
  emptyMessage?: string;
}

/** Rotulos pt-BR por metrica. */
const METRIC_LABELS: Record<MarketingTrendMetric, string> = {
  spend: 'Gasto',
  impressions: 'Impressões',
  clicks: 'Cliques',
};

/** Cor (linha) por metrica. */
const METRIC_COLORS: Record<MarketingTrendMetric, string> = {
  spend: '#22d3ee',
  impressions: '#a78bfa',
  clicks: '#34d399',
};

const SVG_WIDTH = 1000; // viewBox; escala para 100% via preserveAspectRatio
const PAD_X = 48;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const X_TICKS = 7;
const Y_TICKS = 4;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Formata o valor de acordo com a metrica (gasto em BRL, demais inteiros). */
function formatMetricValue(metric: MarketingTrendMetric, value: number): string {
  return metric === 'spend' ? brl.format(value) : intFmt.format(Math.round(value));
}

/** Formata uma data ISO (YYYY-MM-DD) como dd/mm em pt-BR; fallback ao bruto. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Seleciona n pontos uniformemente espacados (para rotulos do eixo X). */
function takeUniform<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

export default function MarketingTrendChart({
  series,
  metric = 'spend',
  title,
  height = 192,
  emptyMessage = 'Sem dados no período selecionado.',
}: MarketingTrendChartProps) {
  const label = METRIC_LABELS[metric];
  const color = METRIC_COLORS[metric];
  const heading = title ?? `Evolução de ${label.toLowerCase()}`;

  const values = series.map((p) => p[metric]);
  const isEmpty = series.length === 0 || values.every((v) => v === 0);

  // Geometria do grafico.
  const N = series.length;
  const maxValue = Math.max(1, ...values);
  const y0 = PAD_TOP;
  const y1 = height - PAD_BOTTOM;
  const x0 = PAD_X;
  const x1 = SVG_WIDTH - PAD_X;

  const xFor = (idx: number): number => {
    if (N <= 1) return (x0 + x1) / 2;
    return x0 + (idx / (N - 1)) * (x1 - x0);
  };
  const yFor = (v: number): number => y1 - (v / maxValue) * (y1 - y0);

  const points = series
    .map((p, idx) => `${xFor(idx).toFixed(1)},${yFor(p[metric]).toFixed(1)}`)
    .join(' ');

  const xLabels = takeUniform(series, X_TICKS);
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    const v = (maxValue / (Y_TICKS - 1)) * i;
    return { v, y: yFor(v) };
  });

  // Alternativa textual acessivel (Req 14.6).
  const firstDate = series.length > 0 ? shortDate(series[0].date) : '—';
  const lastDate = series.length > 0 ? shortDate(series[series.length - 1].date) : '—';
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const peakValue = values.length > 0 ? Math.max(...values) : 0;
  const titleText = `${heading} (${label})`;
  const descText =
    series.length > 0
      ? `Evolução de ${label.toLowerCase()} de ${firstDate} a ${lastDate}. ` +
        `Mínimo ${formatMetricValue(metric, minValue)}, ` +
        `máximo ${formatMetricValue(metric, peakValue)}.`
      : `Sem dados de ${label.toLowerCase()} no período selecionado.`;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-300">{heading}</h3>
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
      </div>

      {isEmpty ? (
        <div
          role="status"
          className="flex items-center justify-center text-xs text-gray-500"
          style={{ height }}
        >
          {emptyMessage}
        </div>
      ) : (
        <svg
          role="img"
          aria-label={titleText}
          viewBox={`0 0 ${SVG_WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
        >
          <title>{titleText}</title>
          <desc>{descText}</desc>

          {/* Eixo Y - linhas guia + rotulos */}
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
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
                {formatMetricValue(metric, t.v)}
              </text>
            </g>
          ))}

          {/* Eixo X - rotulos de data */}
          {xLabels.map((p, i) => {
            const realIdx = series.indexOf(p);
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

          {/* Serie: polyline da metrica selecionada */}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}

      <div className="mt-2 text-[10px] text-gray-600">
        Período: {firstDate} a {lastDate}
      </div>
    </div>
  );
}

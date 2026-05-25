/**
 * DashboardKpiCard - card individual de KPI com label, valor e badge de variacao.
 *
 * Quando `kpi === null` (gating server-side omitiu sub-objeto), retorna null.
 */

import { Link } from 'react-router-dom';
import type { DashboardKPI } from '../../../services/admin/dashboard';

interface Props {
  label: string;
  kpi: DashboardKPI | null;
  formatter: (n: number) => string;
  link?: string;
  /** Quando true, inverte semantica de cor: 'up' vermelho, 'down' verde. Util pra alertas. */
  invertColors?: boolean;
}

function arrow(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') return '▲';
  if (direction === 'down') return '▼';
  return '=';
}

export default function DashboardKpiCard({
  label,
  kpi,
  formatter,
  link,
  invertColors = false,
}: Props) {
  if (!kpi) return null;

  const valueStr = kpi.value === null ? '—' : formatter(kpi.value);

  let badge: { text: string; cls: string };
  if (kpi.previousValue === 0 && (kpi.value ?? 0) > 0) {
    badge = { text: 'Novo', cls: 'bg-cyan-500/15 text-cyan-300' };
  } else if (kpi.deltaPct === null) {
    badge = { text: '—', cls: 'bg-gray-500/15 text-gray-400' };
  } else {
    const positive = invertColors ? kpi.deltaDirection === 'down' : kpi.deltaDirection === 'up';
    const negative = invertColors ? kpi.deltaDirection === 'up' : kpi.deltaDirection === 'down';
    const cls = positive
      ? 'bg-green-500/15 text-green-300'
      : negative
        ? 'bg-red-500/15 text-red-300'
        : 'bg-gray-500/15 text-gray-400';
    const sign = kpi.deltaPct > 0 ? '+' : '';
    badge = {
      text: `${arrow(kpi.deltaDirection)} ${sign}${kpi.deltaPct}%`,
      cls,
    };
  }

  const ariaLabel = `${label}: ${valueStr}${
    kpi.deltaPct !== null ? `, variação ${kpi.deltaPct}%` : ''
  }`;

  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-base sm:text-lg font-semibold text-gray-100 leading-tight">
        {valueStr}
      </div>
      <div className="mt-1.5">
        <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${badge.cls}`}>
          {badge.text}
        </span>
        {kpi.deltaPct !== null && (
          <span className="text-[9px] text-gray-500 ml-1">vs período anterior</span>
        )}
      </div>
    </>
  );

  const baseClass =
    'rounded-lg border border-gray-800 bg-gray-900 p-3 transition focus:outline-none focus:ring-2 focus:ring-cyan-700';

  if (link) {
    return (
      <Link
        to={link}
        role="region"
        aria-label={ariaLabel}
        className={`${baseClass} hover:border-cyan-700 cursor-pointer block`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div role="region" aria-label={ariaLabel} className={baseClass}>
      {inner}
    </div>
  );
}

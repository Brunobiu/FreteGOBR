/**
 * OperacaoKpiCard — card de KPI operacional (Painel Operacional).
 *
 * Diferente do DashboardKpiCard (centrado em delta), este é um Dashboard_KPI
 * simples: `available=false` ⇒ exibe "indisponível" (NUNCA 0); `value=null` com
 * `available=true` (degenerado) ⇒ "—". Valores formatados em pt-BR via
 * formatNumber. Estilo compacto (project-conventions).
 */

import { formatNumber } from '../../../services/admin/dashboard';
import type { DashboardKpi } from '../../../services/admin/operacao';

interface Props {
  label: string;
  kpi: DashboardKpi;
}

export default function OperacaoKpiCard({ label, kpi }: Props) {
  const unavailable = !kpi.available;
  const display = unavailable ? 'indisponível' : kpi.value === null ? '—' : formatNumber(kpi.value);

  return (
    <div
      role="region"
      aria-label={`${label}: ${display}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-3"
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div
        className={`text-base sm:text-lg font-semibold leading-tight ${
          unavailable ? 'text-gray-600 italic' : 'text-gray-100'
        }`}
      >
        {display}
      </div>
    </div>
  );
}

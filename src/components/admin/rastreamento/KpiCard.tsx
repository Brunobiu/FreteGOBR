/**
 * KpiCard — card de KPI do Tracking_Module no padrão compacto do painel
 * (project-conventions): label `text-[10px] uppercase tracking-wider
 * text-gray-500`; valor `text-base sm:text-lg font-semibold`.
 */

interface Props {
  label: string;
  value: string | number;
  hint?: string;
}

export default function KpiCard({ label, value, hint }: Props) {
  return (
    <div
      role="region"
      aria-label={`${label}: ${value}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-3"
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-base sm:text-lg font-semibold leading-tight text-gray-100">{value}</div>
      {hint && <div className="text-[10px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

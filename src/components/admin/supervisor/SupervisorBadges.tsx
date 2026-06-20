/**
 * SupervisorBadges — marcadores pt-BR de severidade/estado de insight.
 */

import type { InsightSeverity, InsightState } from '../../../services/admin/supervisor';

const SEVERITY_DISPLAY: Record<InsightSeverity, { label: string; cls: string }> = {
  CRITICAL: { label: 'CRÍTICO', cls: 'bg-red-500/15 text-red-300' },
  WARNING: { label: 'ALERTA', cls: 'bg-amber-500/15 text-amber-300' },
  INFO: { label: 'INFO', cls: 'bg-gray-500/15 text-gray-300' },
};

const STATE_DISPLAY: Record<InsightState, { label: string; cls: string }> = {
  OPEN: { label: 'Aberto', cls: 'bg-cyan-500/15 text-cyan-300' },
  ACKNOWLEDGED: { label: 'Reconhecido', cls: 'bg-amber-500/15 text-amber-300' },
  DISMISSED: { label: 'Descartado', cls: 'bg-gray-500/15 text-gray-400' },
};

export function InsightSeverityBadge({ severity }: { severity: InsightSeverity }) {
  const d = SEVERITY_DISPLAY[severity] ?? SEVERITY_DISPLAY.INFO;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${d.cls}`}>
      {d.label}
    </span>
  );
}

export function InsightStateBadge({ state }: { state: InsightState }) {
  const d = STATE_DISPLAY[state] ?? STATE_DISPLAY.OPEN;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${d.cls}`}>
      {d.label}
    </span>
  );
}

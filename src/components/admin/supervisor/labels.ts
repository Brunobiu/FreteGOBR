/**
 * labels.ts — rótulos pt-BR de Insight_Type para a UI da IA Supervisora.
 * Em módulo separado (não-componente) para não quebrar o fast-refresh.
 */

import type { InsightType } from '../../../services/admin/supervisor';

export const INSIGHT_TYPE_LABEL: Record<InsightType, string> = {
  ANOMALY: 'Anomalia',
  SUGGESTION: 'Sugestão',
  SUMMARY: 'Resumo',
  SECURITY: 'Segurança',
};

export const INSIGHT_TYPES = Object.keys(INSIGHT_TYPE_LABEL) as InsightType[];

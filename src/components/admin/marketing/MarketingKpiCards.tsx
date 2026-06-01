/**
 * MarketingKpiCards - grade de cards de KPI do painel de marketing (Meta Ads).
 *
 * Exibe os 7 indicadores da campanha agregada retornados pela
 * Meta_Read_Function (via getMetrics ⇒ MetricsResult.campaign):
 *   gasto, impressoes, cliques, CPL, CPC, CTR e conversoes.
 *
 * IMPORTANTE: este componente e PURAMENTE de apresentacao. Ele NAO recomputa
 * metricas — consome os valores ja derivados por computeMetrics (CP-2) no
 * service/Edge (ctr/cpc/cpl chegam prontos em `ComputedMetrics`). Aqui apenas
 * formatamos para exibicao em pt-BR.
 *
 * Regras de formatacao (Reqs 5.7, 5.8, 5.9, 5.10):
 *   - CTR: `0%` quando impressions == 0; caso contrario `ctr * 100` em pt-BR + `%`.
 *   - CPC: `—` quando cpc == null (clicks == 0); `0,00` quando cpc == 0
 *     (spend == 0 e clicks > 0); caso contrario o valor com 2 casas (pt-BR).
 *   - CPL: `—` quando cpl == null (leads == 0); caso contrario o valor com 2
 *     casas (pt-BR).
 *   - Gasto: moeda BRL (R$ ...). Impressoes/cliques/conversoes: inteiro pt-BR.
 *
 * Acessibilidade e layout (Reqs 5.1, 5.14, 5.15, 14.2, 14.5):
 *   - Cada card tem `role="region"` + `aria-label` agregando rotulo e valor.
 *   - Estilo de card do Compact_Layout_Pattern (label text-[10px] uppercase
 *     tracking-wider text-gray-500; valor text-base sm:text-lg font-semibold).
 *   - Grade lado a lado em >=768px (breakpoint `md:`), coluna unica em <768px.
 */

import type { CampaignMetrics, ComputedMetrics } from '../../../services/admin/marketing';

/** Placeholder de valor indefinido (cpc/cpl == null). */
const DASH = '—';

export interface MarketingKpiCardsProps {
  /**
   * Metricas da campanha agregada, ja com as derivadas (ctr/cpc/cpl) calculadas
   * upstream por computeMetrics. Corresponde a `MetricsResult['campaign']`.
   */
  metrics: CampaignMetrics & ComputedMetrics;
}

/** Formata moeda brasileira (R$ 1.234,56). */
function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Formata inteiro em pt-BR com separador de milhar (ex.: 1.234). */
function formatInteger(n: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n);
}

/** Formata numero com exatamente 2 casas decimais em pt-BR (ex.: 0,00 / 12,34). */
function formatDecimal2(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * CTR (Req 5.7): `0%` quando impressions == 0; caso contrario `ctr * 100`
 * formatado em pt-BR (ate 2 casas) com sufixo `%`. `ctr` ja vem como fracao
 * (clicks / impressions) de computeMetrics.
 */
function formatCtr(ctr: number, impressions: number): string {
  if (impressions === 0) return '0%';
  const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(ctr * 100);
  return `${pct}%`;
}

/**
 * CPC (Reqs 5.8, 5.9): `—` quando null (clicks == 0); `0,00` quando 0
 * (spend == 0 e clicks > 0); caso contrario 2 casas em pt-BR.
 */
function formatCpc(cpc: number | null): string {
  if (cpc === null) return DASH;
  return formatDecimal2(cpc);
}

/**
 * CPL (Req 5.10): `—` quando null (leads == 0); caso contrario 2 casas em pt-BR.
 */
function formatCpl(cpl: number | null): string {
  if (cpl === null) return DASH;
  return formatDecimal2(cpl);
}

/** Classe base do card, alinhada ao Compact_Layout_Pattern (DashboardKpiCard). */
const CARD_CLASS = 'rounded-lg border border-gray-800 bg-gray-900 p-3';

export default function MarketingKpiCards({ metrics }: MarketingKpiCardsProps) {
  const cards: { key: string; label: string; value: string }[] = [
    { key: 'spend', label: 'Gasto', value: formatBRL(metrics.spend) },
    { key: 'impressions', label: 'Impressões', value: formatInteger(metrics.impressions) },
    { key: 'clicks', label: 'Cliques', value: formatInteger(metrics.clicks) },
    { key: 'cpl', label: 'CPL', value: formatCpl(metrics.cpl) },
    { key: 'cpc', label: 'CPC', value: formatCpc(metrics.cpc) },
    { key: 'ctr', label: 'CTR', value: formatCtr(metrics.ctr, metrics.impressions) },
    { key: 'conversions', label: 'Conversões', value: formatInteger(metrics.conversions) },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
      {cards.map((card) => (
        <div
          key={card.key}
          role="region"
          aria-label={`${card.label}: ${card.value}`}
          className={CARD_CLASS}
        >
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            {card.label}
          </div>
          <div className="text-base sm:text-lg font-semibold text-gray-100 leading-tight">
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

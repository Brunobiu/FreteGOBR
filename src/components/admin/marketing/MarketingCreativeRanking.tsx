/**
 * MarketingCreativeRanking - secao de ranking de criativos do painel
 * /admin/marketing (admin-marketing 048, task 9.4).
 *
 * Exibe os MELHORES (melhor desempenho) e os PIORES (maior desperdicio)
 * criativos do periodo, ordenados pela metrica selecionada. A ordenacao NAO e
 * reimplementada aqui: delega 100% ao helper puro `rankCreatives` de
 * `services/admin/marketing.ts` (CP-3 — ordem total, desempate estavel por
 * `creative_id` asc, idempotente). O componente apenas escolhe a DIRECAO de
 * "melhor" por metrica e fatia as duas pontas da lista ordenada.
 *
 * Padrao compacto (project-conventions.md):
 *  - Sem <h1> grande; cabecalho discreto.
 *  - Cards single-column (`<768px`): as duas colunas Melhores/Piores empilham
 *    em coluna unica no mobile (`grid-cols-1 md:grid-cols-2`); cada lista ja e
 *    vertical.
 *  - Tema escuro do painel (gray-900/gray-800), espelhando DashboardTopList.
 *
 * Empty state (Req 6.5): texto exato `Nenhum criativo no periodo selecionado.`.
 *
 * Requirements: 6.1, 6.4, 6.5, 6.6
 */

import { useState } from 'react';
import {
  computeMetrics,
  rankCreatives,
  type CreativePerformance,
  type RankDirection,
  type RankMetric,
} from '../../../services/admin/marketing';

export interface MarketingCreativeRankingProps {
  /** Criativos do periodo (de MetricsResult.creatives). Vazio ⇒ empty state. */
  creatives: CreativePerformance[];
  /**
   * Metrica de ordenacao selecionada. Quando omitida, o componente controla
   * a metrica internamente (default `spend`).
   */
  metric?: RankMetric;
  /**
   * Callback de mudanca de metrica. Quando fornecido, o seletor e controlado
   * pelo pai (a Marketing_Metrics_Page sincroniza a metrica do ranking).
   */
  onMetricChange?: (metric: RankMetric) => void;
  /** Quantos criativos exibir em cada ponta (melhores/piores). Default 5. */
  topCount?: number;
}

/** Texto exato do empty state exigido por Req 6.5. */
const EMPTY_MESSAGE = 'Nenhum criativo no período selecionado.';

/** Rotulos pt-BR das metricas de ranking exibidos no seletor. */
const METRIC_LABELS: Record<RankMetric, string> = {
  spend: 'Gasto',
  impressions: 'Impressões',
  clicks: 'Cliques',
  leads: 'Leads',
  ctr: 'CTR',
  cpc: 'CPC',
  cpl: 'CPL',
};

const RANK_METRICS: RankMetric[] = ['spend', 'impressions', 'clicks', 'leads', 'ctr', 'cpc', 'cpl'];

/**
 * Define qual direcao significa "melhor desempenho" para cada metrica:
 *  - Metricas de retorno (impressoes, cliques, leads, CTR): maior e melhor.
 *  - Metricas de custo/desperdicio (gasto, CPC, CPL): menor e melhor; valores
 *    altos representam maior desperdicio (Req 6.4).
 * `rankCreatives(items, metric, melhorDirecao)` coloca o melhor primeiro e o
 * pior por ultimo, definindo as duas pontas do ranking.
 */
const HIGHER_IS_BETTER: Record<RankMetric, boolean> = {
  spend: false,
  impressions: true,
  clicks: true,
  leads: true,
  ctr: true,
  cpc: false,
  cpl: false,
};

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const intFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pctFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Placeholder de valor indefinido (cpc/cpl com denominador zero). */
const DASH = '—';

/**
 * Deriva ctr/cpc/cpl de um criativo via computeMetrics (paridade com a
 * ordenacao). computeMetrics lanca INVALID_METRICS quando clicks > impressions;
 * num componente puramente visual tratamos isso como "sem dado" (null) em vez
 * de quebrar a renderizacao — a Edge ja valida a invariante antes de chegar
 * aqui.
 */
function safeDerived(item: CreativePerformance): {
  ctr: number;
  cpc: number | null;
  cpl: number | null;
} {
  try {
    return computeMetrics({
      spend: item.spend,
      impressions: item.impressions,
      clicks: item.clicks,
      leads: item.leads,
      conversions: 0,
    });
  } catch {
    return { ctr: 0, cpc: null, cpl: null };
  }
}

/** Formata o valor da metrica selecionada para exibicao em pt-BR. */
function formatMetric(item: CreativePerformance, metric: RankMetric): string {
  switch (metric) {
    case 'spend':
      return brlFormatter.format(item.spend);
    case 'impressions':
      return intFormatter.format(item.impressions);
    case 'clicks':
      return intFormatter.format(item.clicks);
    case 'leads':
      return intFormatter.format(item.leads);
    case 'ctr':
      return pctFormatter.format(safeDerived(item).ctr);
    case 'cpc': {
      const { cpc } = safeDerived(item);
      return cpc === null ? DASH : brlFormatter.format(cpc);
    }
    case 'cpl': {
      const { cpl } = safeDerived(item);
      return cpl === null ? DASH : brlFormatter.format(cpl);
    }
    default:
      return DASH;
  }
}

interface CreativeListProps {
  title: string;
  items: CreativePerformance[];
  metric: RankMetric;
  accentClass: string;
}

function CreativeList({ title, items, metric, accentClass }: CreativeListProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <h4 className="text-xs font-semibold text-gray-300 mb-2">{title}</h4>
      <ol className="space-y-1.5">
        {items.map((item, idx) => (
          <li
            key={item.creative_id}
            className="flex items-start gap-2 px-2 py-1.5 rounded bg-gray-800/40"
          >
            <span className="text-[10px] text-gray-500 w-5 shrink-0 mt-0.5">{idx + 1}.</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-200 truncate">{item.name || item.creative_id}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {intFormatter.format(item.impressions)} impr. · {intFormatter.format(item.clicks)}{' '}
                cliques · {intFormatter.format(item.leads)} leads
              </div>
            </div>
            <div className={`text-xs whitespace-nowrap shrink-0 font-medium ${accentClass}`}>
              {formatMetric(item, metric)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function MarketingCreativeRanking({
  creatives,
  metric: metricProp,
  onMetricChange,
  topCount = 5,
}: MarketingCreativeRankingProps) {
  const [internalMetric, setInternalMetric] = useState<RankMetric>('spend');
  const metric = metricProp ?? internalMetric;

  const handleMetricChange = (next: RankMetric) => {
    if (onMetricChange) onMetricChange(next);
    else setInternalMetric(next);
  };

  const selector = (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
      <span>Ordenar por</span>
      <select
        value={metric}
        onChange={(e) => handleMetricChange(e.target.value as RankMetric)}
        aria-label="Métrica de ordenação do ranking de criativos"
        className="text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-700"
      >
        {RANK_METRICS.map((m) => (
          <option key={m} value={m}>
            {METRIC_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  );

  if (creatives.length === 0) {
    return (
      <section aria-label="Ranking de criativos" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-gray-300">Ranking de criativos</h3>
          {selector}
        </div>
        <div
          role="status"
          className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500"
        >
          {EMPTY_MESSAGE}
        </div>
      </section>
    );
  }

  // Direcao de "melhor" para a metrica: melhor primeiro, pior por ultimo.
  const bestDirection: RankDirection = HIGHER_IS_BETTER[metric] ? 'desc' : 'asc';
  const ranked = rankCreatives(creatives, metric, bestDirection);

  // Melhores: as primeiras `topCount` posicoes (melhor desempenho).
  const best = ranked.slice(0, topCount);
  // Piores: as ultimas `topCount` posicoes, sem sobrepor as melhores; exibidas
  // do pior para o "menos pior". Quando ha poucos criativos, a secao de piores
  // pode ficar vazia (todos ja aparecem em Melhores).
  const worstStart = Math.max(topCount, ranked.length - topCount);
  const worst = ranked.slice(worstStart).reverse();

  return (
    <section aria-label="Ranking de criativos" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-300">Ranking de criativos</h3>
        {selector}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CreativeList
          title={`Melhores · ${METRIC_LABELS[metric]}`}
          items={best}
          metric={metric}
          accentClass="text-green-300"
        />
        {worst.length > 0 && (
          <CreativeList
            title={`Piores · ${METRIC_LABELS[metric]}`}
            items={worst}
            metric={metric}
            accentClass="text-red-300"
          />
        )}
      </div>
    </section>
  );
}

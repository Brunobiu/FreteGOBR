/**
 * MarketingPeriodSelector - seletor de periodo do painel de metricas de
 * marketing (admin-marketing 048).
 *
 * Oferece as 3 opcoes do dominio fechado Metric_Period (Req 5.2):
 *   - "Hoje"            => 'today'
 *   - "Ultimos 7 dias"  => '7d'
 *   - "Ultimos 30 dias" => '30d'
 *
 * Sincroniza o periodo selecionado com o query param da URL via
 * `useSearchParams` (React Router), preservando os demais params (Req 5.4).
 * Quando o query param esta ausente ou contem um valor fora do dominio, o
 * componente aplica o `defaultPeriod` (vindo de `marketing_config`) sem quebrar
 * (Req 5.3 / 5.5). A pagina e dona do fetch da config e repassa o default aqui.
 *
 * O periodo efetivamente resolvido (da URL ou default) e comunicado a pagina
 * via `onChange`, que dispara o re-fetch das metricas pela Edge
 * `meta-marketing-read`.
 *
 * Acessibilidade (Req 14.1): `<label htmlFor>` associado ao `<select>` + um
 * `aria-label` descritivo no proprio controle.
 *
 * Estilo: padrao compacto do painel admin (tema escuro), espelhando o
 * DashboardFilterPopover.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { MetricPeriod } from '../../../services/admin/marketing';

/** Nome default do query param de periodo na URL. */
const DEFAULT_PARAM_NAME = 'period';

/** Rotulos pt-BR de cada opcao do dominio fechado Metric_Period (Req 5.2). */
const PERIOD_OPTIONS: ReadonlyArray<{ value: MetricPeriod; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

/**
 * Type guard do dominio fechado Metric_Period. Usado para validar o valor do
 * query param antes de aceita-lo (valor invalido => default — Req 5.5).
 */
function isMetricPeriod(value: unknown): value is MetricPeriod {
  return value === 'today' || value === '7d' || value === '30d';
}

interface MarketingPeriodSelectorProps {
  /**
   * Periodo default vindo de `marketing_config`, aplicado quando o query param
   * esta ausente ou invalido (Req 5.3 / 5.5). A pagina e dona do fetch da
   * config e repassa o valor aqui.
   */
  defaultPeriod: MetricPeriod;
  /**
   * Notifica a pagina do periodo efetivamente resolvido (da URL ou default).
   * Disparado no mount e a cada mudanca do valor resolvido, permitindo o
   * re-fetch das metricas.
   */
  onChange?: (period: MetricPeriod) => void;
  /** Nome do query param sincronizado na URL. Default: `period`. */
  paramName?: string;
  /** id do `<select>`, usado por `htmlFor`. Default: `marketing-period`. */
  id?: string;
  /** Desabilita o seletor (ex.: enquanto carrega). */
  disabled?: boolean;
}

export default function MarketingPeriodSelector({
  defaultPeriod,
  onChange,
  paramName = DEFAULT_PARAM_NAME,
  id = 'marketing-period',
  disabled = false,
}: MarketingPeriodSelectorProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve o periodo vigente: query param valido tem prioridade; caso
  // contrario (ausente/invalido) cai no default de marketing_config.
  const rawParam = searchParams.get(paramName);
  const resolved: MetricPeriod = isMetricPeriod(rawParam) ? rawParam : defaultPeriod;

  // Comunica o periodo resolvido a pagina no mount e sempre que ele mudar
  // (mudanca de URL, default carregado etc.), disparando o re-fetch.
  useEffect(() => {
    onChange?.(resolved);
  }, [resolved, onChange]);

  // Atualiza o query param preservando os demais params da URL (Req 5.4).
  function handleChange(next: MetricPeriod) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(paramName, next);
        return params;
      },
      { replace: true }
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wider text-gray-500">
        Período
      </label>
      <select
        id={id}
        value={resolved}
        disabled={disabled}
        aria-label="Período das métricas"
        onChange={(e) => handleChange(e.target.value as MetricPeriod)}
        className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

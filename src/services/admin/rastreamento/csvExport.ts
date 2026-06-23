/**
 * rastreamento/csvExport.ts — exportação CSV da At_Risk_List (CP12).
 *
 * **Reusa** `toCsv`/`parseCsv`/`CSV_MAX_ROWS` de `whatsapp/csv` (padrão herdado:
 * BOM UTF-8, separador `;`, escape RFC 4180, quebra `\r\n`, truncamento em 10000
 * linhas). NÃO reimplementa o serializador. Função PURA: o chamador persiste o
 * audit com `truncated` e dispara o download. Exporta apenas colunas autorizadas
 * (telefone MASCARADO; sem PII bruta) (Req 7.11).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.8).
 * _Requirements: 7.11_
 */

import { CSV_MAX_ROWS, parseCsv, toCsv } from '../whatsapp/csv';
import { RISK_BAND_LABELS } from './riskScore';
import { type AtRiskRow } from './atRiskList';

/** Cabeçalho fixo do CSV de rastreamento (identifiers em snake_case). */
export const RASTREAMENTO_CSV_HEADER = [
  'usuario_id',
  'nome',
  'telefone',
  'score',
  'faixa',
  'causa_provavel',
  'categoria',
  'status_contato',
] as const;

/** Resultado de uma exportação CSV. */
export interface RastreamentoCsvResult {
  /** Conteúdo CSV pronto para download (com BOM, já truncado se necessário). */
  csv: string;
  /** `true` quando o conteúdo excedia {@link CSV_MAX_ROWS} linhas (Req 7.11). */
  truncated: boolean;
  /** Nome do arquivo `rastreamento_<YYYYMMDD>_<HHmm>.csv`. */
  filename: string;
}

/**
 * Deriva o nome do arquivo `rastreamento_<YYYYMMDD>_<HHmm>.csv` (UTC), espelhando
 * a convenção herdada de `whatsapp/csv` e `financeiro.ts`.
 */
export function buildRastreamentoCsvFilename(date: Date = new Date()): string {
  const iso = date.toISOString(); // 2024-01-15T12:34:56.789Z
  const yyyymmdd = iso.slice(0, 10).replace(/-/g, '');
  const hhmm = iso.slice(11, 16).replace(':', '');
  return `rastreamento_${yyyymmdd}_${hhmm}.csv`;
}

/** Converte uma linha da At_Risk_List em células string (telefone mascarado). */
function rowToCells(row: AtRiskRow): string[] {
  return [
    row.user_id,
    row.name,
    row.phone_masked,
    String(row.risk_score),
    RISK_BAND_LABELS[row.risk_band],
    row.abandonment_cause,
    row.risk_category,
    row.contact_status,
  ];
}

/**
 * Monta a matriz `cabeçalho + linhas` da At_Risk_List (alvo do round-trip CP12).
 */
export function atRiskRowsToMatrix(rows: readonly AtRiskRow[]): string[][] {
  return [[...RASTREAMENTO_CSV_HEADER], ...rows.map(rowToCells)];
}

/**
 * Exporta a `At_Risk_List` para CSV no padrão herdado.
 * `truncated` é calculado sobre o total de linhas (cabeçalho incluído).
 */
export function exportAtRiskCsv(
  rows: readonly AtRiskRow[],
  date: Date = new Date()
): RastreamentoCsvResult {
  const matrix = atRiskRowsToMatrix(rows);
  return {
    csv: toCsv(matrix),
    truncated: matrix.length > CSV_MAX_ROWS,
    filename: buildRastreamentoCsvFilename(date),
  };
}

/** Re-export do parser (operação inversa de {@link exportAtRiskCsv}) para o round-trip. */
export { parseCsv, toCsv };

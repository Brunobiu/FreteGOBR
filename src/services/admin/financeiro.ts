/**
 * admin/financeiro.ts
 *
 * Service do modulo Financeiro do painel admin (admin-financeiro 037).
 * Cobre o ciclo de vida do /admin/financeiro: listagem de repasses
 * (1:1 com fretes encerrados), detalhe de repasse, configuracao
 * historica de comissao e operacoes de pagamento (marcar como pago,
 * estornar) com idempotencia forte.
 *
 * Esta e a parte 1 do arquivo (task 2.1):
 *   - Tipos publicos exportados (enums, interfaces, error class).
 *
 * As partes seguintes virao em:
 *   - 2.2: helpers puros (computeCommission, validateBrackets,
 *          sanitizeProofFilename, validateProofFile, parse/serialize
 *          filters, formatadores BRL/data/metodo).
 *   - 2.3: helper mapPostgresError.
 *   - 3.1-3.5: services de leitura (getSettings, listRepasses,
 *              getSummary, getRepasseDetail, getProofSignedUrl).
 *   - 4.1-4.5: services de mutacao (updateSettings, uploadProof,
 *              markAsPaid, estornar, exportRepasseCSV).
 *
 * Paridade SQL <-> TS (CP-1, formalizada em design.md):
 *   - computeCommission (TS, parte 2.2) espelha 1:1 a funcao SQL pura
 *     compute_commission_value (migration 037, IMMUTABLE).
 *   - Mesmo arredondamento (Math.round(x*100)/100 em TS,
 *     ROUND(x, 2) em SQL).
 *   - Mesma resolucao de bracket (min_value <= valor < max_value, com
 *     a ultima faixa inclusiva no max_value).
 *
 * Padroes herdados (ver project-conventions.md e admin-patterns.md):
 *   - Audit-by-construction via executeAdminMutation.
 *   - Versionamento otimista via updated_at + STALE_VERSION.
 *   - Idempotencia forte em markAsPaid/estornar via _SKIPPED (CP-2).
 *   - Stealth_404 em paths sem permissao.
 *   - Degradacao parcial em fetch agregado (Promise.allSettled).
 *   - CSV BOM UTF-8 + ; + RFC 4180 + truncamento 10000 linhas.
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';

// ===================== Enums e literal types =====================

/**
 * Estados validos de um repasse financeiro.
 *  - pendente: criado pelo trigger no encerramento do frete, aguardando pagamento.
 *  - pago: marcado como pago por admin com FINANCEIRO_EDIT.
 *  - estornado: pagamento revertido apos justificativa (snapshot historico preservado).
 */
export type RepasseStatus = 'pendente' | 'pago' | 'estornado';

/**
 * Metodos de pagamento aceitos no MVP. Sem integracao com gateway real.
 */
export type PaymentMethod = 'pix' | 'ted' | 'boleto' | 'dinheiro' | 'outro';

/**
 * Tipo de periodo aplicado em filtros e agregacoes:
 *  - fechamento: filtra/agrega por closed_at (data do encerramento do frete).
 *  - pagamento: filtra/agrega por paid_at (data do pagamento confirmado).
 */
export type PeriodKind = 'fechamento' | 'pagamento';

/**
 * Codigos canonicos de erro do service. Cada codigo mapeia para uma
 * mensagem user-facing pt-BR na UI (tabela de tradução fica em 2.2/2.3).
 */
export type FinanceiroErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_PERIOD'
  | 'PERIOD_TOO_LARGE'
  | 'INVALID_STATUS'
  | 'COMMISSION_PCT_OUT_OF_RANGE'
  | 'BRACKETS_TOO_MANY'
  | 'BRACKETS_OUT_OF_ORDER'
  | 'BRACKETS_OVERLAP'
  | 'BRACKETS_GAP'
  | 'INVALID_BRACKETS'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

// ===================== Configuracao de comissao =====================

/**
 * Faixa de comissao por valor de frete. Avaliada como [min_value, max_value),
 * exceto a ultima faixa do array que e inclusiva no max_value (paridade
 * com compute_commission_value SQL).
 *
 * Validacoes (em validateBrackets / RPC admin_financeiro_settings_update):
 *  - min_value >= 0; max_value > min_value; pct ∈ [0, 50].
 *  - Array ordenado ASC por min_value.
 *  - Sem buracos (max[i] === min[i+1]).
 *  - Sem sobreposicao (max[i] <= min[i+1]).
 *  - Maximo 5 entradas.
 */
export interface CommissionBracket {
  min_value: number;
  max_value: number;
  pct: number;
}

/**
 * Snapshot vigente de financial_settings. Sentinel `id=null` quando a tabela
 * nao tem nenhuma linha (instalacao fresh) — o trigger trata como flat 0%.
 */
export interface FinanceiroSettings {
  id: string | null;
  commission_pct: number;
  commission_brackets: CommissionBracket[];
  effective_from: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Payload para updateSettings. Versionamento otimista vai em campo separado
 * (`expected_updated_at`) na assinatura da funcao em 4.1, nao neste payload.
 */
export interface UpdateSettingsPayload {
  commission_pct: number;
  commission_brackets: CommissionBracket[];
}

// ===================== Repasses (listagem) =====================

/**
 * Linha de financial_repasses enriquecida com nomes resolvidos via JOIN com
 * users (embarcador_name, motorista_name). Apresentado pela
 * RPC admin_repasses_list e usado em FinanceiroTable / FinanceiroMobileCards.
 */
export interface RepasseRow {
  id: string;
  frete_id: string;
  embarcador_id: string;
  embarcador_name: string | null;
  motorista_id: string | null;
  motorista_name: string | null;
  valor_bruto: number;
  commission_pct: number;
  commission_value: number;
  valor_liquido: number;
  status: RepasseStatus;
  closed_at: string;
  paid_at: string | null;
  payment_method: PaymentMethod | null;
  updated_at: string;
}

/**
 * Filtros aceitos por listRepasses / admin_repasses_list. Todos opcionais com
 * defaults (definidos em 2.2 via DEFAULT_REPASSE_FILTERS).
 */
export interface RepasseFilters {
  status?: RepasseStatus | null;
  embarcador_id?: string | null;
  motorista_id?: string | null;
  period_kind?: PeriodKind;
  period_from?: string | null;
  period_to?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Resultado paginado de listRepasses. `total` e o count total apos filtros
 * (ignorando limit/offset) para alimentar paginacao "X de Y".
 */
export interface ListRepassesResult {
  items: RepasseRow[];
  total: number;
  limit: number;
  offset: number;
}

// ===================== Repasse (detalhe) =====================

/**
 * Entrada de admin_audit_logs enriquecida com nome do admin (resolve via
 * users JOIN). Renderizada em FinanceiroAuditHistoryBlock.
 */
export interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_name: string | null;
  action: string;
  created_at: string;
  before_data: unknown | null;
  after_data: unknown | null;
}

/**
 * Detalhe completo de um repasse. Estende RepasseRow com campos adicionais
 * (paid_by, comprovante, motivo de estorno, audit history).
 *
 * `auditLogs` carregado via sub-query gated por AUDIT_VIEW (degradacao
 * parcial: array vazio ou ausente quando admin nao tem permissao).
 */
export interface RepasseDetail extends RepasseRow {
  paid_by: string | null;
  paid_by_name: string | null;
  payment_proof_url: string | null;
  notes: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  reverted_by_name: string | null;
  revert_reason: string | null;
  embarcador_email: string | null;
  auditLogs: AuditLogEntry[];
}

// ===================== Mini-dashboard (summary) =====================

/**
 * Bundle agregado para o mini-dashboard da listagem (4 cards).
 * `top_embarcador_devedor` e `null` quando nao ha pendencias no periodo.
 *
 * `period.from` / `period.to` ecoam o range efetivamente aplicado pela RPC
 * (apos defaults) — UI usa para rotular o card "Receita do mes".
 */
export interface FinanceiroSummary {
  receita_mes: number;
  pendentes: { count: number; total: number };
  pagos_mes: { count: number; total: number };
  top_embarcador_devedor: {
    embarcador_id: string;
    name: string;
    total_pendente: number;
  } | null;
  period: { from: string; to: string };
}

// ===================== Mutacoes =====================

/**
 * Payload para markAsPaid. `payment_proof_url` e o path no bucket
 * financial_proofs apos uploadProof; UI deve enviar `null` quando nao
 * houver comprovante anexado. `notes` ate 1000 chars.
 */
export interface MarkAsPaidPayload {
  payment_method: PaymentMethod;
  payment_proof_url: string | null;
  notes: string | null;
  expected_updated_at: string;
}

/**
 * Payload para estornar. `revert_reason` 1..500 chars apos trim — validado
 * tanto no client (validateBrackets-like) quanto na RPC.
 */
export interface EstornarPayload {
  revert_reason: string;
  expected_updated_at: string;
}

/**
 * Resultado canonico de mutacoes idempotentes (markAsPaid, estornar).
 * O ramo `skipped` e retornado quando o estado-alvo ja vigorava — nao
 * houve mutacao real, mas um audit log _SKIPPED foi gravado (CP-2).
 */
export type MutationResult =
  | {
      ok: true;
      id: string;
      updated_at: string;
      paid_at?: string;
      reverted_at?: string;
    }
  | { skipped: true; reason: 'ALREADY_PAID' | 'ALREADY_REVERTED' };

// ===================== Erro tipado =====================

/**
 * Erro canonico do service. Toda funcao publica que falha lanca esta classe
 * com um `code` ∈ FinanceiroErrorCode + `details` opcional para contexto
 * (ex: index do bracket invalido, valor fora de range, etc.).
 *
 * A UI traduz `code` em mensagem pt-BR canonica (tabela em 2.2/2.3).
 */
export class FinanceiroError extends Error {
  readonly code: FinanceiroErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: FinanceiroErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FinanceiroError';
    this.code = code;
    this.details = details;
  }
}

// ===================== Helpers (parte 2.2) =====================

/**
 * Filtros default da listagem. Usado por parseFiltersFromQuery (quando o
 * query string nao traz nenhum parametro) e por serializeFiltersToQuery
 * (omite campos que batem com o default para gerar URLs limpas).
 *
 * Mantem-se intencionalmente enxuto: status/embarcador_id/etc. ficam
 * undefined ate o admin escolher um valor concreto.
 */
export const DEFAULT_REPASSE_FILTERS: RepasseFilters = {
  period_kind: 'fechamento',
  limit: 10,
  offset: 0,
};

/**
 * Tabela canonica de mensagens user-facing pt-BR para cada FinanceiroErrorCode.
 * UI consome isto via `FINANCEIRO_ERROR_MESSAGES[err.code]` antes de exibir
 * toast/inline. Mensagens sao curtas, neutras e sem revelar detalhes internos
 * (anti-enumeration policy do projeto).
 */
export const FINANCEIRO_ERROR_MESSAGES: Record<FinanceiroErrorCode, string> = {
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta area.',
  NOT_FOUND: 'Repasse nao encontrado.',
  STALE_VERSION: 'Outro admin atualizou este registro. Recarregando.',
  INVALID_PERIOD: 'Periodo invalido. Verifique as datas selecionadas.',
  PERIOD_TOO_LARGE: 'Periodo muito longo. Selecione no maximo 12 meses.',
  INVALID_STATUS: 'Status invalido.',
  COMMISSION_PCT_OUT_OF_RANGE: 'Percentual de comissao deve estar entre 0% e 50%.',
  BRACKETS_TOO_MANY: 'Maximo de 5 faixas permitidas.',
  BRACKETS_OUT_OF_ORDER: 'Faixas devem estar ordenadas por valor minimo crescente.',
  BRACKETS_OVERLAP: 'Faixas nao podem se sobrepor.',
  BRACKETS_GAP: 'Faixas nao podem ter buracos entre os valores.',
  INVALID_BRACKETS: 'Configuracao de faixas invalida.',
  INVALID_INPUT: 'Dados invalidos. Verifique os campos preenchidos.',
  UNKNOWN: 'Nao foi possivel concluir a operacao. Tente novamente.',
};

/**
 * Arredondamento half-away-from-zero para 2 casas decimais.
 * Espelha ROUND(x, 2) do PostgreSQL — usado em computeCommission para
 * paridade SQL/TS (CP-1).
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Helper puro paritario com a funcao SQL `compute_commission_value`
 * (migration 037, IMMUTABLE) — formaliza CP-1.
 *
 * Resolve o percentual de comissao aplicavel sobre um `valor_bruto`
 * dado um snapshot de `FinanceiroSettings`:
 *
 *  - settings ausente / id null / nao-objeto ⇒ flat_default 0%.
 *  - brackets vazios ⇒ usa `commission_pct` flat.
 *  - brackets nao-vazios:
 *      * intervalo `[min_value, max_value)` para cada faixa;
 *      * a ULTIMA faixa e inclusiva no `max_value` (`bracket_max_inclusive`);
 *      * valor acima do teto da ultima faixa ⇒ cai no flat.
 *  - Arredondamento `Math.round(x*100)/100` em commission_value e
 *    valor_liquido (paridade com `ROUND(x, 2)` SQL).
 *
 * @param valor_bruto Valor bruto do frete em R$. Negativo/NaN/Infinity ⇒ 0.
 * @param settings    Snapshot de configuracao vigente. null/sentinel ⇒ flat_default.
 */
export function computeCommission(
  valor_bruto: number,
  settings: FinanceiroSettings | null
): {
  commission_pct: number;
  commission_value: number;
  valor_liquido: number;
  resolved_via: 'flat' | 'bracket' | 'bracket_max_inclusive' | 'flat_default';
} {
  // Normalizacao defensiva do valor.
  const v = !Number.isFinite(valor_bruto) || valor_bruto < 0 ? 0 : valor_bruto;

  // Sentinela: settings ausente, sem linha (id null) ou tipo errado ⇒ flat 0%.
  if (settings == null || typeof settings !== 'object' || settings.id == null) {
    return {
      commission_pct: 0,
      commission_value: 0,
      valor_liquido: round2(v),
      resolved_via: 'flat_default',
    };
  }

  const flat = Number.isFinite(settings.commission_pct) ? Number(settings.commission_pct) : 0;
  const brackets: CommissionBracket[] = Array.isArray(settings.commission_brackets)
    ? settings.commission_brackets
    : [];

  let resolved_pct = flat;
  let resolved_via: 'flat' | 'bracket' | 'bracket_max_inclusive' | 'flat_default' = 'flat';

  if (brackets.length > 0) {
    let found = false;
    for (const b of brackets) {
      if (v >= b.min_value && v < b.max_value) {
        resolved_pct = b.pct;
        resolved_via = 'bracket';
        found = true;
        break;
      }
    }
    if (!found) {
      const last = brackets[brackets.length - 1];
      if (last && v === last.max_value) {
        resolved_pct = last.pct;
        resolved_via = 'bracket_max_inclusive';
      }
      // Caso contrario, mantem flat (valor acima do teto da ultima faixa).
    }
  }

  const commission_value = round2((v * resolved_pct) / 100);
  const valor_liquido = round2(v - commission_value);

  return { commission_pct: resolved_pct, commission_value, valor_liquido, resolved_via };
}

/**
 * Valida um array de brackets com a mesma logica aplicada server-side em
 * `admin_financeiro_settings_update` (migration 037). Usado pela UI de
 * configuracoes para feedback inline antes do submit.
 *
 * Regras (ordem de checagem importa):
 *  - array vazio ⇒ ok (significa "so flat").
 *  - length > 5 ⇒ BRACKETS_TOO_MANY.
 *  - cada item: min/max/pct numericos finitos, min >= 0, max > min,
 *    pct ∈ [0, 50] ⇒ INVALID_BRACKETS com index.
 *  - pares consecutivos:
 *      * min[i] <= min[i-1] ⇒ BRACKETS_OUT_OF_ORDER (index = i)
 *      * min[i] < max[i-1]  ⇒ BRACKETS_OVERLAP      (index = i)
 *      * min[i] > max[i-1]  ⇒ BRACKETS_GAP          (index = i)
 */
export function validateBrackets(brackets: CommissionBracket[]):
  | { ok: true }
  | {
      ok: false;
      code:
        | 'BRACKETS_TOO_MANY'
        | 'BRACKETS_OUT_OF_ORDER'
        | 'BRACKETS_OVERLAP'
        | 'BRACKETS_GAP'
        | 'INVALID_BRACKETS';
      index?: number;
    } {
  if (!Array.isArray(brackets)) return { ok: false, code: 'INVALID_BRACKETS' };
  if (brackets.length === 0) return { ok: true };
  if (brackets.length > 5) return { ok: false, code: 'BRACKETS_TOO_MANY' };

  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (
      !b ||
      !Number.isFinite(b.min_value) ||
      !Number.isFinite(b.max_value) ||
      !Number.isFinite(b.pct) ||
      b.min_value < 0 ||
      b.max_value <= b.min_value ||
      b.pct < 0 ||
      b.pct > 50
    ) {
      return { ok: false, code: 'INVALID_BRACKETS', index: i };
    }
    if (i > 0) {
      const prev = brackets[i - 1];
      if (b.min_value <= prev.min_value) {
        return { ok: false, code: 'BRACKETS_OUT_OF_ORDER', index: i };
      }
      if (b.min_value < prev.max_value) {
        return { ok: false, code: 'BRACKETS_OVERLAP', index: i };
      }
      if (b.min_value > prev.max_value) {
        return { ok: false, code: 'BRACKETS_GAP', index: i };
      }
    }
  }

  return { ok: true };
}

/**
 * Sanitiza nome de arquivo para uso como path no bucket `financial_proofs`.
 *
 * Regras (idempotente: sanitize(sanitize(x)) === sanitize(x)):
 *  1. NFD + remove combining marks (acentos).
 *  2. Espacos ⇒ '_'.
 *  3. Remove qualquer char fora de [a-zA-Z0-9._-].
 *  4. Colapsa '_' consecutivos.
 *  5. Trim de '_' e '.' das pontas.
 *  6. Lowercase.
 *  7. Limita a 80 chars preservando a extensao quando possivel.
 *  8. Fallback 'comprovante' se ficar vazio.
 */
export function sanitizeProofFilename(filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) return 'comprovante';

  // 1. NFD + remove acentos.
  const noDiacritics = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 2. Espacos ⇒ '_'.
  let cleaned = noDiacritics.replace(/\s+/g, '_');

  // 3. Remove chars fora do conjunto seguro.
  cleaned = cleaned.replace(/[^a-zA-Z0-9._-]/g, '');

  // 4. Colapsa '_' consecutivos.
  cleaned = cleaned.replace(/_+/g, '_');

  // 5. Trim '_' e '.' das pontas.
  cleaned = cleaned.replace(/^[_.]+|[_.]+$/g, '');

  // 6. Lowercase.
  cleaned = cleaned.toLowerCase();

  // 7. Limite de 80 chars preservando extensao.
  const MAX_LEN = 80;
  if (cleaned.length > MAX_LEN) {
    const dot = cleaned.lastIndexOf('.');
    if (dot > 0 && dot >= cleaned.length - 10 && dot < MAX_LEN) {
      const ext = cleaned.slice(dot);
      const base = cleaned.slice(0, MAX_LEN - ext.length).replace(/[_.]+$/g, '');
      cleaned = base + ext;
    } else {
      cleaned = cleaned.slice(0, MAX_LEN).replace(/[_.]+$/g, '');
    }
  }

  return cleaned.length > 0 ? cleaned : 'comprovante';
}

/**
 * Conjunto de MIME types aceitos para comprovante de pagamento.
 * Espelha o cap configurado no bucket `financial_proofs` na migration 037.
 */
const ALLOWED_PROOF_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Tamanho maximo aceito para comprovante: 5 MiB (cap espelhado no bucket). */
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Valida arquivo de comprovante antes do upload (complementar ao cap
 * configurado server-side no bucket).
 *
 * Aceita PDF/PNG/JPG/WEBP ate 5 MiB. Reason em pt-BR para exibicao direta
 * em toast/inline.
 */
export function validateProofFile(
  file: File
): { ok: true } | { ok: false; code: 'INVALID_INPUT'; reason: string } {
  if (!file || typeof file !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', reason: 'Arquivo invalido.' };
  }
  if (!ALLOWED_PROOF_MIMES.has(file.type)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'Formato nao suportado. Envie PDF, PNG, JPG ou WEBP.',
    };
  }
  if (file.size > PROOF_MAX_BYTES) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'Arquivo muito grande. Tamanho maximo: 5 MB.',
    };
  }
  return { ok: true };
}

// ===================== Filtros: URL <-> objeto =====================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_REPASSE_STATUSES: ReadonlySet<RepasseStatus> = new Set([
  'pendente',
  'pago',
  'estornado',
]);
const VALID_PERIOD_KINDS: ReadonlySet<PeriodKind> = new Set(['fechamento', 'pagamento']);
const VALID_PAGE_SIZES: ReadonlySet<number> = new Set([10, 50, 100]);

function parseIsoDate(s: string | null): string | null {
  if (s == null || !ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function parseFiniteNumber(s: string | null): number | null {
  if (s == null || s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Le filtros de listagem a partir do query string da URL.
 * Aceita `URLSearchParams` ou string (com ou sem `?` inicial).
 *
 * Validacao de dominio:
 *  - status fora do enum ⇒ ignorado.
 *  - period_kind fora do enum ⇒ default 'fechamento'.
 *  - period_from/period_to malformatados ⇒ ignorados.
 *  - limit fora de {10,50,100} ⇒ default 10.
 *  - offset negativo ou nao-finito ⇒ 0.
 *
 * Round-trip com `serializeFiltersToQuery` para o conjunto de campos
 * preservados (exclui campos default omitidos na serializacao).
 */
export function parseFiltersFromQuery(qs: URLSearchParams | string): RepasseFilters {
  const params =
    typeof qs === 'string' ? new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs) : qs;

  const status = params.get('status');
  const period_kind = params.get('period_kind');
  const limitRaw = params.get('limit');
  const offsetRaw = params.get('offset');
  const minValueRaw = params.get('min_value');
  const maxValueRaw = params.get('max_value');

  const validStatus: RepasseStatus | null =
    status && VALID_REPASSE_STATUSES.has(status as RepasseStatus)
      ? (status as RepasseStatus)
      : null;
  const validPeriodKind: PeriodKind =
    period_kind && VALID_PERIOD_KINDS.has(period_kind as PeriodKind)
      ? (period_kind as PeriodKind)
      : 'fechamento';
  const limitNum = parseFiniteNumber(limitRaw);
  const validLimit = limitNum != null && VALID_PAGE_SIZES.has(limitNum) ? limitNum : 10;
  const offsetNum = parseFiniteNumber(offsetRaw);
  const validOffset =
    offsetNum != null && Number.isInteger(offsetNum) && offsetNum >= 0 ? offsetNum : 0;

  const result: RepasseFilters = {
    period_kind: validPeriodKind,
    limit: validLimit,
    offset: validOffset,
  };

  if (validStatus) result.status = validStatus;
  const embarcador_id = params.get('embarcador_id');
  if (embarcador_id) result.embarcador_id = embarcador_id;
  const motorista_id = params.get('motorista_id');
  if (motorista_id) result.motorista_id = motorista_id;
  const period_from = parseIsoDate(params.get('period_from'));
  if (period_from) result.period_from = period_from;
  const period_to = parseIsoDate(params.get('period_to'));
  if (period_to) result.period_to = period_to;
  const minValue = parseFiniteNumber(minValueRaw);
  if (minValue != null && minValue >= 0) result.min_value = minValue;
  const maxValue = parseFiniteNumber(maxValueRaw);
  if (maxValue != null && maxValue >= 0) result.max_value = maxValue;
  const search = params.get('search');
  if (search && search.trim().length > 0) result.search = search;

  return result;
}

/**
 * Serializa filtros para `URLSearchParams`. Omite campos que coincidem com
 * `DEFAULT_REPASSE_FILTERS` para gerar URLs limpas. Round-trip com
 * `parseFiltersFromQuery` para o conjunto de campos preservados.
 */
export function serializeFiltersToQuery(f: RepasseFilters): URLSearchParams {
  const qs = new URLSearchParams();

  if (f.status && VALID_REPASSE_STATUSES.has(f.status)) qs.set('status', f.status);
  if (f.embarcador_id) qs.set('embarcador_id', f.embarcador_id);
  if (f.motorista_id) qs.set('motorista_id', f.motorista_id);
  if (f.period_kind && f.period_kind !== DEFAULT_REPASSE_FILTERS.period_kind) {
    qs.set('period_kind', f.period_kind);
  }
  if (f.period_from && ISO_DATE_REGEX.test(f.period_from)) qs.set('period_from', f.period_from);
  if (f.period_to && ISO_DATE_REGEX.test(f.period_to)) qs.set('period_to', f.period_to);
  if (f.min_value != null && Number.isFinite(f.min_value) && f.min_value >= 0) {
    qs.set('min_value', String(f.min_value));
  }
  if (f.max_value != null && Number.isFinite(f.max_value) && f.max_value >= 0) {
    qs.set('max_value', String(f.max_value));
  }
  if (f.search && f.search.trim().length > 0) qs.set('search', f.search);
  if (
    f.limit != null &&
    f.limit !== DEFAULT_REPASSE_FILTERS.limit &&
    VALID_PAGE_SIZES.has(f.limit)
  ) {
    qs.set('limit', String(f.limit));
  }
  if (
    f.offset != null &&
    f.offset !== DEFAULT_REPASSE_FILTERS.offset &&
    Number.isInteger(f.offset) &&
    f.offset >= 0
  ) {
    qs.set('offset', String(f.offset));
  }

  return qs;
}

// ===================== Formatadores =====================

/** Sentinel exibido em valores ausentes (null/undefined/invalido). */
const EMPTY_PLACEHOLDER = '\u2014'; // em-dash —

/**
 * Formata valor monetario em BRL (pt-BR). null/undefined/NaN ⇒ '—'.
 */
export function formatBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EMPTY_PLACEHOLDER;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

/**
 * Formata numero generico em pt-BR com `decimals` casas decimais (default 2).
 * null/undefined/NaN ⇒ '—'.
 */
export function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return EMPTY_PLACEHOLDER;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Formata data ISO 8601 como `dd/MM/yyyy HH:mm` no fuso pt-BR. null/invalido ⇒ '—'.
 */
export function formatDate(iso: string | null): string {
  if (iso == null) return EMPTY_PLACEHOLDER;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_PLACEHOLDER;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formata metodo de pagamento para exibicao. null ⇒ '—'.
 *  pix ⇒ 'PIX', ted ⇒ 'TED', boleto ⇒ 'Boleto', dinheiro ⇒ 'Dinheiro', outro ⇒ 'Outro'.
 */
export function formatPaymentMethod(m: PaymentMethod | null): string {
  if (m == null) return EMPTY_PLACEHOLDER;
  switch (m) {
    case 'pix':
      return 'PIX';
    case 'ted':
      return 'TED';
    case 'boleto':
      return 'Boleto';
    case 'dinheiro':
      return 'Dinheiro';
    case 'outro':
      return 'Outro';
    default:
      return EMPTY_PLACEHOLDER;
  }
}

/**
 * Formata tempo relativo em pt-BR (`ha X minutos/horas/dias`). null/invalido ⇒ '—'.
 *
 * Aceita `now` opcional para testabilidade.
 */
export function formatRelativeTime(iso: string | null, now: Date = new Date()): string {
  if (iso == null) return EMPTY_PLACEHOLDER;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_PLACEHOLDER;

  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return 'agora';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return minutes === 1 ? 'ha 1 minuto' : `ha ${minutes} minutos`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'ha 1 hora' : `ha ${hours} horas`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'ha 1 dia';
  return `ha ${days} dias`;
}

// ===================== Mapeamento de erros (parte 2.3) =====================

/**
 * Mapeia um erro vindo de chamada Supabase RPC (qualquer formato) para um
 * `FinanceiroError` tipado, com `code` ∈ `FinanceiroErrorCode` e mensagem
 * user-facing canonica em pt-BR (via `FINANCEIRO_ERROR_MESSAGES`).
 *
 * Espelha a tabela do design (§Error Handling — Mapeamento Postgres ↔ TS).
 * O erro original e preservado em `details.original` para facilitar debug
 * sem expor detalhes internos para o usuario.
 *
 * Estrategia de matching (ordem importa — mais especifico primeiro):
 *
 *  1. Se ja for `FinanceiroError`, retorna inalterado (idempotente — permite
 *     que paths internos do service "re-throw" sem duplicar o wrap).
 *  2. Le `code` e `message` defensivamente via `as { code?; message? }`
 *     (supabase-js entrega `{ code: '42501'|'P0001'|'22023'|...; message; details }`,
 *     mas `err` pode chegar como `Error`, string ou outro shape).
 *  3. Substring match na mensagem (case-insensitive apenas em
 *     `permission_denied`, que pode vir minusculo do Postgres). PERIOD_TOO_LARGE
 *     e BRACKETS_* sao checados ANTES de INVALID_PERIOD/INVALID_BRACKETS para
 *     evitar falso positivo (especificos antes de catch-all).
 *  4. ERRCODE Postgres como fallback paralelo:
 *      - `42501` ⇒ PERMISSION_DENIED (mesmo sem mensagem).
 *      - `22023` ⇒ INVALID_PERIOD (apos checar PERIOD_TOO_LARGE no message).
 *  5. Default ⇒ UNKNOWN.
 *
 * @param err Erro arbitrario vindo de RPC ou rejeicao de Promise.
 * @returns `FinanceiroError` com `code` mapeado, mensagem canonica e
 *          `details: { original }` para inspecao.
 */
export function mapPostgresError(err: unknown): FinanceiroError {
  // 1. Idempotencia: nao re-wrap erro ja tipado.
  if (err instanceof FinanceiroError) return err;

  // 2. Leitura defensiva de code/message.
  const e = (err ?? {}) as { code?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message : '';
  const lower = msg.toLowerCase();

  // Helper para construir o erro com mensagem canonica + original em details.
  const wrap = (mapped: FinanceiroErrorCode): FinanceiroError =>
    new FinanceiroError(mapped, FINANCEIRO_ERROR_MESSAGES[mapped], { original: err });

  // 3. PERMISSION_DENIED: ERRCODE 42501 ou substring case-insensitive.
  if (code === '42501' || lower.includes('permission_denied')) {
    return wrap('PERMISSION_DENIED');
  }
  // 4. STALE_VERSION (versionamento otimista — admin-patterns.md §3).
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  // 5. NOT_FOUND (entidade inexistente — Stealth_404 na UI).
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  // 6. PERIOD_TOO_LARGE — checado ANTES de INVALID_PERIOD para evitar
  //    que o fallback `code === '22023'` engane (ambos compartilham ERRCODE).
  if (msg.includes('PERIOD_TOO_LARGE')) return wrap('PERIOD_TOO_LARGE');
  // 7. INVALID_PERIOD: substring ou ERRCODE 22023 (Postgres invalid_parameter_value).
  if (msg.includes('INVALID_PERIOD') || code === '22023') return wrap('INVALID_PERIOD');
  // 8. INVALID_STATUS (mark_paid em estornado, estornar em pendente, etc).
  if (msg.includes('INVALID_STATUS')) return wrap('INVALID_STATUS');
  // 9. COMMISSION_PCT_OUT_OF_RANGE (settings_update, fora de [0, 50]).
  if (msg.includes('COMMISSION_PCT_OUT_OF_RANGE')) return wrap('COMMISSION_PCT_OUT_OF_RANGE');
  // 10. BRACKETS_* especificos antes do catch-all INVALID_BRACKETS.
  if (msg.includes('BRACKETS_TOO_MANY')) return wrap('BRACKETS_TOO_MANY');
  if (msg.includes('BRACKETS_OUT_OF_ORDER')) return wrap('BRACKETS_OUT_OF_ORDER');
  if (msg.includes('BRACKETS_OVERLAP')) return wrap('BRACKETS_OVERLAP');
  if (msg.includes('BRACKETS_GAP')) return wrap('BRACKETS_GAP');
  // 11. INVALID_BRACKETS (catch-all de validacao de faixas).
  if (msg.includes('INVALID_BRACKETS')) return wrap('INVALID_BRACKETS');
  // 12. INVALID_INPUT (catch-all de validacao generica).
  if (msg.includes('INVALID_INPUT')) return wrap('INVALID_INPUT');
  // 13. Default: tudo o mais (network, deadlock, erro inesperado) ⇒ UNKNOWN.
  return wrap('UNKNOWN');
}

// ===================== Services de leitura (parte 3.x) =====================

/**
 * Le a configuracao vigente de comissao do financeiro via RPC
 * `admin_financeiro_settings_get` (STABLE SECURITY DEFINER, gated por
 * `FINANCEIRO_VIEW`).
 *
 * Sentinel: quando a tabela `financial_settings` esta vazia (instalacao
 * fresh), a RPC retorna `id=null` com `commission_pct=0`,
 * `commission_brackets=[]` e demais campos null. O service preserva o
 * sentinel sem normalizar para nao perder a informacao "nao ha linha
 * vigente" — chamadores (UI/`computeCommission`) tratam isso como flat 0%.
 *
 * Erros Postgres sao mapeados via `mapPostgresError` para `FinanceiroError`
 * com `code` canonico:
 *  - ERRCODE 42501 / `permission_denied: FINANCEIRO_VIEW required`
 *    ⇒ `PERMISSION_DENIED`.
 *  - Demais falhas (network, timeout, erro inesperado) ⇒ `UNKNOWN`.
 */
export async function getSettings(): Promise<FinanceiroSettings> {
  const { data, error } = await supabase.rpc('admin_financeiro_settings_get');
  if (error) throw mapPostgresError(error);

  const raw = (data ?? {}) as {
    id?: string | null;
    commission_pct?: number | string | null;
    commission_brackets?: unknown;
    effective_from?: string | null;
    updated_at?: string | null;
    updated_by?: string | null;
  };

  const pct = Number(raw.commission_pct ?? 0);

  return {
    id: raw.id ?? null,
    commission_pct: Number.isFinite(pct) ? pct : 0,
    commission_brackets: Array.isArray(raw.commission_brackets)
      ? (raw.commission_brackets as CommissionBracket[])
      : [],
    effective_from: raw.effective_from ?? null,
    updated_at: raw.updated_at ?? null,
    updated_by: raw.updated_by ?? null,
  };
}

/**
 * Lista repasses paginados via RPC `admin_repasses_list(jsonb)` (STABLE
 * SECURITY DEFINER, gated por `FINANCEIRO_VIEW`).
 *
 * Normaliza `filters` (RepasseFilters) em um payload `jsonb` compactado,
 * incluindo apenas chaves nao-default/nao-null/nao-undefined — a RPC ja
 * normaliza internamente, mas a compactacao aqui ajuda no log de auditoria
 * e mantem consistencia com a serializacao da URL. O campo `search` e
 * trimado antes de enviar.
 *
 * Defaults aplicados quando `filters` nao traz o campo:
 *  - `period_kind`: `'fechamento'`.
 *  - `limit`: `10` (page size default da listagem).
 *  - `offset`: `0`.
 *
 * O retorno ecoa os ranges efetivamente aplicados pela RPC (`total`,
 * `limit`, `offset`) para alimentar o componente de paginacao "X de Y".
 * Numeros nao-finitos vindos do servidor caem para defaults seguros.
 *
 * Erros Postgres sao mapeados via `mapPostgresError` para `FinanceiroError`
 * com `code` canonico:
 *  - ERRCODE 42501 / `permission_denied: FINANCEIRO_VIEW required`
 *    ⇒ `PERMISSION_DENIED`.
 *  - ERRCODE 22023 / `INVALID_PERIOD` ⇒ `INVALID_PERIOD`.
 *  - `PERIOD_TOO_LARGE` ⇒ `PERIOD_TOO_LARGE`.
 *  - Demais falhas (network, timeout) ⇒ `UNKNOWN`.
 */
export async function listRepasses(
  filters: RepasseFilters = DEFAULT_REPASSE_FILTERS
): Promise<ListRepassesResult> {
  // Constroi payload jsonb apenas com chaves nao-default/nao-null/nao-undefined
  // (a RPC ja normaliza, mas ajuda no log e na consistencia).
  const payload: Record<string, unknown> = {
    period_kind: filters.period_kind ?? 'fechamento',
    limit: filters.limit ?? 10,
    offset: filters.offset ?? 0,
  };
  if (filters.status) payload.status = filters.status;
  if (filters.embarcador_id) payload.embarcador_id = filters.embarcador_id;
  if (filters.motorista_id) payload.motorista_id = filters.motorista_id;
  if (filters.period_from) payload.period_from = filters.period_from;
  if (filters.period_to) payload.period_to = filters.period_to;
  if (filters.min_value != null) payload.min_value = filters.min_value;
  if (filters.max_value != null) payload.max_value = filters.max_value;
  if (filters.search && filters.search.trim().length > 0) payload.search = filters.search.trim();

  const { data, error } = await supabase.rpc('admin_repasses_list', { p_filters: payload });
  if (error) throw mapPostgresError(error);

  const raw = (data ?? {}) as {
    items?: unknown[];
    total?: number | string;
    limit?: number | string;
    offset?: number | string;
  };

  const items: RepasseRow[] = Array.isArray(raw.items) ? (raw.items as RepasseRow[]) : [];
  const total = Number(raw.total ?? 0);
  const limit = Number(raw.limit ?? payload.limit);
  const offset = Number(raw.offset ?? payload.offset);

  return {
    items,
    total: Number.isFinite(total) ? total : 0,
    limit: Number.isFinite(limit) ? limit : 10,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

/**
 * Le o bundle agregado do mini-dashboard da listagem de repasses via RPC
 * `admin_financeiro_summary(p_from, p_to)` (STABLE SECURITY DEFINER, gated
 * por `FINANCEIRO_VIEW`).
 *
 * Defaults de periodo: `from`/`to` aceitam `null` (default em ambos) — quando
 * NULL e enviado, a RPC aplica `date_trunc('month', NOW())` para `p_from` e
 * `NOW()` para `p_to`. O cliente NUNCA calcula esses defaults: deixa a RPC
 * decidir para garantir consistencia com a janela "mes corrente" do servidor
 * (paridade com a timezone do banco).
 *
 * Retorno (`FinanceiroSummary`):
 *  - `receita_mes`: SUM(commission_value) dos repasses pagos no periodo.
 *  - `pendentes`: `{count, total}` — count e SUM(valor_bruto) de pendentes
 *    no periodo (filtrados por `closed_at`).
 *  - `pagos_mes`: `{count, total}` — count e SUM(valor_liquido) de pagos
 *    no periodo (filtrados por `paid_at`).
 *  - `top_embarcador_devedor`: embarcador com maior SUM(valor_bruto) em
 *    pendentes em aberto (sem filtro de tempo, tiebreaker embarcador_id ASC).
 *    `null` quando nao ha pendencias. Tambem normalizado para `null` se a
 *    RPC retornar um objeto sem `embarcador_id` ou `name`.
 *  - `period`: `{from, to}` ecoa a janela efetivamente aplicada pela RPC
 *    (apos defaults) — UI usa para rotular o card "Receita do mes".
 *
 * Numeros sao normalizados via `Number(...)` com fallback `0` para
 * defender contra valores nao-finitos (NaN/Infinity) ou strings — Postgres
 * `numeric` chega como string em alguns drivers.
 *
 * Erros Postgres sao mapeados via `mapPostgresError` para `FinanceiroError`
 * com `code` canonico:
 *  - ERRCODE 42501 / `permission_denied: FINANCEIRO_VIEW required`
 *    ⇒ `PERMISSION_DENIED` (RPC tambem grava `FINANCIAL_VIEW_DENIED`).
 *  - `INVALID_PERIOD` (to < from) ⇒ `INVALID_PERIOD`.
 *  - `PERIOD_TOO_LARGE` (to - from > 365 dias) ⇒ `PERIOD_TOO_LARGE`.
 *  - Demais falhas (network, timeout) ⇒ `UNKNOWN`.
 *
 * @param from String ISO 8601 (timestamptz) ou `null` para default da RPC.
 * @param to   String ISO 8601 (timestamptz) ou `null` para default da RPC.
 */
export async function getSummary(
  from: string | null = null,
  to: string | null = null
): Promise<FinanceiroSummary> {
  const { data, error } = await supabase.rpc('admin_financeiro_summary', {
    p_from: from,
    p_to: to,
  });
  if (error) throw mapPostgresError(error);

  const raw = (data ?? {}) as {
    receita_mes?: number | string;
    pendentes?: { count?: number | string; total?: number | string };
    pagos_mes?: { count?: number | string; total?: number | string };
    top_embarcador_devedor?: {
      embarcador_id?: string;
      name?: string;
      total_pendente?: number | string;
    } | null;
    period?: { from?: string; to?: string };
  };

  const num = (v: unknown, fallback = 0): number => {
    const n = Number(v ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  };

  const top = raw.top_embarcador_devedor;
  return {
    receita_mes: num(raw.receita_mes),
    pendentes: {
      count: num(raw.pendentes?.count),
      total: num(raw.pendentes?.total),
    },
    pagos_mes: {
      count: num(raw.pagos_mes?.count),
      total: num(raw.pagos_mes?.total),
    },
    top_embarcador_devedor:
      top && top.embarcador_id && top.name != null
        ? {
            embarcador_id: top.embarcador_id,
            name: top.name,
            total_pendente: num(top.total_pendente),
          }
        : null,
    period: {
      from: raw.period?.from ?? '',
      to: raw.period?.to ?? '',
    },
  };
}

/**
 * Regex de UUID v1-v5 (RFC 4122 relaxado: aceita qualquer variante de
 * `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`). Usado
 * por `getRepasseDetail` para validar o id antes de qualquer round-trip
 * com o servidor — id malformado vira NOT_FOUND imediato (Stealth_404 na UI).
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve o `name` retornado pelo Supabase em queries com FK embedding,
 * que pode chegar como objeto (1:1) ou array (1:N). Padrao herdado de
 * `blacklist.ts` (CP-1 do admin-blacklist).
 */
function pickUserName(
  rel: { name: string | null } | { name: string | null }[] | null | undefined
): string | null {
  if (!rel) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  return obj?.name ?? null;
}

/**
 * Carrega o detalhe completo de um repasse para a `FinanceiroDetailPage`.
 *
 * Estrategia (MVP — admin-patterns.md Sec. 6 "Degradacao parcial"):
 *
 * 1. Valida UUID localmente. Id malformado nunca chega ao servidor — lanca
 *    `FinanceiroError('NOT_FOUND')` que a UI converte em Stealth_404.
 *
 * 2. Localiza o `RepasseRow` paginando via `admin_repasses_list`. A
 *    migration 037 nao tem RPC dedicada `admin_repasse_detail(uuid)` e a
 *    tabela `financial_repasses` tem RLS `no_dml` (bloqueia SELECT direto
 *    pelo role authenticated). Walk-through limitado a 5 paginas de 100
 *    (cap defensivo de 500 repasses) — cobre o backlog atual com folga.
 *
 *    TODO(037-followup): adicionar RPC `admin_repasse_detail(uuid)` na
 *    proxima migration para (a) eliminar este walk-through, (b) carregar
 *    em uma unica chamada os campos extras (paid_by, payment_proof_url,
 *    notes, reverted_*), e (c) bater latencia < 100ms. Sem essa RPC, os
 *    campos extras ficam como `null` no MVP e a `FinanceiroDetailPage`
 *    mostra os blocos correspondentes em estado "indisponivel".
 *
 * 3. Sub-queries em `Promise.allSettled` (admin-patterns.md Sec. 6):
 *    - `users.email` do embarcador — gated por RLS `users_admin_select`
 *      (`USER_VIEW`); falha gracefully para `null`.
 *    - `admin_audit_logs` filtrado por `target_type='financial_repasses'`
 *      AND `target_id=<id>` — gated por RLS `admin_audit_select`
 *      (`AUDIT_VIEW`); falha gracefully para `[]`. Limite de 50 entradas
 *      ordenadas DESC por `created_at` (ultimas mutacoes primeiro).
 *
 * 4. Bloco principal (`row`) e o unico que pode lancar `NOT_FOUND` global.
 *    Falhas dos blocos auxiliares NUNCA derrubam o detail — degradam
 *    silenciosamente para os fallbacks documentados acima.
 *
 * Erros mapeados:
 *  - UUID invalido / repasse nao encontrado nas 5 paginas ⇒ `NOT_FOUND`
 *    ⇒ Stealth_404 na UI (admin-patterns.md Sec. 5).
 *  - Falta de `FINANCEIRO_VIEW` ⇒ `mapPostgresError` em `listRepasses`
 *    propaga `PERMISSION_DENIED` (a RPC ja gravou `FINANCIAL_VIEW_DENIED`
 *    no audit log).
 *  - Falhas de network/timeout em sub-queries ⇒ degradacao silenciosa
 *    (campo vai para `null` ou `[]`).
 */
export async function getRepasseDetail(id: string): Promise<RepasseDetail> {
  // 1. Validacao de UUID pre-servidor (Stealth_404).
  if (!UUID_REGEX.test(id)) {
    throw new FinanceiroError('NOT_FOUND', FINANCEIRO_ERROR_MESSAGES.NOT_FOUND);
  }

  // 2. Walk-through paginado em admin_repasses_list ate localizar o id.
  //    Cap defensivo de 5 paginas x 100 = 500 repasses. Acima disso,
  //    NOT_FOUND (a RPC dedicada cobre esse caso quando entrar).
  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;
  let row: RepasseRow | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listRepasses({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      period_kind: 'fechamento',
    });
    row = result.items.find((r) => r.id === id);
    if (row) break;
    // Saiu do range: nao precisa pedir mais paginas.
    if ((page + 1) * PAGE_SIZE >= result.total) break;
  }

  if (!row) {
    throw new FinanceiroError('NOT_FOUND', FINANCEIRO_ERROR_MESSAGES.NOT_FOUND);
  }

  // 3. Sub-queries paralelas (Promise.allSettled, admin-patterns.md Sec. 6).
  const [emailRes, auditRes] = await Promise.allSettled([
    supabase.from('users').select('email').eq('id', row.embarcador_id).maybeSingle(),
    supabase
      .from('admin_audit_logs')
      .select('id, admin_id, action, created_at, before_data, after_data, users:admin_id(name)')
      .eq('target_type', 'financial_repasses')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  // 3a. Embarcador email — degrada para null em qualquer falha.
  let embarcador_email: string | null = null;
  if (emailRes.status === 'fulfilled' && !emailRes.value.error && emailRes.value.data) {
    const u = emailRes.value.data as { email?: string | null };
    embarcador_email = u.email ?? null;
  }

  // 3b. Audit logs — degrada para [] em falha. Sem permissao AUDIT_VIEW,
  //     a RLS `admin_audit_select` retorna 0 linhas (nao raise) — o que ja
  //     entrega o efeito desejado de "ocultar bloco".
  let auditLogs: AuditLogEntry[] = [];
  if (auditRes.status === 'fulfilled' && !auditRes.value.error && auditRes.value.data) {
    const rows = auditRes.value.data as Array<{
      id: string;
      admin_id: string;
      action: string;
      created_at: string;
      before_data: unknown;
      after_data: unknown;
      users: { name: string | null } | { name: string | null }[] | null;
    }>;
    auditLogs = rows.map((h) => ({
      id: h.id,
      admin_id: h.admin_id,
      admin_name: pickUserName(h.users),
      action: h.action,
      created_at: h.created_at,
      before_data: h.before_data,
      after_data: h.after_data,
    }));
  }

  // 4. Composicao final. Campos `paid_by`, `payment_proof_url`, `notes`,
  //    `reverted_*` ficam null no MVP (ver TODO no JSDoc acima).
  return {
    ...row,
    paid_by: null,
    paid_by_name: null,
    payment_proof_url: null,
    notes: null,
    reverted_at: null,
    reverted_by: null,
    reverted_by_name: null,
    revert_reason: null,
    embarcador_email,
    auditLogs,
  };
}

/**
 * Gera URL assinada (signed URL) para download de comprovante de pagamento
 * armazenado no bucket privado `financial_proofs`.
 *
 * Validacao:
 *  - `path` deve ser string nao-vazia.
 *  - Caso contrario lanca `FinanceiroError('INVALID_INPUT')`.
 *
 * Implementacao:
 *  - `supabase.storage.from('financial_proofs').createSignedUrl(path, 7 dias)`.
 *  - 7 dias = 7 * 24 * 3600 = 604800 segundos. Suficiente para previa
 *    inline + download manual sem precisar regerar a cada interacao.
 *  - Falha de assinatura (path inexistente, sem permissao FINANCEIRO_VIEW
 *    via RLS, etc.) -> mapPostgresError preserva a anti-enumeration policy
 *    do projeto (nao distingue "arquivo nao existe" de "sem permissao").
 *
 * @param path Path relativo dentro do bucket: `<repasse_id>/<filename>`.
 * @returns Signed URL valida por 7 dias.
 */
export async function getProofSignedUrl(path: string): Promise<string> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new FinanceiroError('INVALID_INPUT', FINANCEIRO_ERROR_MESSAGES.INVALID_INPUT);
  }

  const SEVEN_DAYS = 7 * 24 * 3600;
  const { data, error } = await supabase.storage
    .from('financial_proofs')
    .createSignedUrl(path, SEVEN_DAYS);

  if (error || !data?.signedUrl) {
    throw mapPostgresError(error ?? new Error('createSignedUrl failed'));
  }

  return data.signedUrl;
}

// ===================== Services de mutacao (parte 4.x) =====================

/**
 * Atualiza a configuracao vigente de comissao do financeiro via RPC
 * `admin_financeiro_settings_update` (SECURITY DEFINER, gated por
 * `FINANCEIRO_EDIT`). Cada chamada cria uma nova linha-snapshot em
 * `financial_settings` (NAO UPDATE) — a "Vigent_Settings" passa a ser a
 * mais recente. Mudancas sao prospectivas: repasses ja criados nunca
 * sao recalculados (design.md §Dados — Snapshot imutavel).
 *
 * Pre-validacao client-side antes da RPC (UX rapida + economiza round-trip):
 *   1. `commission_pct` ∈ [0, 50] ⇒ falha vira `COMMISSION_PCT_OUT_OF_RANGE`.
 *   2. `validateBrackets(payload.commission_brackets)` ⇒ qualquer falha
 *      vira `FinanceiroError(<code>, ..., { index })`. Os codigos cobrem
 *      `BRACKETS_TOO_MANY`, `BRACKETS_OUT_OF_ORDER`, `BRACKETS_OVERLAP`,
 *      `BRACKETS_GAP` e `INVALID_BRACKETS`. As mesmas regras sao re-checadas
 *      server-side — defense in depth (admin-patterns.md §10).
 *
 * Snapshot `before` para o audit log: capturado via `getSettings()` antes
 * da mutacao (config vigente completa). Falha em `getSettings` propaga
 * direto e aborta o save — nao faz sentido auditar mutacao sem snapshot.
 *
 * Audit-by-construction (admin-patterns.md §1): toda a chamada e envolvida
 * por `executeAdminMutation` com:
 *   - `action`: `'FINANCIAL_SETTINGS_UPDATED'`.
 *   - `targetType`: `'financial_settings'`.
 *   - `targetId`: `null` ate a RPC retornar; o wrapper de audit ja gravou
 *     o log inicial neste ponto. O `id` da nova linha so existe apos o
 *     INSERT no servidor — ele entra no payload `after`, garantindo
 *     rastreabilidade no audit log mesmo sem `targetId` populado.
 *   - `before`: snapshot completo da config vigente (ou sentinel id=null
 *     em instalacao fresh).
 *   - `after`: payload enviado (`commission_pct`, `commission_brackets`).
 *
 * Erros mapeados via `mapPostgresError`:
 *   - `STALE_VERSION` (admin-patterns.md §3) ⇒ UI mostra toast "Outro
 *     admin atualizou. Recarregando." e refetch automatico.
 *   - `COMMISSION_PCT_OUT_OF_RANGE`, `BRACKETS_*`, `INVALID_BRACKETS` ⇒
 *     UI sinaliza inline no campo correspondente.
 *   - `PERMISSION_DENIED` (`FINANCEIRO_EDIT` ausente) ⇒ Stealth_404.
 *   - Demais (network, timeout) ⇒ `UNKNOWN`.
 *
 * @param payload Nova configuracao (`commission_pct` + `commission_brackets`).
 * @param expected_updated_at `updated_at` da config vigente lido pela UI
 *        antes do save (ou `null` em instalacao fresh / primeiro save).
 * @returns `FinanceiroSettings` com a nova linha-snapshot recem-criada
 *          (mesmo shape de `getSettings`).
 */
export async function updateSettings(
  payload: UpdateSettingsPayload,
  expected_updated_at: string | null
): Promise<FinanceiroSettings> {
  // 1. Pre-validacao client: commission_pct ∈ [0, 50].
  const pct = Number(payload?.commission_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
    throw new FinanceiroError(
      'COMMISSION_PCT_OUT_OF_RANGE',
      FINANCEIRO_ERROR_MESSAGES.COMMISSION_PCT_OUT_OF_RANGE
    );
  }

  // 2. Pre-validacao client: brackets (defense in depth — re-checado server-side).
  const brackets = Array.isArray(payload?.commission_brackets) ? payload.commission_brackets : [];
  const bracketsCheck = validateBrackets(brackets);
  if (!bracketsCheck.ok) {
    throw new FinanceiroError(
      bracketsCheck.code,
      FINANCEIRO_ERROR_MESSAGES[bracketsCheck.code],
      bracketsCheck.index != null ? { index: bracketsCheck.index } : undefined
    );
  }

  // 3. Snapshot before para o audit log (config vigente completa).
  const previousSettings = await getSettings();

  // 4. Mutacao envolvida por executeAdminMutation (audit-by-construction).
  return executeAdminMutation<FinanceiroSettings>(
    {
      action: 'FINANCIAL_SETTINGS_UPDATED',
      targetType: 'financial_settings',
      targetId: null,
      before: previousSettings,
      after: {
        commission_pct: pct,
        commission_brackets: brackets,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_financeiro_settings_update', {
        p_commission_pct: pct,
        p_commission_brackets: brackets,
        p_expected_updated_at: expected_updated_at,
      });
      if (error) throw mapPostgresError(error);

      // Normaliza retorno como em getSettings (defesa contra numeric-as-string
      // e formatos inesperados).
      const raw = (data ?? {}) as {
        id?: string | null;
        commission_pct?: number | string | null;
        commission_brackets?: unknown;
        effective_from?: string | null;
        updated_at?: string | null;
        updated_by?: string | null;
      };
      const newPct = Number(raw.commission_pct ?? 0);
      return {
        id: raw.id ?? null,
        commission_pct: Number.isFinite(newPct) ? newPct : 0,
        commission_brackets: Array.isArray(raw.commission_brackets)
          ? (raw.commission_brackets as CommissionBracket[])
          : [],
        effective_from: raw.effective_from ?? null,
        updated_at: raw.updated_at ?? null,
        updated_by: raw.updated_by ?? null,
      };
    }
  );
}

/**
 * Faz upload de comprovante de pagamento para o bucket privado
 * `financial_proofs`. Padrao herdado de blacklist.ts (uploadProof).
 *
 * Validacao:
 *  - `repasse_id` deve ser UUID valido (nao vazia mas formato livre por
 *    enquanto — a chamada serah pre-validada no contexto de markAsPaid).
 *  - `validateProofFile(file)` (MIME ∈ {jpeg,png,webp,pdf}, <= 5 MiB).
 *
 * Path layout: `<repasse_id>/<Date.now()>_<sanitizedFilename>`. O timestamp
 * evita colisao em re-tentativas (UPDATE policy permite replace, mas
 * preferimos paths novos para nao perder versoes anteriores no audit).
 *
 * Erros:
 *  - File invalido ⇒ `FinanceiroError('INVALID_INPUT')` com `details.reason`.
 *  - Falha de upload (sem permissao FINANCEIRO_EDIT, network) ⇒ mapeado
 *    via `mapPostgresError` (default UNKNOWN preservando anti-enumeration).
 *
 * @param repasse_id UUID do repasse-alvo. Usado como prefixo do path.
 * @param file       Arquivo do comprovante (PDF/imagem).
 * @returns Path relativo do arquivo no bucket (`<repasse_id>/<filename>`).
 */
export async function uploadProof(repasse_id: string, file: File): Promise<string> {
  if (typeof repasse_id !== 'string' || repasse_id.length === 0) {
    throw new FinanceiroError('INVALID_INPUT', FINANCEIRO_ERROR_MESSAGES.INVALID_INPUT);
  }
  const fileCheck = validateProofFile(file);
  if (!fileCheck.ok) {
    throw new FinanceiroError('INVALID_INPUT', fileCheck.reason, { reason: fileCheck.reason });
  }

  const sanitized = sanitizeProofFilename(file.name);
  const path = `${repasse_id}/${Date.now()}_${sanitized}`;

  const { error } = await supabase.storage.from('financial_proofs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });

  if (error) throw mapPostgresError(error);

  return path;
}

/**
 * Marca um repasse como pago via RPC `admin_repasse_mark_paid` (SECURITY
 * DEFINER, gated por `FINANCEIRO_EDIT`). Materializa CP-2 — idempotencia
 * forte de marcacao de pagamento (design.md §Property: Idempotencia
 * markAsPaid).
 *
 * Pre-validacao client-side antes da RPC (UX rapida + economiza round-trip):
 *   1. `id` deve casar com `UUID_REGEX` — caso contrario `NOT_FOUND`
 *      imediato (Stealth_404 na UI, anti-enumeration).
 *   2. `payment_method` obrigatorio (dominio fechado checado server-side
 *      em `admin_repasse_mark_paid`: pix/ted/boleto/dinheiro/outro).
 *   3. `notes` aceita `null` ou string ate 1000 chars; alem disso vira
 *      `INVALID_INPUT` antes mesmo de chegar ao banco.
 *
 * Audit-by-construction (admin-patterns.md §1): toda a chamada e envolvida
 * por `executeAdminMutation` com:
 *   - `action`: `'FINANCIAL_PAYMENT_MARKED'`.
 *   - `targetType`: `'financial_repasses'`.
 *   - `targetId`: `id`.
 *   - `before`: `{ status: 'pendente' }` (snapshot minimo — o detalhe
 *     completo ja esta na linha pre-mutacao via SELECT FOR UPDATE da RPC).
 *   - `after`: payload enviado (`status='pago'` + metadados).
 *
 * Idempotencia CP-2 (design.md §Property: Idempotencia + admin-patterns.md §4):
 * Quando o repasse ja esta em `status='pago'`, a RPC NAO muta — apenas
 * grava `FINANCIAL_PAYMENT_MARKED_SKIPPED` no audit log autoritativo
 * (dentro da propria RPC) e retorna `{skipped:true, reason:'ALREADY_PAID'}`.
 * Para N chamadas com mesmo payload, exatamente 1 grava
 * `FINANCIAL_PAYMENT_MARKED` e (N-1) gravam `_SKIPPED` — paridade
 * verificada por property test em 4.7.
 *
 * Erros mapeados via `mapPostgresError`:
 *   - `NOT_FOUND` (UUID invalido localmente ou repasse inexistente
 *     no servidor) ⇒ Stealth_404.
 *   - `INVALID_STATUS` (tentativa de pagar repasse `estornado`) ⇒ UI
 *     mostra toast neutro e fecha modal.
 *   - `STALE_VERSION` (admin-patterns.md §3) ⇒ UI mostra toast
 *     "Outro admin atualizou. Recarregando." e refetch automatico.
 *   - `PERMISSION_DENIED` (`FINANCEIRO_EDIT` ausente) ⇒ Stealth_404
 *     (a RPC ja gravou `FINANCIAL_VIEW_DENIED` no audit log).
 *   - `INVALID_INPUT` (payment_method ausente, notes > 1000 chars,
 *     proof_path > 500 chars) ⇒ UI sinaliza inline.
 *   - Demais (network, timeout) ⇒ `UNKNOWN`.
 *
 * @param id      UUID do repasse a marcar como pago.
 * @param payload Metodo de pagamento, comprovante (path no bucket),
 *                notas opcionais e `expected_updated_at` lido pela UI.
 * @returns       `{ok, id, updated_at, paid_at}` em mutacao real ou
 *                `{skipped:true, reason:'ALREADY_PAID'}` em idempotencia.
 */
export async function markAsPaid(id: string, payload: MarkAsPaidPayload): Promise<MutationResult> {
  // 1. Pre-validacao client.
  if (!UUID_REGEX.test(id)) {
    throw new FinanceiroError('NOT_FOUND', FINANCEIRO_ERROR_MESSAGES.NOT_FOUND);
  }
  if (!payload?.payment_method) {
    throw new FinanceiroError('INVALID_INPUT', FINANCEIRO_ERROR_MESSAGES.INVALID_INPUT);
  }
  if (payload.notes != null && payload.notes.length > 1000) {
    throw new FinanceiroError('INVALID_INPUT', 'Notas excedem 1000 caracteres.');
  }

  // 2. Mutacao envolvida por executeAdminMutation.
  return executeAdminMutation<MutationResult>(
    {
      action: 'FINANCIAL_PAYMENT_MARKED',
      targetType: 'financial_repasses',
      targetId: id,
      before: { status: 'pendente' },
      after: {
        status: 'pago',
        payment_method: payload.payment_method,
        payment_proof_url: payload.payment_proof_url,
        notes: payload.notes,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_repasse_mark_paid', {
        p_id: id,
        p_method: payload.payment_method,
        p_proof_path: payload.payment_proof_url,
        p_notes: payload.notes,
        p_expected_updated_at: payload.expected_updated_at,
      });
      if (error) throw mapPostgresError(error);

      const raw = (data ?? {}) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: 'ALREADY_PAID' | 'ALREADY_REVERTED';
        id?: string;
        updated_at?: string;
        paid_at?: string;
      };

      if (raw.skipped) {
        return { skipped: true, reason: raw.reason ?? 'ALREADY_PAID' };
      }
      return {
        ok: true,
        id: raw.id ?? id,
        updated_at: raw.updated_at ?? '',
        paid_at: raw.paid_at,
      };
    }
  );
}

/**
 * Estorna um repasse pago via RPC `admin_repasse_estornar` (SECURITY
 * DEFINER, gated por `FINANCEIRO_EDIT`). Operacao reversa de pagamento:
 * leva `status='pago'` para `status='estornado'` preservando o snapshot
 * historico do pagamento (paid_at, paid_by, payment_method,
 * payment_proof_url, notes ficam intactos como evidencia).
 *
 * Pre-validacao client-side antes da RPC:
 *   1. `id` deve casar com `UUID_REGEX` — caso contrario `NOT_FOUND`
 *      imediato (Stealth_404 na UI).
 *   2. `revert_reason` apos `trim()` deve ter 1..500 chars. Motivo so
 *      com whitespace e tratado como vazio. Mesmas regras re-checadas
 *      server-side (defense in depth — admin-patterns.md §10).
 *
 * Audit-by-construction (admin-patterns.md §1): toda a chamada e envolvida
 * por `executeAdminMutation` com:
 *   - `action`: `'FINANCIAL_PAYMENT_REVERTED'`.
 *   - `targetType`: `'financial_repasses'`.
 *   - `targetId`: `id`.
 *   - `before`: `{ status: 'pago' }`.
 *   - `after`: `{ status: 'estornado', revert_reason: <trim>}`.
 *
 * Idempotencia (admin-patterns.md §4): quando o repasse ja esta em
 * `status='estornado'`, a RPC NAO muta — apenas grava
 * `FINANCIAL_PAYMENT_REVERTED_SKIPPED` no audit log autoritativo (dentro
 * da propria RPC) e retorna `{skipped:true, reason:'ALREADY_REVERTED'}`.
 * Mesmo padrao CP-2 de `markAsPaid`.
 *
 * Erros mapeados via `mapPostgresError`:
 *   - `NOT_FOUND` (UUID invalido ou repasse inexistente) ⇒ Stealth_404.
 *   - `INVALID_STATUS` (tentativa de estornar repasse `pendente` —
 *     estorno e inversao de pagamento, nao de criacao; UI deve esconder
 *     o botao em pendentes) ⇒ UI mostra toast neutro.
 *   - `STALE_VERSION` (admin-patterns.md §3) ⇒ UI mostra toast
 *     "Outro admin atualizou. Recarregando." e refetch automatico.
 *   - `PERMISSION_DENIED` (`FINANCEIRO_EDIT` ausente) ⇒ Stealth_404
 *     (a RPC ja gravou `FINANCIAL_VIEW_DENIED` no audit log).
 *   - `INVALID_INPUT` (revert_reason fora de 1..500 chars apos trim)
 *     ⇒ UI sinaliza inline no campo.
 *   - Demais (network, timeout) ⇒ `UNKNOWN`.
 *
 * @param id      UUID do repasse a estornar.
 * @param payload Motivo do estorno (1..500 chars apos trim) e
 *                `expected_updated_at` lido pela UI.
 * @returns       `{ok, id, updated_at, reverted_at}` em mutacao real ou
 *                `{skipped:true, reason:'ALREADY_REVERTED'}` em idempotencia.
 */
export async function estornar(id: string, payload: EstornarPayload): Promise<MutationResult> {
  // 1. Pre-validacao client.
  if (!UUID_REGEX.test(id)) {
    throw new FinanceiroError('NOT_FOUND', FINANCEIRO_ERROR_MESSAGES.NOT_FOUND);
  }
  const reason = (payload?.revert_reason ?? '').trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new FinanceiroError(
      'INVALID_INPUT',
      'Motivo do estorno deve ter entre 1 e 500 caracteres.'
    );
  }

  // 2. Mutacao envolvida por executeAdminMutation.
  return executeAdminMutation<MutationResult>(
    {
      action: 'FINANCIAL_PAYMENT_REVERTED',
      targetType: 'financial_repasses',
      targetId: id,
      before: { status: 'pago' },
      after: { status: 'estornado', revert_reason: reason },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_repasse_estornar', {
        p_id: id,
        p_revert_reason: reason,
        p_expected_updated_at: payload.expected_updated_at,
      });
      if (error) throw mapPostgresError(error);

      const raw = (data ?? {}) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: 'ALREADY_PAID' | 'ALREADY_REVERTED';
        id?: string;
        updated_at?: string;
        reverted_at?: string;
      };

      if (raw.skipped) {
        return { skipped: true, reason: raw.reason ?? 'ALREADY_REVERTED' };
      }
      return {
        ok: true,
        id: raw.id ?? id,
        updated_at: raw.updated_at ?? '',
        reverted_at: raw.reverted_at,
      };
    }
  );
}

// ===================== exportRepasseCSV (parte 4.5) =====================

/** Limite hard de linhas no CSV (incluindo cabecalho). Padrao herdado. */
const CSV_LIMIT = 10_000;

/**
 * Cabecalho canonico do CSV de repasses. Ordem fixa para consumo por
 * planilhas externas e ferramentas BI; nao altere sem versionar o consumo
 * downstream.
 */
const CSV_REPASSE_HEADER: readonly string[] = [
  'id',
  'frete_id',
  'embarcador_name',
  'motorista_name',
  'valor_bruto',
  'commission_pct',
  'commission_value',
  'valor_liquido',
  'status',
  'closed_at',
  'paid_at',
  'payment_method',
];

/**
 * Escape RFC 4180: campos que contem `"`, `;`, `\n` ou `\r` sao envolvidos
 * em aspas duplas e cada aspa interna e duplicada. Demais campos passam
 * sem alteracao. Funcao pura — espelha o helper de `dashboard.ts`.
 */
function csvEscape(v: string): string {
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * Formata numero como string pt-BR com 2 casas decimais e virgula como
 * separador decimal (ex: `1234.5` ⇒ `'1234,50'`). Valores `null`,
 * `undefined` ou nao-finitos retornam string vazia. Usado nas colunas
 * monetarias e percentuais do CSV de repasses.
 */
function formatNumberCsvPtBr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return Number(n).toFixed(2).replace('.', ',');
}

/**
 * Exporta a listagem de repasses (com filtros aplicados) como CSV no
 * padrao herdado do painel admin (project-conventions.md §CSV Export):
 *
 *  - **BOM UTF-8** (`\uFEFF`) prefixado para abertura correta no Excel pt-BR.
 *  - Separador `;` (compativel com Excel pt-BR — `,` ja e separador decimal).
 *  - Escape RFC 4180: aspas duplas em campos com `"`, `;`, `\n`, `\r`;
 *    aspa interna duplicada (via {@link csvEscape}).
 *  - Quebra de linha `\r\n`.
 *  - Truncamento em **10000 linhas** incluindo o cabecalho. Quando o
 *    `total` retornado pela RPC excede o limite, o CSV e truncado e o
 *    flag `truncated: true` e gravado no audit log para a UI alertar
 *    o admin (`Exportacao truncada em 10.000 linhas. Refine os filtros
 *    para obter o conjunto completo.`).
 *
 * **Coleta dos dados**: pagina sobre {@link listRepasses} com `pageSize=100`
 * ate atingir `CSV_LIMIT` linhas ou esgotar `total`. O `total` original
 * (antes do truncamento) e ecoado no retorno para que a UI distingue
 * "exportacao completa de N linhas" de "exportacao truncada (N de M)".
 *
 * **Formato pt-BR de numeros**: colunas `valor_bruto`, `commission_pct`,
 * `commission_value`, `valor_liquido` usam `(n).toFixed(2).replace('.', ',')`
 * (2 casas decimais, virgula como separador decimal). `null`/`undefined`
 * viram string vazia. Datas (`closed_at`, `paid_at`) sao exportadas no
 * formato ISO 8601 original (sem reformatar para `dd/MM/yyyy`) para
 * preservar precisao timezone-aware ao reabrir em planilhas.
 *
 * **Filename**: `financeiro_<YYYYMMDD>_<HHmm>.csv` derivado de
 * `new Date().toISOString()` (UTC) — formato compativel com ordenacao
 * lexicografica em listagens de download.
 *
 * **Audit log**: dispara `FINANCIAL_REPASSE_EXPORTED` via
 * {@link logAdminAction} em best-effort — a falha de log NAO bloqueia o
 * download (apenas registra `console.error`). Dados gravados em
 * `after_data`: filtros aplicados, `row_count` exportado, `total`
 * disponivel e `truncated` (apenas quando `true`). Operacao isolada
 * sem mutacao de dados ⇒ nao usa `executeAdminMutation`.
 *
 * **Erros**: erros de RPC (`PERMISSION_DENIED`, `INVALID_PERIOD`,
 * `PERIOD_TOO_LARGE`, `UNKNOWN`) sao propagados pelo {@link listRepasses}
 * subjacente ja como {@link FinanceiroError} — nao ha wrapping
 * adicional aqui.
 *
 * @param filters Filtros aplicados a listagem (mesmo shape de {@link listRepasses}).
 *                Default: {@link DEFAULT_REPASSE_FILTERS}.
 * @returns       `{ csv, filename, total }` — CSV pronto para download como
 *                Blob, nome de arquivo padrao, e `total` original (antes
 *                de truncamento) para mensagem na UI.
 */
export async function exportRepasseCSV(
  filters: RepasseFilters = DEFAULT_REPASSE_FILTERS
): Promise<{ csv: string; filename: string; total: number }> {
  // Loop de paginacao: coleta ate CSV_LIMIT linhas ou esgotar `total`.
  let offset = 0;
  const pageSize = 100;
  const allRows: RepasseRow[] = [];
  let total = 0;
  while (allRows.length < CSV_LIMIT) {
    const result = await listRepasses({ ...filters, limit: pageSize, offset });
    total = result.total;
    allRows.push(...result.items);
    if (result.items.length < pageSize || allRows.length >= total) break;
    offset += pageSize;
  }
  const truncated = allRows.length >= CSV_LIMIT && total > CSV_LIMIT;
  if (truncated) allRows.length = CSV_LIMIT;

  // Monta linhas no formato canonico (header + rows).
  const lines: string[][] = [CSV_REPASSE_HEADER as string[]];
  for (const r of allRows) {
    lines.push([
      r.id ?? '',
      r.frete_id ?? '',
      r.embarcador_name ?? '',
      r.motorista_name ?? '',
      formatNumberCsvPtBr(r.valor_bruto),
      formatNumberCsvPtBr(r.commission_pct),
      formatNumberCsvPtBr(r.commission_value),
      formatNumberCsvPtBr(r.valor_liquido),
      r.status ?? '',
      r.closed_at ?? '',
      r.paid_at ?? '',
      r.payment_method ?? '',
    ]);
  }

  // BOM UTF-8 + escape RFC 4180 + separador `;` + quebra `\r\n`.
  const csv = '\uFEFF' + lines.map((row) => row.map(csvEscape).join(';')).join('\r\n');

  // Filename: financeiro_<YYYYMMDD>_<HHmm>.csv (UTC via toISOString parts).
  const iso = new Date().toISOString(); // 2024-01-15T12:34:56.789Z
  const yyyymmdd = iso.slice(0, 10).replace(/-/g, '');
  const hhmm = iso.slice(11, 16).replace(':', '');
  const filename = `financeiro_${yyyymmdd}_${hhmm}.csv`;

  // Log best-effort: falha NAO bloqueia o download.
  try {
    await logAdminAction({
      action: 'FINANCIAL_REPASSE_EXPORTED',
      targetType: null,
      targetId: null,
      after: {
        filters,
        row_count: allRows.length,
        total,
        truncated: truncated || undefined,
      },
    });
  } catch (e) {
    console.error('[admin/financeiro] FINANCIAL_REPASSE_EXPORTED log failed', e);
  }

  return { csv, filename, total };
}

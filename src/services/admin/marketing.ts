/**
 * admin/marketing.ts
 *
 * Service do modulo Marketing (Meta Ads) do painel admin (admin-marketing 048).
 * Cobre o /admin/marketing: painel de metricas da Meta Marketing API
 * (gasto, impressoes, cliques, CPL, CPC, CTR, conversoes + ranking de
 * criativos) e a configuracao da integracao em /admin/marketing/configuracoes
 * (Access Token via Vault, Ad Account ID, Pixel ID, periodo default,
 * consentimento). Toda leitura passa pela Edge `meta-marketing-read` e toda
 * mutacao por RPC `SECURITY DEFINER`; o token nunca chega ao frontend (CP-7).
 *
 * Esta e a parte 1 do arquivo (task 3.1):
 *   - Tipos publicos exportados (closed-domain types, interfaces de dominio,
 *     modelos de config/metricas).
 *   - Infra de erro: classe MarketingError, tabela de mensagens pt-BR
 *     canonicas e mapMarketingError (idempotente).
 *
 * As partes seguintes virao no mesmo arquivo:
 *   - 3.2: helpers puros sincronos (resolvePeriod, computeMetrics,
 *          rankCreatives, maskToken, generateEventId, META_EVENT_MAP).
 *   - 3.3: helpers de PII assincronos via Web Crypto (normalizeEmail,
 *          normalizePhone, isPiiHash, hashPII).
 *   - 4.1: wrappers de mutacao (updateConfig, setToken, clearToken) via
 *          executeAdminMutation.
 *   - 4.2: read wrappers (getConfig via RPC, getMetrics via Edge).
 *
 * Paridade browser/server (formalizada em design.md):
 *   - resolvePeriod, computeMetrics, normalizeEmail/normalizePhone/isPiiHash/
 *     hashPII e META_EVENT_MAP existem em TS puro aqui (alvo dos property
 *     tests) e sao ESPELHADOS na Edge `meta-capi-forward` (Deno). A duplicacao
 *     e intencional para garantir o mesmo comportamento no navegador e no
 *     servidor.
 *
 * Padroes herdados (ver project-conventions.md e admin-patterns.md):
 *   - Audit-by-construction via executeAdminMutation (mutacoes de config/token).
 *   - Versionamento otimista via updated_at + STALE_VERSION.
 *   - Token so no Vault; nunca em coluna legivel, payload, log de cliente ou
 *     erro (CP-7).
 *   - UUID/SHA-256 via Web Crypto API (sem novas dependencias npm).
 *   - Mensagens user-facing pt-BR canonicas, neutras (anti-enumeration).
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

// ===================== Closed-domain types =====================

/**
 * Filtro de periodo do painel de metricas. Dominio fechado.
 *  - today: do inicio do dia local (America/Sao_Paulo) ate o instante atual.
 *  - 7d: ultimos 7 dias.
 *  - 30d: ultimos 30 dias.
 */
export type MetricPeriod = 'today' | '7d' | '30d';

/**
 * Evento de marketing rastreado (Pixel browser + CAPI server). Dominio fechado
 * compartilhado com a coluna `event_name` de `marketing_events` (CHECK SQL) e
 * com o gerador `generateEventId` (CP-4).
 */
export type TrackedEvent =
  | 'page_view'
  | 'lead'
  | 'motorista_registration'
  | 'embarcador_registration'
  | 'frete_published';

// ===================== Interfaces de dominio =====================

/**
 * Intervalo derivado deterministicamente de um MetricPeriod e de um instante
 * de referencia, no timezone America/Sao_Paulo (CP-1). Datas em ISO string,
 * com a invariante `from <= to`.
 */
export interface PeriodRange {
  from: string;
  to: string;
}

/**
 * Metricas brutas agregadas de uma campanha ativa, conforme retornadas pela
 * Meta Marketing API. Invariante de entrada esperada por computeMetrics:
 * `clicks <= impressions` (violacoes sao rejeitadas como INVALID_METRICS).
 */
export interface CampaignMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
}

/**
 * Metricas derivadas por computeMetrics (CP-2), com guardas de divisao por
 * zero:
 *  - ctr: clicks / impressions quando impressions > 0; 0 quando impressions == 0.
 *  - cpc: spend / clicks quando clicks > 0 (0 quando spend == 0 e clicks > 0);
 *         null quando clicks == 0.
 *  - cpl: spend / leads quando leads > 0; null quando leads == 0.
 */
export interface ComputedMetrics {
  ctr: number;
  cpc: number | null;
  cpl: number | null;
}

/**
 * Desempenho por criativo, base para o ranking de melhores/piores (CP-3).
 */
export interface CreativePerformance {
  creative_id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

/**
 * Metrica de ordenacao aceita por rankCreatives. Inclui as derivadas
 * (ctr/cpc/cpl) alem das brutas.
 */
export type RankMetric = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpl' | 'leads';

/**
 * Direcao de ordenacao do ranking. `desc` coloca o maior valor primeiro
 * (melhor desempenho), `asc` coloca o menor primeiro.
 */
export type RankDirection = 'asc' | 'desc';

// ===================== Modelos TS (frontend) =====================

/**
 * Configuracao vigente da integracao Meta, retornada por getConfig (RPC
 * marketing_config_get). O Access Token NUNCA aparece em texto claro (CP-7):
 * apenas `token_is_set` (indicador) e `token_last4` (Masked_Token) sao
 * expostos.
 */
export interface MarketingConfig {
  ad_account_id: string | null;
  pixel_id: string | null;
  default_period: MetricPeriod;
  consent_required: boolean;
  token_is_set: boolean;
  token_last4: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Resultado de getMetrics (Edge meta-marketing-read). Agrega as metricas da
 * campanha (brutas + derivadas), a lista de criativos (cada um com suas
 * derivadas) e a serie temporal para o grafico SVG. `stale` + `fetched_at`
 * comunicam a idade dos dados (cache fallback — Req 7.4/7.5).
 */
export interface MetricsResult {
  period: MetricPeriod;
  range: PeriodRange;
  campaign: CampaignMetrics & ComputedMetrics;
  creatives: (CreativePerformance & ComputedMetrics)[];
  series: { date: string; spend: number; impressions: number; clicks: number }[];
  stale: boolean;
  fetched_at: string;
}

// ===================== Erro tipado =====================

/**
 * Codigos canonicos de erro do service. Cada codigo mapeia para uma mensagem
 * user-facing pt-BR em MARKETING_ERROR_MESSAGES. Espelha o §Error Handling do
 * design (codigos canonicos TS).
 */
export type MarketingErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'INVALID_PERIOD'
  | 'INVALID_AD_ACCOUNT_ID'
  | 'INVALID_PIXEL_ID'
  | 'INVALID_METRICS'
  | 'TOKEN_NOT_CONFIGURED'
  | 'META_API_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

/**
 * Erro canonico do service (espelha FinanceiroError). Toda funcao publica que
 * falha lanca esta classe com um `code` ∈ MarketingErrorCode + `details`
 * opcional para contexto.
 *
 * `details.original` preserva o erro de origem (RPC/Edge) para debug. Como o
 * token nunca sai do servidor (CP-7), o original nao carrega segredos; ainda
 * assim, NUNCA inclua o Meta_Access_Token nem PII em claro em `details`.
 *
 * A UI traduz `code` em mensagem pt-BR canonica via
 * MARKETING_ERROR_MESSAGES[err.code].
 */
export class MarketingError extends Error {
  readonly code: MarketingErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: MarketingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MarketingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Tabela canonica de mensagens user-facing pt-BR para cada MarketingErrorCode.
 * UI consome isto via `MARKETING_ERROR_MESSAGES[err.code]` antes de exibir
 * toast/inline. Mensagens sao curtas, neutras e sem revelar detalhes internos
 * (anti-enumeration policy do projeto).
 */
export const MARKETING_ERROR_MESSAGES: Record<MarketingErrorCode, string> = {
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta area.',
  STALE_VERSION: 'Outro admin atualizou a configuracao. Recarregando.',
  INVALID_PERIOD: 'Periodo invalido.',
  INVALID_AD_ACCOUNT_ID: 'Ad Account ID invalido. Use o formato act_<numeros>.',
  INVALID_PIXEL_ID: 'Pixel ID invalido. Use somente numeros.',
  INVALID_METRICS: 'Metricas invalidas recebidas da Meta.',
  TOKEN_NOT_CONFIGURED: 'Integracao nao configurada. Configure o token de acesso.',
  META_API_UNAVAILABLE: 'Nao foi possivel obter as metricas agora. Tente novamente.',
  INVALID_INPUT: 'Dados invalidos. Verifique os campos preenchidos.',
  UNKNOWN: 'Nao foi possivel concluir a operacao. Tente novamente.',
};

/**
 * Conjunto de codigos validos, usado para casar diretamente erros estruturados
 * vindos das Edge Functions (ex: `{ error: 'TOKEN_NOT_CONFIGURED' }`,
 * `{ error: 'META_API_UNAVAILABLE', status }`).
 */
const MARKETING_ERROR_CODES: ReadonlySet<string> = new Set<MarketingErrorCode>([
  'PERMISSION_DENIED',
  'STALE_VERSION',
  'INVALID_PERIOD',
  'INVALID_AD_ACCOUNT_ID',
  'INVALID_PIXEL_ID',
  'INVALID_METRICS',
  'TOKEN_NOT_CONFIGURED',
  'META_API_UNAVAILABLE',
  'INVALID_INPUT',
  'UNKNOWN',
]);

/**
 * Mapeia um erro arbitrario (RPC Postgres, Edge Function, rejeicao de Promise)
 * para um `MarketingError` tipado, com `code` ∈ MarketingErrorCode e mensagem
 * user-facing canonica em pt-BR (via MARKETING_ERROR_MESSAGES).
 *
 * Espelha a tabela do design (§Error Handling — Mapeamento Postgres/Edge ↔ TS):
 *   ERRCODE 42501 / substring `permission_denied`   ⇒ PERMISSION_DENIED
 *   substring `STALE_VERSION` (ERRCODE P0001)         ⇒ STALE_VERSION
 *   substring `INVALID_PERIOD`                        ⇒ INVALID_PERIOD
 *   substring `INVALID_AD_ACCOUNT_ID`/`INVALID_PIXEL_ID` ⇒ respectivos
 *   Edge `{ error: 'TOKEN_NOT_CONFIGURED' }`          ⇒ TOKEN_NOT_CONFIGURED
 *   Edge `{ error: 'META_API_UNAVAILABLE', status }`  ⇒ META_API_UNAVAILABLE
 *   Edge `{ error: 'INVALID_METRICS' }`               ⇒ INVALID_METRICS
 *   default                                           ⇒ UNKNOWN
 *
 * Estrategia de matching (ordem importa — mais especifico primeiro):
 *  1. Idempotencia: se ja for MarketingError, retorna inalterado (permite
 *     re-throw interno sem duplicar o wrap).
 *  2. Leitura defensiva de `code`/`message`/`error` (estruturado da Edge).
 *  3. Codigo estruturado da Edge que case exatamente com um MarketingErrorCode
 *     ⇒ mapeado diretamente.
 *  4. PERMISSION_DENIED: ERRCODE 42501 ou substring `permission_denied`
 *     (case-insensitive).
 *  5. Substrings especificas (Postgres RAISE EXCEPTION) antes do catch-all.
 *  6. Default ⇒ UNKNOWN.
 *
 * O erro original e preservado em `details.original` para debug, sem expor
 * segredos (o token nunca trafega em erros — CP-7).
 *
 * @param err Erro arbitrario vindo de RPC, Edge ou rejeicao de Promise.
 * @returns `MarketingError` com `code` mapeado, mensagem canonica e
 *          `details: { original }`.
 */
export function mapMarketingError(err: unknown): MarketingError {
  // 1. Idempotencia: nao re-embrulha erro ja tipado.
  if (err instanceof MarketingError) return err;

  // 2. Leitura defensiva de code/message/error.
  const e = (err ?? {}) as { code?: unknown; message?: unknown; error?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  const structured = typeof e.error === 'string' ? e.error : '';
  const haystack = `${message} ${structured}`;
  const lower = haystack.toLowerCase();

  // Helper: constroi o erro com mensagem canonica + original em details.
  const wrap = (mapped: MarketingErrorCode): MarketingError =>
    new MarketingError(mapped, MARKETING_ERROR_MESSAGES[mapped], { original: err });

  // 3. Codigo estruturado da Edge que case exatamente com um MarketingErrorCode.
  if (structured && MARKETING_ERROR_CODES.has(structured)) {
    return wrap(structured as MarketingErrorCode);
  }

  // 4. PERMISSION_DENIED: ERRCODE 42501 ou substring case-insensitive.
  if (code === '42501' || lower.includes('permission_denied')) {
    return wrap('PERMISSION_DENIED');
  }
  // 5. STALE_VERSION (versionamento otimista — admin-patterns.md §3, ERRCODE P0001).
  if (haystack.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  // 6. Validacoes especificas antes dos catch-alls.
  if (haystack.includes('INVALID_AD_ACCOUNT_ID')) return wrap('INVALID_AD_ACCOUNT_ID');
  if (haystack.includes('INVALID_PIXEL_ID')) return wrap('INVALID_PIXEL_ID');
  if (haystack.includes('INVALID_PERIOD')) return wrap('INVALID_PERIOD');
  if (haystack.includes('INVALID_METRICS')) return wrap('INVALID_METRICS');
  if (haystack.includes('TOKEN_NOT_CONFIGURED')) return wrap('TOKEN_NOT_CONFIGURED');
  if (haystack.includes('META_API_UNAVAILABLE')) return wrap('META_API_UNAVAILABLE');
  // 7. INVALID_INPUT (catch-all de validacao generica).
  if (haystack.includes('INVALID_INPUT')) return wrap('INVALID_INPUT');
  // 8. Default: tudo o mais (network, timeout, erro inesperado) ⇒ UNKNOWN.
  return wrap('UNKNOWN');
}

// ===================== Helpers puros (parte 3.2) =====================
// Funcoes puras/deterministicas, alvo dos property tests (CP-1, CP-2, CP-3,
// CP-4, CP-7) e espelhadas na Edge (Deno) para paridade browser/server.
// Sem dependencias externas; UUID via Web Crypto API.

/** Milissegundos em um dia (24h). */
const MS_PER_DAY = 86_400_000;

/** Timezone fixo do negocio para derivacao de periodos (CP-1). */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Calcula o offset (em ms) do timezone informado no instante dado, definido
 * como `(parede-local-como-UTC) - instante`. Para America/Sao_Paulo (UTC-3) o
 * resultado e -10800000 ms.
 *
 * Estrategia determinista e independente do fuso da maquina host: formata o
 * instante no timezone alvo via Intl.DateTimeFormat, reconstroi a parede local
 * como se fosse UTC (Date.UTC) e subtrai o instante original.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const wall: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') wall[part.type] = Number(part.value);
  }
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  return wallAsUtc - instant.getTime();
}

/**
 * Converte uma parede local (Y/M/D h:m:s) no timezone informado para o instante
 * UTC (epoch ms) correspondente. Refina uma vez para lidar com fronteiras de
 * DST (o offset pode mudar entre o palpite e o instante real).
 */
function zonedWallTimeToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): number {
  const wallAsUtc = Date.UTC(year, monthIndex, day, hour, minute, second);
  const offset = timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  let utc = wallAsUtc - offset;
  const refinedOffset = timeZoneOffsetMs(new Date(utc), timeZone);
  if (refinedOffset !== offset) utc = wallAsUtc - refinedOffset;
  return utc;
}

/**
 * Inicio do dia local (00:00:00.000 em America/Sao_Paulo) que contem o instante
 * de referencia, retornado como epoch ms (UTC). Determinista e independente do
 * fuso da maquina host.
 */
function startOfBusinessDayMs(referenceInstant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(referenceInstant);
  const ymd: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') ymd[part.type] = Number(part.value);
  }
  return zonedWallTimeToUtcMs(ymd.year, ymd.month - 1, ymd.day, 0, 0, 0, BUSINESS_TIME_ZONE);
}

/**
 * resolvePeriod (CP-1): mapeia (period, referenceInstant) para um PeriodRange
 * deterministico no timezone America/Sao_Paulo.
 *
 * Invariantes garantidas:
 *  - Pura/deterministica: mesmo input ⇒ mesmo output (nao le o relogio).
 *  - Independente do fuso da maquina host (usa Intl com timeZone fixo + UTC).
 *  - `to` == referenceInstant normalizado (ISO string em UTC, precisao de ms).
 *  - `from <= to` sempre.
 *  - `today` ⇒ inicio do dia local (America/Sao_Paulo);
 *    `7d` ⇒ `to - 7 dias`; `30d` ⇒ `to - 30 dias`.
 *
 * @throws MarketingError('INVALID_PERIOD') se `period` estiver fora do dominio.
 */
export function resolvePeriod(period: MetricPeriod, referenceInstant: Date): PeriodRange {
  const toMs = referenceInstant.getTime();
  let fromMs: number;
  switch (period) {
    case 'today':
      fromMs = startOfBusinessDayMs(referenceInstant);
      break;
    case '7d':
      fromMs = toMs - 7 * MS_PER_DAY;
      break;
    case '30d':
      fromMs = toMs - 30 * MS_PER_DAY;
      break;
    default:
      // Dominio fechado de MetricPeriod; defesa em runtime contra valor invalido.
      throw new MarketingError('INVALID_PERIOD', MARKETING_ERROR_MESSAGES.INVALID_PERIOD, {
        period,
      });
  }
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

/**
 * computeMetrics (CP-2): deriva ctr/cpc/cpl com guardas de divisao por zero.
 * Funcao pura; nunca lanca por divisao por zero.
 *
 * Regras exatas:
 *  - ctr == clicks / impressions quando impressions > 0; ctr == 0 quando
 *    impressions == 0.
 *  - cpc == spend / clicks quando clicks > 0 (incluindo cpc == 0 quando
 *    spend == 0 e clicks > 0); cpc == null quando clicks == 0.
 *  - cpl == spend / leads quando leads > 0; cpl == null quando leads == 0.
 *
 * @throws MarketingError('INVALID_METRICS') quando clicks > impressions
 *         (evita derivar CTR > 100%).
 */
export function computeMetrics(m: CampaignMetrics): ComputedMetrics {
  if (m.clicks > m.impressions) {
    throw new MarketingError('INVALID_METRICS', MARKETING_ERROR_MESSAGES.INVALID_METRICS, {
      clicks: m.clicks,
      impressions: m.impressions,
    });
  }
  const ctr = m.impressions > 0 ? m.clicks / m.impressions : 0;
  const cpc = m.clicks > 0 ? m.spend / m.clicks : null;
  const cpl = m.leads > 0 ? m.spend / m.leads : null;
  return { ctr, cpc, cpl };
}

/**
 * Extrai o valor de ordenacao de um criativo para a metrica escolhida. Metricas
 * derivadas (ctr/cpc/cpl) sao calculadas via computeMetrics (paridade com CP-2);
 * cpc/cpl podem ser null (denominador zero). Como CreativePerformance nao possui
 * `conversions`, passamos 0 — irrelevante para ctr/cpc/cpl.
 */
function creativeMetricValue(item: CreativePerformance, metric: RankMetric): number | null {
  switch (metric) {
    case 'spend':
      return item.spend;
    case 'impressions':
      return item.impressions;
    case 'clicks':
      return item.clicks;
    case 'leads':
      return item.leads;
    case 'ctr':
    case 'cpc':
    case 'cpl': {
      const derived = computeMetrics({
        spend: item.spend,
        impressions: item.impressions,
        clicks: item.clicks,
        leads: item.leads,
        conversions: 0,
      });
      return metric === 'ctr' ? derived.ctr : metric === 'cpc' ? derived.cpc : derived.cpl;
    }
    default:
      return null;
  }
}

/**
 * rankCreatives (CP-3): ordena Creative_Performance pela metrica/direcao
 * escolhida definindo uma ORDEM TOTAL.
 *
 * Garantias:
 *  - Permutacao da entrada (mesmo multiconjunto; nao perde nem duplica).
 *  - `desc` ⇒ maior valor primeiro (melhor desempenho); `asc` ⇒ menor primeiro.
 *  - Desempate estavel e deterministico por `creative_id` ascendente, SEMPRE
 *    (independe da direcao da metrica).
 *  - Idempotente: rank(rank(x)) == rank(x).
 *
 * Tratamento de null (cpc/cpl com denominador zero): valores null representam
 * "sem dado" e sao posicionados SEMPRE no fim do ranking, independentemente da
 * direcao; entre si desempatam por `creative_id` asc. Essa colocacao e
 * deterministica e preserva a ordem total e a idempotencia.
 */
export function rankCreatives(
  items: CreativePerformance[],
  metric: RankMetric,
  direction: RankDirection
): CreativePerformance[] {
  const directionFactor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = creativeMetricValue(a, metric);
    const vb = creativeMetricValue(b, metric);
    const aIsNull = va === null;
    const bIsNull = vb === null;
    // null ("sem dado") sempre por ultimo, qualquer que seja a direcao.
    if (aIsNull && !bIsNull) return 1;
    if (!aIsNull && bIsNull) return -1;
    if (!aIsNull && !bIsNull) {
      if (va < vb) return -1 * directionFactor;
      if (va > vb) return 1 * directionFactor;
    }
    // Desempate estavel/deterministico por creative_id ascendente.
    if (a.creative_id < b.creative_id) return -1;
    if (a.creative_id > b.creative_id) return 1;
    return 0;
  });
}

/**
 * maskToken (CP-7): expoe apenas os ultimos 4 caracteres do token; o restante e
 * mascarado com `*`. Nunca revela mais que os ultimos 4 chars (para tokens com
 * 4 ou menos caracteres, o proprio valor e o seu "ultimos 4"). String vazia ⇒
 * string vazia.
 */
export function maskToken(token: string): string {
  const visibleCount = Math.min(4, token.length);
  const maskedCount = token.length - visibleCount;
  return '*'.repeat(maskedCount) + token.slice(maskedCount);
}

/**
 * generateEventId (CP-4): gera um UUID v4 para uma ocorrencia de Tracked_Event,
 * compartilhado entre Pixel (browser) e CAPI (server) para deduplicacao na Meta.
 * Usa a Web Crypto API (sem dependencias npm; browser-safe).
 */
export function generateEventId(): string {
  return crypto.randomUUID();
}

/**
 * META_EVENT_MAP (Req 8.5): mapeia cada Tracked_Event para o evento padrao da
 * Meta. `frete_published` usa `CustomizeProduct` (evento de conteudo, decisao
 * D6 do design).
 */
export const META_EVENT_MAP: Record<TrackedEvent, string> = {
  page_view: 'PageView',
  lead: 'Lead',
  motorista_registration: 'Lead',
  embarcador_registration: 'Lead',
  frete_published: 'CustomizeProduct',
};

// ===================== Helpers de PII (parte 3.3) =====================
// Helpers de normalizacao e hashing de dados pessoais (PII) para a Meta CAPI
// (CP-6). Sao puros/deterministicos (normalize*) ou deterministicos via Web
// Crypto (hashPII), alvo do property test CP-6 e espelhados na Edge
// `meta-capi-forward` (Deno) para paridade browser/server. Sem dependencias
// npm: o hash usa exclusivamente a Web Crypto API (crypto.subtle).

/** Regex de PII_Hash: SHA-256 em hex minusculo, exatamente 64 caracteres. */
const PII_HASH_REGEX = /^[0-9a-f]{64}$/;

/**
 * normalizeEmail (Req 11.1, CP-6): normaliza um e-mail aplicando trim +
 * lowercase, conforme exigencia da Meta CAPI. Idempotente: normalizar um valor
 * ja normalizado produz o mesmo valor (o resultado nao tem espacos nas bordas
 * nem maiusculas, entao re-aplicar nao muda nada).
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * normalizePhone (Req 11.2, CP-6): normaliza um telefone removendo todos os
 * caracteres nao numericos e mantendo o DDI (os digitos restantes). Idempotente:
 * uma string apenas de digitos permanece inalterada ao ser re-normalizada.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * isPiiHash (Req 11.5, CP-6): indica se `value` ja esta no formato de PII_Hash
 * (SHA-256 em hex minusculo de exatamente 64 caracteres). Usado por hashPII para
 * evitar re-hashear um valor que ja e um hash.
 */
export function isPiiHash(value: string): boolean {
  return PII_HASH_REGEX.test(value);
}

/**
 * hashPII (Req 11.3/11.4/11.5, CP-6): produz o PII_Hash (SHA-256 em hex
 * minusculo de 64 caracteres) do valor normalizado, via Web Crypto API
 * (`crypto.subtle.digest('SHA-256', ...)`). Sem dependencias npm; browser-safe e
 * espelhavel no Deno.
 *
 * Garantias:
 *  - Deterministico: mesmo valor normalizado ⇒ mesmo hash.
 *  - Formato: sempre 64 caracteres hexadecimais minusculos.
 *  - Sem duplo-hash: se `normalized` ja estiver no formato de PII_Hash
 *    (detectado por isPiiHash), e retornado inalterado, evitando re-hashear um
 *    valor que ja e um hash (Req 11.5).
 *
 * Espera-se que o chamador passe o valor JA normalizado (via normalizeEmail /
 * normalizePhone) quando aplicavel.
 */
export async function hashPII(normalized: string): Promise<string> {
  // Sem duplo-hash: valor que ja e um PII_Hash retorna inalterado (Req 11.5).
  if (isPiiHash(normalized)) return normalized;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// ===================== Wrappers de mutacao (parte 4.1) =====================
// updateConfig, setToken, clearToken: mutacoes da config de marketing via RPC
// SECURITY DEFINER, envolvidas por executeAdminMutation (audit-by-construction,
// admin-patterns.md Sec. 1). Erros das RPCs sao mapeados por mapMarketingError
// (STALE_VERSION/PERMISSION_DENIED/INVALID_* propagados tipados). O token bruto
// NUNCA aparece no audit log nem no retorno (CP-7).

/**
 * Payload de atualizacao da config de marketing (full-config-update). Espelha
 * os parametros da RPC marketing_config_update; o token e tratado a parte por
 * setToken/clearToken (nunca trafega aqui).
 *
 *  - ad_account_id: `act_<digits>` ou null (limpa o campo). Validado server-side
 *    (INVALID_AD_ACCOUNT_ID).
 *  - pixel_id: somente digitos ou null (limpa o campo). Validado server-side
 *    (INVALID_PIXEL_ID).
 *  - default_period: periodo default do painel (dominio fechado MetricPeriod).
 *  - consent_required: flag LGPD.
 */
export interface UpdateMarketingConfigPayload {
  ad_account_id: string | null;
  pixel_id: string | null;
  default_period: MetricPeriod;
  consent_required: boolean;
}

/**
 * Coage um valor arbitrario para MetricPeriod (dominio fechado), caindo no
 * default '7d' quando fora do dominio. Defesa contra payloads inesperados da
 * RPC (a coluna ja tem CHECK, isto e profundidade).
 */
function coerceMetricPeriod(value: unknown): MetricPeriod {
  return value === 'today' || value === '7d' || value === '30d' ? value : '7d';
}

/**
 * Mapeia o jsonb retornado pelas RPCs de config (marketing_config_get /
 * marketing_config_update) para o modelo TS MarketingConfig. Leitura defensiva:
 * o token NUNCA aparece (somente token_is_set + token_last4 — CP-7).
 */
function mapMarketingConfigRow(raw: unknown): MarketingConfig {
  const r = (raw ?? {}) as {
    ad_account_id?: string | null;
    pixel_id?: string | null;
    default_period?: unknown;
    consent_required?: unknown;
    token_is_set?: unknown;
    token_last4?: string | null;
    updated_at?: string | null;
    updated_by?: string | null;
  };
  return {
    ad_account_id: r.ad_account_id ?? null,
    pixel_id: r.pixel_id ?? null,
    default_period: coerceMetricPeriod(r.default_period),
    consent_required: typeof r.consent_required === 'boolean' ? r.consent_required : true,
    token_is_set: r.token_is_set === true,
    token_last4: r.token_last4 ?? null,
    updated_at: r.updated_at ?? null,
    updated_by: r.updated_by ?? null,
  };
}

/**
 * Le a config vigente via RPC marketing_config_get e mapeia para MarketingConfig.
 * Helper interno usado pelos wrappers de mutacao para compor o snapshot `before`
 * do audit e para devolver um MarketingConfig completo apos setToken/clearToken
 * (cujas RPCs retornam apenas { token_is_set, token_last4 }). Evita a
 * forward-dependency em getConfig (task 4.2), que podera reusar este helper.
 *
 * Erros da RPC (PERMISSION_DENIED etc.) sao mapeados por mapMarketingError.
 */
async function fetchMarketingConfig(): Promise<MarketingConfig> {
  const { data, error } = await supabase.rpc('marketing_config_get');
  if (error) throw mapMarketingError(error);
  return mapMarketingConfigRow(data);
}

/**
 * Ultimos (no maximo) 4 caracteres do token — metadado nao sensivel usado no
 * audit log e como Masked_Token. Espelha `right(p_token, 4)` da RPC
 * marketing_token_set. NUNCA expoe mais que os 4 ultimos chars (CP-7).
 */
function tokenLast4(token: string): string {
  return token.slice(-4);
}

/**
 * updateConfig (Req 3.4, 3.11, 12.1): atualiza a linha singleton de
 * marketing_config via RPC marketing_config_update, envolvida por
 * executeAdminMutation (action MARKETING_CONFIG_UPDATED, targetType
 * marketing_config).
 *
 * Audit-by-construction (admin-patterns.md Sec. 1):
 *  - before: snapshot da config vigente (campos nao sensiveis; sem token).
 *  - after: payload enviado (ad_account_id, pixel_id, default_period,
 *    consent_required).
 *
 * Versionamento otimista (admin-patterns.md Sec. 3): `expectedUpdatedAt` e
 * comparado server-side; mismatch ⇒ STALE_VERSION (propagado tipado via
 * mapMarketingError). `null` relaxa o check (instalacao fresh / primeiro save).
 *
 * Validacoes server-side (act_<digits>, pixel numerico, periodo no dominio)
 * chegam como INVALID_AD_ACCOUNT_ID / INVALID_PIXEL_ID / INVALID_PERIOD.
 *
 * @param payload Nova config (sem token — ver setToken/clearToken).
 * @param expectedUpdatedAt `updated_at` lido pela UI antes do save (ou null).
 * @returns A config atualizada (mesma forma de getConfig; Masked_Token, CP-7).
 */
export async function updateConfig(
  payload: UpdateMarketingConfigPayload,
  expectedUpdatedAt: string | null
): Promise<MarketingConfig> {
  // Snapshot before (config vigente, sem token) para o audit log.
  const previous = await fetchMarketingConfig();

  return executeAdminMutation<MarketingConfig>(
    {
      action: 'MARKETING_CONFIG_UPDATED',
      targetType: 'marketing_config',
      targetId: null,
      before: {
        ad_account_id: previous.ad_account_id,
        pixel_id: previous.pixel_id,
        default_period: previous.default_period,
        consent_required: previous.consent_required,
      },
      after: {
        ad_account_id: payload.ad_account_id,
        pixel_id: payload.pixel_id,
        default_period: payload.default_period,
        consent_required: payload.consent_required,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('marketing_config_update', {
        p_ad_account_id: payload.ad_account_id,
        p_pixel_id: payload.pixel_id,
        p_default_period: payload.default_period,
        p_consent_required: payload.consent_required,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapMarketingError(error);
      return mapMarketingConfigRow(data);
    }
  );
}

/**
 * setToken (Req 3.5, 3.6, 3.11, 12.1, CP-7): grava o Meta_Access_Token via RPC
 * marketing_token_set, envolvida por executeAdminMutation (action
 * MARKETING_TOKEN_UPDATED, targetType marketing_config).
 *
 * CP-7 (critico): o `before`/`after` do audit log registram SOMENTE metadados
 * nao sensiveis — `is_set` (boolean) e `last4` (ultimos 4 chars). O valor bruto
 * do token NUNCA entra no audit, no retorno ou em log de cliente. A RPC grava o
 * segredo apenas no Vault.
 *
 * Token em branco ('') em um save que NAO e remocao preserva o segredo vigente
 * (Req 3.7, tratado server-side) — por isso o snapshot `after` reflete o estado
 * vigente nesse caso.
 *
 * Versionamento otimista via `expectedUpdatedAt` (mismatch ⇒ STALE_VERSION
 * propagado tipado). Como a RPC retorna apenas { token_is_set, token_last4 },
 * relemos a config completa para devolver um MarketingConfig.
 *
 * @param token O Access Token bruto (vai apenas para o Vault, server-side).
 * @param expectedUpdatedAt `updated_at` lido pela UI antes do save (ou null).
 * @returns A config atualizada (Masked_Token: token_is_set + token_last4, CP-7).
 */
export async function setToken(
  token: string,
  expectedUpdatedAt: string | null
): Promise<MarketingConfig> {
  // Snapshot before (apenas metadados nao sensiveis — CP-7).
  const previous = await fetchMarketingConfig();
  // `after` otimista: token nao vazio ⇒ is_set=true + novos last4; token vazio
  // (preserva, Req 3.7) ⇒ mantem o estado vigente. NUNCA o valor bruto (CP-7).
  const hasToken = token.length > 0;
  const afterIsSet = hasToken ? true : previous.token_is_set;
  const afterLast4 = hasToken ? tokenLast4(token) : previous.token_last4;

  return executeAdminMutation<MarketingConfig>(
    {
      action: 'MARKETING_TOKEN_UPDATED',
      targetType: 'marketing_config',
      targetId: null,
      before: { is_set: previous.token_is_set, last4: previous.token_last4 },
      after: { is_set: afterIsSet, last4: afterLast4 },
    },
    async () => {
      const { error } = await supabase.rpc('marketing_token_set', {
        p_token: token,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapMarketingError(error);
      // RPC retorna apenas { token_is_set, token_last4 }; relemos a config
      // completa para devolver um MarketingConfig (sem forward-dependency 4.2).
      return fetchMarketingConfig();
    }
  );
}

/**
 * clearToken (Req 3.6, 3.11, 12.1, CP-7): remove o Meta_Access_Token via RPC
 * marketing_token_clear, envolvida por executeAdminMutation (action
 * MARKETING_TOKEN_CLEARED, targetType marketing_config).
 *
 * CP-7 (critico): o `before`/`after` registram SOMENTE `is_set`/`last4`
 * (metadados nao sensiveis). O `after` representa o estado limpo
 * (is_set=false, last4=null). O valor bruto do token NUNCA aparece.
 *
 * Idempotente server-side (limpar quando ja vazio nao falha). Versionamento
 * otimista via `expectedUpdatedAt` (mismatch ⇒ STALE_VERSION propagado tipado).
 * A RPC retorna apenas { token_is_set:false, token_last4:null }; relemos a
 * config completa para devolver um MarketingConfig.
 *
 * @param expectedUpdatedAt `updated_at` lido pela UI antes da remocao (ou null).
 * @returns A config atualizada com o token removido (Masked_Token, CP-7).
 */
export async function clearToken(expectedUpdatedAt: string | null): Promise<MarketingConfig> {
  // Snapshot before (apenas metadados nao sensiveis — CP-7).
  const previous = await fetchMarketingConfig();

  return executeAdminMutation<MarketingConfig>(
    {
      action: 'MARKETING_TOKEN_CLEARED',
      targetType: 'marketing_config',
      targetId: null,
      before: { is_set: previous.token_is_set, last4: previous.token_last4 },
      after: { is_set: false, last4: null },
    },
    async () => {
      const { error } = await supabase.rpc('marketing_token_clear', {
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapMarketingError(error);
      // RPC retorna apenas { token_is_set:false, token_last4:null }; relemos a
      // config completa para devolver um MarketingConfig.
      return fetchMarketingConfig();
    }
  );
}

// ===================== Read wrappers (parte 4.2) =====================
// getConfig (RPC marketing_config_get) e getMetrics (Edge meta-marketing-read):
// as duas leituras do service. getConfig e um wrapper fino sobre o helper
// interno fetchMarketingConfig (definido em 4.1) — reuso, sem duplicar o
// mapeamento. getMetrics passa EXCLUSIVAMENTE pela Edge meta-marketing-read
// via supabase.functions.invoke: nenhuma chamada direta a Meta e nenhuma
// referencia ao token em texto claro no frontend (Req 12.3, CP-7). Erros
// estruturados da Edge sao traduzidos por mapMarketingError; o sucesso vira um
// MetricsResult com `stale` + `fetched_at`.

/**
 * getConfig (Req 3.3, 12.3, CP-7): le a configuracao vigente da integracao Meta
 * via RPC marketing_config_get e devolve um MarketingConfig. Wrapper fino sobre
 * o helper interno fetchMarketingConfig (task 4.1) — reusa mapMarketingConfigRow,
 * sem duplicar o mapeamento.
 *
 * O retorno expoe apenas `token_is_set` (indicador) e `token_last4`
 * (Masked_Token); o Access Token bruto NUNCA chega ao frontend (CP-7), pois a
 * propria RPC nao o retorna. Erros (PERMISSION_DENIED etc.) sao mapeados por
 * mapMarketingError dentro de fetchMarketingConfig.
 *
 * @returns A config vigente (Masked_Token: token_is_set + token_last4, CP-7).
 */
export async function getConfig(): Promise<MarketingConfig> {
  return fetchMarketingConfig();
}

/**
 * Forma (defensiva) da resposta da Edge meta-marketing-read. Espelha o contrato
 * do design (§Edge Function meta-marketing-read):
 *  - sucesso: { ok:true, period, range, campaign, creatives, series, stale,
 *    fetched_at };
 *  - erro: { ok:false, error: <codigo>, status?, stale? }.
 * Todos os campos sao opcionais aqui porque o mapeamento e defensivo (confia no
 * contrato, mas nao assume presenca rigida). NUNCA inclui token (CP-7).
 */
interface MetaMarketingReadResponse {
  ok?: boolean;
  error?: string;
  status?: number;
  stale?: boolean;
  period?: string;
  range?: { from?: unknown; to?: unknown };
  campaign?: Record<string, unknown>;
  creatives?: unknown[];
  series?: unknown[];
  fetched_at?: string;
}

/** Coage um valor arbitrario para number finito (default 0). */
function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Coage um valor arbitrario para number finito ou null (denominador zero). */
function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Coage um valor arbitrario para string (default ''). */
function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coage um valor para MetricPeriod, com fallback no periodo solicitado. */
function coercePeriodOrFallback(value: unknown, fallback: MetricPeriod): MetricPeriod {
  return value === 'today' || value === '7d' || value === '30d' ? value : fallback;
}

/** Mapeia o intervalo {from,to} da resposta da Edge para PeriodRange. */
function mapPeriodRange(raw: unknown): PeriodRange {
  const r = (raw ?? {}) as { from?: unknown; to?: unknown };
  return { from: toStringValue(r.from), to: toStringValue(r.to) };
}

/** Mapeia o agregado de campanha (brutas + derivadas) da resposta da Edge. */
function mapCampaign(raw: unknown): CampaignMetrics & ComputedMetrics {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    spend: toFiniteNumber(c.spend),
    impressions: toFiniteNumber(c.impressions),
    clicks: toFiniteNumber(c.clicks),
    leads: toFiniteNumber(c.leads),
    conversions: toFiniteNumber(c.conversions),
    ctr: toFiniteNumber(c.ctr),
    cpc: toNullableNumber(c.cpc),
    cpl: toNullableNumber(c.cpl),
  };
}

/** Mapeia um criativo (Creative_Performance + derivadas) da resposta da Edge. */
function mapCreative(raw: unknown): CreativePerformance & ComputedMetrics {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    creative_id: toStringValue(c.creative_id),
    name: toStringValue(c.name),
    spend: toFiniteNumber(c.spend),
    impressions: toFiniteNumber(c.impressions),
    clicks: toFiniteNumber(c.clicks),
    leads: toFiniteNumber(c.leads),
    ctr: toFiniteNumber(c.ctr),
    cpc: toNullableNumber(c.cpc),
    cpl: toNullableNumber(c.cpl),
  };
}

/** Mapeia um ponto da serie temporal (grafico SVG) da resposta da Edge. */
function mapSeriesPoint(raw: unknown): {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
} {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    date: toStringValue(s.date),
    spend: toFiniteNumber(s.spend),
    impressions: toFiniteNumber(s.impressions),
    clicks: toFiniteNumber(s.clicks),
  };
}

/**
 * Mapeia a resposta de sucesso da Edge meta-marketing-read para MetricsResult.
 * Mapeamento defensivo (coage tipos, tolera campos ausentes) mas fiel ao
 * contrato do design. `period` prefere o valor da resposta, caindo no periodo
 * solicitado se invalido. NUNCA referencia token (CP-7).
 */
function mapMetricsResult(
  body: MetaMarketingReadResponse,
  requestedPeriod: MetricPeriod
): MetricsResult {
  return {
    period: coercePeriodOrFallback(body.period, requestedPeriod),
    range: mapPeriodRange(body.range),
    campaign: mapCampaign(body.campaign),
    creatives: Array.isArray(body.creatives) ? body.creatives.map(mapCreative) : [],
    series: Array.isArray(body.series) ? body.series.map(mapSeriesPoint) : [],
    stale: body.stale === true,
    fetched_at: toStringValue(body.fetched_at),
  };
}

/**
 * Extrai o corpo JSON estruturado de um erro de invocacao (FunctionsHttpError),
 * cuja Response fica em `error.context` no supabase-js v2. Permite recuperar o
 * `{ ok:false, error:'<codigo>' }` que a Edge envia em respostas non-2xx, para
 * mapear o codigo canonico em vez de cair no UNKNOWN generico.
 *
 * Defensivo: se `context` nao for uma Response legivel (ou o corpo nao for JSON),
 * retorna null e o chamador cai no mapeamento generico do proprio erro. NUNCA
 * trafega token (CP-7) — a Edge nunca o inclui no corpo de erro.
 */
async function extractEdgeErrorBody(error: unknown): Promise<{ error?: unknown } | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (
    context &&
    typeof context === 'object' &&
    typeof (context as { json?: unknown }).json === 'function'
  ) {
    try {
      return (await (context as { json: () => Promise<unknown> }).json()) as {
        error?: unknown;
      };
    } catch {
      // Corpo nao-JSON ou ja consumido: cai no mapeamento generico do erro.
      return null;
    }
  }
  return null;
}

/**
 * getMetrics (Req 3.3, 4.1, 5.3, 5.6, 5.11, 5.12, 7.4, 7.5, 12.3, CP-7): obtem
 * as metricas da Meta Marketing API EXCLUSIVAMENTE via Edge meta-marketing-read
 * (`supabase.functions.invoke`). O frontend NUNCA chama a Meta diretamente nem
 * referencia o Access Token em texto claro — a Edge (server-side) le o token do
 * Vault e devolve apenas dados agregados (CP-7, Req 12.3).
 *
 * Tratamento de resposta:
 *  - Erro estruturado no corpo (`{ ok:false }` ou `{ error }`): o codigo
 *    canonico (TOKEN_NOT_CONFIGURED / META_API_UNAVAILABLE / INVALID_PERIOD /
 *    INVALID_METRICS / PERMISSION_DENIED) e traduzido por mapMarketingError e
 *    lancado como MarketingError.
 *  - Erro de invocacao (FunctionsHttpError non-2xx): tenta extrair o corpo
 *    estruturado da Response (`error.context`) para mapear o codigo; senao
 *    mapeia o proprio erro (⇒ UNKNOWN/PERMISSION_DENIED conforme o caso).
 *  - Sucesso (`ok:true`): mapeado para MetricsResult, incluindo `stale` +
 *    `fetched_at` (fallback de cache — Req 7.4/7.5).
 *
 * @param period Filtro de periodo do painel (dominio fechado MetricPeriod).
 * @returns MetricsResult agregado (campanha + criativos + serie + stale).
 * @throws MarketingError com `code` mapeado do erro estruturado da Edge.
 */
export async function getMetrics(period: MetricPeriod): Promise<MetricsResult> {
  const { data, error } = await supabase.functions.invoke('meta-marketing-read', {
    body: { period },
  });

  const body = (data ?? null) as MetaMarketingReadResponse | null;

  // 1. Erro estruturado no corpo (Edge respondeu com ok:false / error no body).
  if (body && (body.ok === false || typeof body.error === 'string')) {
    throw mapMarketingError({ error: body.error });
  }

  // 2. Erro de invocacao (non-2xx FunctionsHttpError): tenta o corpo estruturado.
  if (error) {
    const errorBody = await extractEdgeErrorBody(error);
    if (errorBody && typeof errorBody.error === 'string') {
      throw mapMarketingError({ error: errorBody.error });
    }
    throw mapMarketingError(error);
  }

  // 3. Sucesso esperado (ok:true). Defesa: corpo ausente/inesperado ⇒ UNKNOWN.
  if (!body || body.ok !== true) {
    throw mapMarketingError({ error: 'UNKNOWN' });
  }

  return mapMetricsResult(body, period);
}

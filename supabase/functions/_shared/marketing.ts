/**
 * _shared/marketing.ts (Deno / Edge Functions)
 *
 * Helpers de dominio do modulo Marketing (Meta Ads) ESPELHADOS server-side para
 * as Edge Functions `meta-marketing-read` (task 6.2) e `meta-capi-forward`
 * (task 6.3). Este modulo roda no runtime Deno do Supabase Edge.
 *
 * ============================ DUPLICACAO INTENCIONAL ========================
 * A fonte da verdade canonica destes helpers e `src/services/admin/marketing.ts`
 * (TypeScript do browser). Os property-based tests obrigatorios (CP-1, CP-2,
 * CP-6) rodam EXCLUSIVAMENTE contra aquela implementacao TS — este arquivo NAO
 * e testado por PBT diretamente.
 *
 * A duplicacao e DELIBERADA (decisao D3 do design.md): os helpers puros precisam
 * existir tanto no navegador (Pixel + UI) quanto no servidor (Edge chamando a
 * Meta Marketing API / CAPI), e o runtime Deno nao pode importar do bundle do
 * frontend (`src/`) nem vice-versa. Mantemos PARIDADE EXATA byte-a-byte da
 * logica: qualquer alteracao em `src/services/admin/marketing.ts` nestes helpers
 * DEVE ser replicada aqui (e o contrario), garantindo o mesmo comportamento
 * browser/server (mesmas janelas de periodo, mesmas metricas derivadas, mesmo
 * hashing de PII, mesmo mapeamento de eventos Meta).
 *
 * Funcoes espelhadas a partir da impl TS:
 *   - resolvePeriod (CP-1)            — janela de periodo determinista (TZ SP).
 *   - computeMetrics (CP-2)           — ctr/cpc/cpl com guardas de div/0.
 *   - normalizeEmail / normalizePhone — normalizacao de PII (CP-6).
 *   - isPiiHash / hashPII (CP-6)      — SHA-256 hex; sem duplo-hash.
 *   - META_EVENT_MAP (Req 8.5)        — Tracked_Event -> evento padrao da Meta.
 *
 * Validacoes de dominio (server-side, usadas pelas Edges para rejeitar input):
 *   - isMetricPeriod  — period ∈ {today,7d,30d}.
 *   - isTrackedEvent  — event_name ∈ dominio fechado de Tracked_Event.
 *   - isUuidV4        — event_id e um UUID v4 valido (CP-4 / dedup Meta).
 *
 * Sem dependencias npm/externas: usa apenas Web APIs globais disponiveis no
 * Deno (crypto.subtle, Intl.DateTimeFormat, TextEncoder, Date).
 *
 * Requirements: 4.5, 4.10, 11.1, 11.2, 11.3.
 */

// ===================== Closed-domain types =====================

/** Filtro de periodo do painel (dominio fechado). Espelha MetricPeriod (TS). */
export type MetricPeriod = 'today' | '7d' | '30d';

/** Evento de marketing rastreado (dominio fechado). Espelha TrackedEvent (TS). */
export type TrackedEvent =
  | 'page_view'
  | 'lead'
  | 'motorista_registration'
  | 'embarcador_registration'
  | 'frete_published';

/** Intervalo derivado por resolvePeriod (ISO strings, invariante `from <= to`). */
export interface PeriodRange {
  from: string;
  to: string;
}

/** Metricas brutas agregadas de uma campanha (entrada de computeMetrics). */
export interface CampaignMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
}

/** Metricas derivadas por computeMetrics (CP-2), com guardas de div/0. */
export interface ComputedMetrics {
  ctr: number;
  cpc: number | null;
  cpl: number | null;
}

// ===================== Erro tipado (espelhado) =====================

/**
 * Codigos canonicos de erro usados pelos helpers espelhados. Subconjunto do
 * MarketingErrorCode da impl TS — aqui ficam apenas os codigos que estes
 * helpers de dominio podem lancar. As Edges convertem `err.code` em respostas
 * estruturadas (ex: `{ error: 'INVALID_PERIOD' }`).
 */
export type MarketingErrorCode = 'INVALID_PERIOD' | 'INVALID_METRICS';

/**
 * Mensagens user-facing pt-BR canonicas, identicas a MARKETING_ERROR_MESSAGES
 * da impl TS (paridade). Mantidas aqui para que MarketingError carregue a mesma
 * mensagem nos dois ambientes.
 */
const MARKETING_ERROR_MESSAGES: Record<MarketingErrorCode, string> = {
  INVALID_PERIOD: 'Periodo invalido.',
  INVALID_METRICS: 'Metricas invalidas recebidas da Meta.',
};

/**
 * Erro canonico do dominio Marketing (espelha a classe MarketingError do TS).
 * `details.original` preserva contexto para debug; NUNCA inclua Meta_Access_Token
 * nem PII em claro em `details` (CP-7).
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

// ===================== resolvePeriod (CP-1) =====================
// Espelha src/services/admin/marketing.ts. Determinista e independente do fuso
// da maquina host (usa Intl com timeZone fixo + aritmetica em UTC).

/** Milissegundos em um dia (24h). */
const MS_PER_DAY = 86_400_000;

/** Timezone fixo do negocio para derivacao de periodos (CP-1). */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Offset (em ms) do timezone informado no instante dado, definido como
 * `(parede-local-como-UTC) - instante`. Para America/Sao_Paulo (UTC-3) o
 * resultado e -10800000 ms.
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
 * UTC (epoch ms) correspondente. Refina uma vez para lidar com fronteiras de DST.
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
 * de referencia, retornado como epoch ms (UTC).
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
 * Invariantes (identicas a impl TS):
 *  - Pura/deterministica: mesmo input ⇒ mesmo output (nao le o relogio).
 *  - Independente do fuso da maquina host (Intl com timeZone fixo + UTC).
 *  - `to` == referenceInstant normalizado (ISO em UTC, precisao de ms).
 *  - `from <= to` sempre.
 *  - `today` ⇒ inicio do dia local (SP); `7d` ⇒ `to - 7 dias`;
 *    `30d` ⇒ `to - 30 dias`.
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

// ===================== computeMetrics (CP-2) =====================

/**
 * computeMetrics (CP-2): deriva ctr/cpc/cpl com guardas de divisao por zero.
 * Funcao pura; nunca lanca por divisao por zero. Espelha a impl TS.
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

// ===================== Helpers de PII (CP-6) =====================
// Espelham src/services/admin/marketing.ts. Hash exclusivamente via Web Crypto
// (crypto.subtle), disponivel globalmente no Deno.

/** Regex de PII_Hash: SHA-256 em hex minusculo, exatamente 64 caracteres. */
const PII_HASH_REGEX = /^[0-9a-f]{64}$/;

/**
 * normalizeEmail (Req 11.1, CP-6): trim + lowercase. Idempotente: normalizar um
 * valor ja normalizado produz o mesmo valor.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * normalizePhone (Req 11.2, CP-6): remove todos os caracteres nao numericos,
 * mantendo o DDI (digitos restantes). Idempotente.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * isPiiHash (Req 11.5, CP-6): indica se `value` ja esta no formato de PII_Hash
 * (SHA-256 em hex minusculo de exatamente 64 caracteres).
 */
export function isPiiHash(value: string): boolean {
  return PII_HASH_REGEX.test(value);
}

/**
 * hashPII (Req 11.3/11.4/11.5, CP-6): produz o PII_Hash (SHA-256 em hex
 * minusculo de 64 caracteres) do valor normalizado, via Web Crypto API. Espelha
 * a impl TS.
 *
 * Garantias:
 *  - Deterministico: mesmo valor normalizado ⇒ mesmo hash.
 *  - Formato: sempre 64 caracteres hexadecimais minusculos.
 *  - Sem duplo-hash: se `normalized` ja for um PII_Hash (isPiiHash), retorna
 *    inalterado (Req 11.5).
 *
 * Espera-se que o chamador passe o valor JA normalizado (normalizeEmail /
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

// ===================== META_EVENT_MAP (Req 8.5) =====================

/**
 * META_EVENT_MAP (Req 8.5): mapeia cada Tracked_Event para o evento padrao da
 * Meta. `frete_published` usa `CustomizeProduct` (decisao D6). Espelha a impl TS.
 */
export const META_EVENT_MAP: Record<TrackedEvent, string> = {
  page_view: 'PageView',
  lead: 'Lead',
  motorista_registration: 'Lead',
  embarcador_registration: 'Lead',
  frete_published: 'CustomizeProduct',
};

// ===================== Validacoes de dominio (server-side) =====================
// Usadas pelas Edges para rejeitar input antes de qualquer chamada a Meta. Os
// dominios fechados sao identicos aos types/CHECKs SQL e aos types TS.

/** Conjunto fechado de periodos validos (espelha o CHECK de period_key/SQL). */
const METRIC_PERIODS: ReadonlySet<string> = new Set<MetricPeriod>(['today', '7d', '30d']);

/** Conjunto fechado de eventos rastreados (espelha o CHECK de event_name/SQL). */
const TRACKED_EVENTS: ReadonlySet<string> = new Set<TrackedEvent>([
  'page_view',
  'lead',
  'motorista_registration',
  'embarcador_registration',
  'frete_published',
]);

/**
 * UUID v4 (RFC 4122): 8-4-4-4-12 hex, com o digito de versao `4` e o digito de
 * variante em {8,9,a,b}. Case-insensitive (crypto.randomUUID emite minusculo).
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * isMetricPeriod: type guard de dominio para `period`. Edge `meta-marketing-read`
 * rejeita com INVALID_PERIOD quando falso (Req 4.x).
 */
export function isMetricPeriod(value: unknown): value is MetricPeriod {
  return typeof value === 'string' && METRIC_PERIODS.has(value);
}

/**
 * isTrackedEvent: type guard de dominio para `event_name`. Edge `meta-capi-forward`
 * rejeita eventos fora do dominio fechado (Req 9.x).
 */
export function isTrackedEvent(value: unknown): value is TrackedEvent {
  return typeof value === 'string' && TRACKED_EVENTS.has(value);
}

/**
 * isUuidV4: valida que `event_id` e um UUID v4 (gerado por generateEventId no
 * browser via crypto.randomUUID). Edge `meta-capi-forward` rejeita ids invalidos
 * (CP-4 / dedup Meta, Req 9.2).
 */
export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

// ============================================================================
// Edge Function: meta-marketing-read
// ============================================================================
// Spec: .kiro/specs/admin-marketing/{requirements,design,tasks}.md
//   Task 6.2 — Edge `meta-marketing-read` (verify_jwt: true).
//
// Responsabilidade (a UNICA porta de leitura da Meta Marketing API — Req 4.1):
//   1. Caller autenticado: extrai auth.uid() do JWT do admin (injetado por
//      supabase.functions.invoke). Sem user (anonimo / anon key) => PERMISSION_DENIED
//      (Req 2.7, 4.x).
//   2. RBAC server-side: checa MARKETING_VIEW via is_admin_with_permission usando
//      um cliente Supabase ligado ao JWT do CALLER (nao service-role). Deny =>
//      registra MARKETING_VIEW_DENIED em admin_audit_logs (admin-patterns Sec.1/2)
//      e retorna PERMISSION_DENIED (Req 2.5, 4.3, 4.4).
//   3. Valida period ∈ {today,7d,30d}; fora => INVALID_PERIOD (Req 4.6).
//   4. Le o Meta_Access_Token do Vault (cliente service-role). Ausente =>
//      TOKEN_NOT_CONFIGURED, sem chamar a Meta (Req 4.7). O token NUNCA sai
//      desta function (CP-7).
//   5. resolvePeriod(period, now) => {from,to} (CP-1, helper espelhado em
//      ../_shared/marketing.ts).
//   6. Cache: marketing_cache_read (RPC service-role). Snapshot fresco =>
//      retorna { stale:false } sem chamar a Meta (Req 7.3).
//   7. Senao chama a Meta Marketing API com o range; valida clicks <= impressions
//      por registro (senao INVALID_METRICS, Req 4.10); agrega Campaign_Metrics +
//      Creative_Performance + series; deriva ctr/cpc/cpl via computeMetrics (CP-2);
//      grava o snapshot via marketing_cache_write (Req 7.2).
//   8. Meta indisponivel: se ha snapshot (mesmo stale), retorna { stale:true,
//      fetched_at } (Req 7.4); sem snapshot => META_API_UNAVAILABLE com o status
//      de origem (Req 4.8).
//
// CP-7 (token nunca vaza): o Meta_Access_Token e lido do Vault e usado apenas
//   no header Authorization da chamada a Meta (NUNCA na URL/query). Nenhuma
//   resposta, log ou erro inclui o token; erros de Meta carregam apenas o status
//   HTTP de origem, nunca o corpo nem a URL.
//
// Contrato de resposta (espelha src/services/admin/marketing.ts getMetrics):
//   sucesso: { ok:true, period, range:{from,to}, campaign, creatives, series,
//             stale, fetched_at }
//   erro:    { ok:false, error:<CODE>, status? }   (CODE ∈ TOKEN_NOT_CONFIGURED |
//             META_API_UNAVAILABLE | INVALID_PERIOD | INVALID_METRICS |
//             PERMISSION_DENIED)
//
// Deploy (verify_jwt = TRUE — exige JWT; o gateway Supabase valida o JWT e esta
//   function ainda confirma MARKETING_VIEW server-side; NAO usar --no-verify-jwt):
//   supabase functions deploy meta-marketing-read
//
// Env vars necessarias:
//   SUPABASE_URL                 (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-injetado) — le config + Vault + cache
//   SUPABASE_ANON_KEY            (auto-injetado) — cliente ligado ao JWT do caller
//   META_GRAPH_API_VERSION       (opcional, default v21.0)
//   MARKETING_CACHE_MAX_AGE_SECONDS (opcional, default 300 = janela de frescor)
//
// NOTA DE DEPLOY (Vault): a leitura de vault.decrypted_secrets via service-role
//   exige que o schema `vault` esteja exposto ao Data API (mesmo requisito da
//   Edge assistant-ai). O segredo e gravado pela RPC marketing_token_set sob o
//   nome estavel 'meta_access_token' (migration 048).
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  resolvePeriod,
  computeMetrics,
  isMetricPeriod,
  MarketingError,
  type MetricPeriod,
  type CampaignMetrics,
  type CreativePerformance,
  type ComputedMetrics,
  type PeriodRange,
} from '../_shared/marketing.ts';

// ===================== Env + helpers de I/O ================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v21.0';

/**
 * Janela de frescor do cache (Req 7.3). Snapshot com idade <= esta janela e
 * servido direto, sem chamar a Meta. Default 300s (5 min) — "quase tempo real"
 * sem estourar limites de taxa da Meta. Configuravel por env var.
 */
const CACHE_MAX_AGE_SECONDS = (() => {
  const raw = Number(Deno.env.get('MARKETING_CACHE_MAX_AGE_SECONDS'));
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 300;
})();

/** Nome estavel do segredo do Meta_Access_Token no Vault (migration 048). */
const META_TOKEN_SECRET_NAME = 'meta_access_token';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Codigos de erro estruturados retornados ao frontend (espelha getMetrics). */
type ReadErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_PERIOD'
  | 'TOKEN_NOT_CONFIGURED'
  | 'INVALID_METRICS'
  | 'META_API_UNAVAILABLE';

/**
 * Resposta de erro estruturada (sem segredos — CP-7). `status` (opcional)
 * carrega APENAS o status HTTP de origem da Meta em META_API_UNAVAILABLE.
 */
function errorResponse(code: ReadErrorCode, httpStatus: number, originStatus?: number): Response {
  const body: { ok: false; error: ReadErrorCode; status?: number } = { ok: false, error: code };
  if (typeof originStatus === 'number') body.status = originStatus;
  return json(body, httpStatus);
}

// ===================== Erro de indisponibilidade da Meta ===================

/**
 * Erro de indisponibilidade da Meta Marketing API (rede, timeout, HTTP nao-OK).
 * Carrega APENAS o status HTTP de origem (nunca corpo/URL/token — CP-7). E
 * tratado a parte de MarketingError('INVALID_METRICS'): este aciona o fallback
 * stale (Req 7.4); aquele rejeita os dados como invalidos (Req 4.10).
 */
class MetaUnavailableError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`meta_unavailable_${status}`);
    this.name = 'MetaUnavailableError';
    this.status = status;
  }
}

// ===================== Auth: identidade + RBAC do caller ===================

/**
 * Extrai o JWT do header Authorization (formato `Bearer <jwt>`). Retorna '' se
 * ausente/malformado.
 */
function extractJwt(authHeader: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

/**
 * Resolve o auth.uid() do caller validando o JWT no servidor de auth. Retorna
 * o id do usuario autenticado, ou null para anonimo / anon key / JWT invalido
 * (Req 2.7). Cliente ligado ao JWT do caller (nao service-role).
 */
async function resolveCallerId(callerClient: SupabaseClient, jwt: string): Promise<string | null> {
  try {
    const { data, error } = await callerClient.auth.getUser(jwt);
    if (error) return null;
    const id = data?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Checa MARKETING_VIEW via is_admin_with_permission usando o cliente ligado ao
 * JWT do caller (auth.uid() dentro da RPC resolve para o caller — RBAC
 * server-side, admin-patterns Sec. 2). Qualquer falha => false (deny-by-default).
 */
async function callerHasMarketingView(callerClient: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await callerClient.rpc('is_admin_with_permission', {
      p_action: 'MARKETING_VIEW',
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Registra o log negativo MARKETING_VIEW_DENIED (before=NULL, after={user_id,
 * reason}) via service-role (bypassa RLS), espelhando o path negativo das RPCs
 * gated (admin-patterns Sec. 1/2). Best-effort: falha de log nao altera a
 * resposta PERMISSION_DENIED.
 */
async function logMarketingViewDenied(
  serviceClient: SupabaseClient,
  callerId: string
): Promise<void> {
  try {
    await serviceClient.from('admin_audit_logs').insert({
      admin_id: callerId,
      action: 'MARKETING_VIEW_DENIED',
      target_type: null,
      target_id: null,
      before_data: null,
      after_data: { user_id: callerId, reason: 'permission_denied', source: 'meta-marketing-read' },
    });
  } catch {
    // best-effort: nunca quebra o fluxo de deny.
  }
}

// ===================== Config + Vault (service-role) =======================

/** Forma minima da config lida server-side para a leitura de metricas. */
interface MarketingConfigRow {
  ad_account_id: string | null;
  token_secret_id: string | null;
}

/**
 * Le a linha singleton de marketing_config via service-role (bypassa a policy
 * no_dml). Retorna apenas o necessario: ad_account_id (para consultar a Meta e
 * o cache) e token_secret_id (referencia ao segredo no Vault). NUNCA le o valor
 * bruto do token aqui.
 */
async function readMarketingConfig(serviceClient: SupabaseClient): Promise<MarketingConfigRow> {
  try {
    const { data } = await serviceClient
      .from('marketing_config')
      .select('ad_account_id, token_secret_id')
      .eq('singleton', true)
      .maybeSingle();
    return {
      ad_account_id: (data?.ad_account_id as string | null) ?? null,
      token_secret_id: (data?.token_secret_id as string | null) ?? null,
    };
  } catch {
    return { ad_account_id: null, token_secret_id: null };
  }
}

/**
 * Le o Meta_Access_Token do Vault server-side, com duas camadas (espelha o
 * padrao da Edge assistant-ai):
 *   1. Caminho direto via `.schema('vault').from('decrypted_secrets')`. So
 *      funciona quando o schema `vault` esta exposto ao Data API
 *      (Settings > API > Exposed schemas). Tenta primeiro pelo
 *      `tokenSecretId`; senao pelo nome estavel `meta_access_token`.
 *   2. Fallback via RPC `public.marketing_token_read_secret(uuid)`
 *      (SECURITY DEFINER, GRANT EXECUTE TO service_role). Le o Vault
 *      internamente sem expor o schema; usa o `tokenSecretId` da config.
 * Retorna null quando ausente => TOKEN_NOT_CONFIGURED (Req 4.7). NUNCA loga
 * nem retorna o valor bruto (CP-7).
 */
async function readMetaToken(
  serviceClient: SupabaseClient,
  tokenSecretId: string | null
): Promise<string | null> {
  // ---------- Caminho 1.a: por id (mais preciso) ----------
  if (tokenSecretId) {
    try {
      const { data, error } = await serviceClient
        .schema('vault')
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('id', tokenSecretId)
        .limit(1)
        .maybeSingle();
      if (!error) {
        const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
        if (typeof secret === 'string' && secret.length > 0) return secret;
      }
    } catch {
      // cai para 1.b
    }
  }

  // ---------- Caminho 1.b: pelo nome estavel ----------
  try {
    const { data, error } = await serviceClient
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', META_TOKEN_SECRET_NAME)
      .limit(1)
      .maybeSingle();
    if (!error) {
      const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof secret === 'string' && secret.length > 0) return secret;
    }
  } catch {
    // cai para fallback por RPC
  }

  // ---------- Caminho 2 (fallback): RPC public.marketing_token_read_secret ----------
  // Funciona mesmo quando o schema `vault` nao esta exposto ao Data API.
  if (tokenSecretId) {
    try {
      const { data, error } = await serviceClient.rpc('marketing_token_read_secret', {
        p_secret_id: tokenSecretId,
      });
      if (error) return null;
      return typeof data === 'string' && data.length > 0 ? data : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ===================== Cache (RPCs service-role) ===========================

/** Resultado de marketing_cache_read: { snapshot, fetched_at, stale } ou null. */
interface CacheReadResult {
  snapshot: MetricsSnapshot;
  fetched_at: string;
  stale: boolean;
}

/**
 * Le o snapshot mais recente do cache via RPC marketing_cache_read (server-only,
 * GRANT service_role). Retorna null em "sem cache" (NONE) ou em erro (tratado
 * como cache miss — a Edge segue para a Meta).
 */
async function cacheRead(
  serviceClient: SupabaseClient,
  adAccountId: string,
  period: MetricPeriod
): Promise<CacheReadResult | null> {
  try {
    const { data, error } = await serviceClient.rpc('marketing_cache_read', {
      p_ad_account_id: adAccountId,
      p_period_key: period,
      p_max_age_seconds: CACHE_MAX_AGE_SECONDS,
    });
    if (error || data == null) return null;
    const row = data as { snapshot?: unknown; fetched_at?: unknown; stale?: unknown };
    if (row.snapshot == null) return null;
    return {
      snapshot: row.snapshot as MetricsSnapshot,
      fetched_at: typeof row.fetched_at === 'string' ? row.fetched_at : new Date().toISOString(),
      stale: row.stale === true,
    };
  } catch {
    return null;
  }
}

/**
 * Grava um novo snapshot no cache via RPC marketing_cache_write (server-only).
 * Best-effort: falha de escrita nao quebra a leitura (devolvemos um fetched_at
 * corrente para a resposta). Retorna o fetched_at gravado.
 */
async function cacheWrite(
  serviceClient: SupabaseClient,
  adAccountId: string,
  period: MetricPeriod,
  snapshot: MetricsSnapshot
): Promise<string> {
  try {
    const { data, error } = await serviceClient.rpc('marketing_cache_write', {
      p_ad_account_id: adAccountId,
      p_period_key: period,
      p_snapshot: snapshot,
    });
    if (!error) {
      const fetchedAt = (data as { fetched_at?: unknown } | null)?.fetched_at;
      if (typeof fetchedAt === 'string') return fetchedAt;
    }
  } catch {
    // best-effort
  }
  return new Date().toISOString();
}

// ===================== Meta Marketing API ==================================

/** Tipos derivados das métricas agregadas (campanha + criativos). */
type Campaign = CampaignMetrics & ComputedMetrics;
type Creative = CreativePerformance & ComputedMetrics;
interface SeriesPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Snapshot persistido no cache e devolvido (spread) na resposta. Forma exata
 * consumida por mapMetricsResult no frontend.
 */
interface MetricsSnapshot {
  campaign: Campaign;
  creatives: Creative[];
  series: SeriesPoint[];
}

/**
 * Action types da Meta contados como "lead" (Req 5/6 — leads do funil). Conjunto
 * documentado para o MVP; novos tipos podem ser adicionados sem mudar o fluxo.
 */
const LEAD_ACTION_TYPES: ReadonlySet<string> = new Set([
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
]);

/**
 * Action types contados como "conversao" (inclui leads + registros + compras).
 * Documentado para o MVP; agregacao simples por soma dos valores.
 */
const CONVERSION_ACTION_TYPES: ReadonlySet<string> = new Set([
  ...LEAD_ACTION_TYPES,
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'submit_application',
]);

/** Coage um campo numerico da Meta (string|number) para number finito (>=0). */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Soma os valores das `actions` da Meta cujos action_type pertencem ao conjunto
 * informado. `actions` ausente/invalido => 0.
 */
function sumActions(actions: unknown, types: ReadonlySet<string>): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (a && typeof a === 'object') {
      const t = (a as { action_type?: unknown }).action_type;
      if (typeof t === 'string' && types.has(t)) {
        total += num((a as { value?: unknown }).value);
      }
    }
  }
  return total;
}

/**
 * Formata um instante ISO (UTC) como YYYY-MM-DD no fuso de negocio
 * (America/Sao_Paulo), para o parametro time_range da Meta (datas no fuso da
 * conta). en-CA produz o formato ISO de data.
 */
function toMetaDate(iso: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(new Date(iso));
}

/**
 * Executa um GET de insights na Graph API. O token vai SOMENTE no header
 * Authorization (NUNCA na URL/query — CP-7). Falha de rede/HTTP nao-OK =>
 * MetaUnavailableError(status) (sem corpo/URL/token no erro). Retorna o array
 * `data` parseado.
 */
async function fetchInsights(
  adAccountId: string,
  token: string,
  params: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/insights`
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Erro de rede / DNS / timeout: sem status de origem => 503.
    throw new MetaUnavailableError(503);
  }

  if (!resp.ok) {
    // NUNCA loga corpo (pode conter detalhes do token) nem a URL (sem token,
    // mas evitamos ruido). So o status de origem segue adiante (Req 4.8, CP-7).
    throw new MetaUnavailableError(resp.status);
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    throw new MetaUnavailableError(502);
  }
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null
  );
}

/**
 * Consulta a Meta Marketing API e agrega Campaign_Metrics + Creative_Performance
 * + series para o range informado.
 *
 *  - Criativos: insights level=ad (ad_id/ad_name/spend/impressions/clicks/actions).
 *    Valida clicks <= impressions por registro (senao INVALID_METRICS — Req 4.10).
 *  - Campanha: soma dos criativos; ctr/cpc/cpl via computeMetrics (CP-2).
 *  - Series: insights level=account com time_increment=1 (best-effort: falha
 *    da serie nao derruba a leitura — so o chart fica vazio).
 *
 * @throws MarketingError('INVALID_METRICS') para dados invalidos da Meta.
 * @throws MetaUnavailableError(status) para indisponibilidade (aciona fallback).
 */
async function fetchMetaMetrics(
  adAccountId: string,
  token: string,
  range: PeriodRange
): Promise<MetricsSnapshot> {
  const timeRange = JSON.stringify({ since: toMetaDate(range.from), until: toMetaDate(range.to) });

  // ---- Criativos (level=ad) — chamada primaria (define disponibilidade) ----
  const rows = await fetchInsights(adAccountId, token, {
    level: 'ad',
    fields: 'ad_id,ad_name,spend,impressions,clicks,actions',
    time_range: timeRange,
    limit: '500',
  });

  const creatives: Creative[] = [];
  let aggSpend = 0;
  let aggImpressions = 0;
  let aggClicks = 0;
  let aggLeads = 0;
  let aggConversions = 0;

  for (const row of rows) {
    const spend = num(row?.spend);
    const impressions = num(row?.impressions);
    const clicks = num(row?.clicks);
    const leads = sumActions(row?.actions, LEAD_ACTION_TYPES);
    const conversions = sumActions(row?.actions, CONVERSION_ACTION_TYPES);

    // Req 4.10 / CP-2: rejeita registros com clicks > impressions (CTR > 100%).
    if (clicks > impressions) {
      throw new MarketingError('INVALID_METRICS', 'Metricas invalidas recebidas da Meta.', {
        clicks,
        impressions,
      });
    }

    const derived = computeMetrics({ spend, impressions, clicks, leads, conversions });
    creatives.push({
      creative_id: typeof row?.ad_id === 'string' ? row.ad_id : String(row?.ad_id ?? ''),
      name: typeof row?.ad_name === 'string' ? row.ad_name : '',
      spend,
      impressions,
      clicks,
      leads,
      ctr: derived.ctr,
      cpc: derived.cpc,
      cpl: derived.cpl,
    });

    aggSpend += spend;
    aggImpressions += impressions;
    aggClicks += clicks;
    aggLeads += leads;
    aggConversions += conversions;
  }

  // Campanha agregada + derivadas (computeMetrics tambem guarda clicks<=impressions).
  const aggregate: CampaignMetrics = {
    spend: aggSpend,
    impressions: aggImpressions,
    clicks: aggClicks,
    leads: aggLeads,
    conversions: aggConversions,
  };
  const campaignDerived = computeMetrics(aggregate);
  const campaign: Campaign = { ...aggregate, ...campaignDerived };

  // ---- Series (level=account, time_increment=1) — best-effort ----
  let series: SeriesPoint[] = [];
  try {
    const seriesRows = await fetchInsights(adAccountId, token, {
      level: 'account',
      fields: 'spend,impressions,clicks',
      time_range: timeRange,
      time_increment: '1',
      limit: '90',
    });
    series = seriesRows.map((r) => ({
      date: typeof r?.date_start === 'string' ? r.date_start : '',
      spend: num(r?.spend),
      impressions: num(r?.impressions),
      clicks: num(r?.clicks),
    }));
  } catch {
    // Serie indisponivel: chart vazio, sem derrubar a leitura principal.
    series = [];
  }

  return { campaign, creatives, series };
}

// ===================== Builders de resposta de sucesso =====================

/** Monta a resposta de sucesso (sem token — CP-7). */
function successResponse(
  period: MetricPeriod,
  range: PeriodRange,
  snapshot: MetricsSnapshot,
  stale: boolean,
  fetchedAt: string
): Response {
  return json(
    {
      ok: true,
      period,
      range,
      campaign: snapshot.campaign,
      creatives: snapshot.creatives,
      series: snapshot.series,
      stale,
      fetched_at: fetchedAt,
    },
    200
  );
}

// ===================== Handler =============================================

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    // Config de ambiente ausente — nao expoe detalhe de segredo.
    return json({ ok: false, error: 'SERVER_MISCONFIGURED' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = extractJwt(authHeader);

  // Cliente ligado ao JWT do CALLER (RBAC server-side via auth.uid()).
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  // Cliente service-role (config + Vault + cache + log de denial).
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- 1. Identidade do caller (auth.uid() nulo => PERMISSION_DENIED) ----------
  if (!jwt) {
    return errorResponse('PERMISSION_DENIED', 403);
  }
  const callerId = await resolveCallerId(callerClient, jwt);
  if (!callerId) {
    return errorResponse('PERMISSION_DENIED', 403);
  }

  // ---------- 2. RBAC: MARKETING_VIEW (deny => log + PERMISSION_DENIED) ----------
  const allowed = await callerHasMarketingView(callerClient);
  if (!allowed) {
    await logMarketingViewDenied(serviceClient, callerId);
    return errorResponse('PERMISSION_DENIED', 403);
  }

  // ---------- 3. Validacao do period (dominio fechado) ----------
  let period: unknown;
  try {
    const payload = await req.json();
    period = (payload as { period?: unknown })?.period;
  } catch {
    return errorResponse('INVALID_PERIOD', 400);
  }
  if (!isMetricPeriod(period)) {
    return errorResponse('INVALID_PERIOD', 400);
  }

  // ---------- 4. Config + token do Vault ----------
  const cfg = await readMarketingConfig(serviceClient);
  const token = await readMetaToken(serviceClient, cfg.token_secret_id);
  // Token ausente OU integracao incompleta (sem ad_account_id) => nao chama a Meta.
  if (!token || !cfg.ad_account_id) {
    return errorResponse('TOKEN_NOT_CONFIGURED', 400);
  }
  const adAccountId = cfg.ad_account_id;

  // ---------- 5. resolvePeriod (CP-1) ----------
  const range = resolvePeriod(period, new Date());

  // ---------- 6. Cache fresco => retorna sem chamar a Meta (Req 7.3) ----------
  const cached = await cacheRead(serviceClient, adAccountId, period);
  if (cached && !cached.stale) {
    return successResponse(period, range, cached.snapshot, false, cached.fetched_at);
  }

  // ---------- 7/8. Meta API (com fallback stale e META_API_UNAVAILABLE) ----------
  try {
    const snapshot = await fetchMetaMetrics(adAccountId, token, range);
    const fetchedAt = await cacheWrite(serviceClient, adAccountId, period, snapshot);
    return successResponse(period, range, snapshot, false, fetchedAt);
  } catch (err) {
    // Dados invalidos da Meta (clicks > impressions): rejeita (Req 4.10).
    if (err instanceof MarketingError && err.code === 'INVALID_METRICS') {
      return errorResponse('INVALID_METRICS', 502);
    }
    // Meta indisponivel: se ha snapshot (mesmo stale), serve com stale:true (Req 7.4).
    const originStatus = err instanceof MetaUnavailableError ? err.status : 503;
    if (cached) {
      return successResponse(period, range, cached.snapshot, true, cached.fetched_at);
    }
    // Sem snapshot => META_API_UNAVAILABLE com o status de origem (Req 4.8).
    return errorResponse('META_API_UNAVAILABLE', 503, originStatus);
  }
});

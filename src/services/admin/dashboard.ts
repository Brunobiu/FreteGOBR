/**
 * admin/dashboard.ts
 *
 * Service do Dashboard analitico do painel admin.
 * Wrapper da RPC admin_dashboard_metrics (migration 036) com tipos
 * publicos, helpers puros (URL <-> filtros, formatadores), getMetrics
 * (timeout 10s) e exportCSV (CSV padrao admin + log DASHBOARD_EXPORTED).
 *
 * Nao ha mutacoes de banco; apenas leitura agregada via RPC + log
 * isolado de export via logAdminAction.
 *
 * Padroes herdados:
 *   - CSV BOM UTF-8 + ; + RFC 4180 + truncamento 10000 (admin-users / admin-blacklist)
 *   - Stealth_404 quando admin nao tem DASHBOARD_VIEW (delegado ao AdminGuard)
 *   - Degradacao parcial: bundle.errors[bloco] preenchido quando sub-objeto vem null
 */

import { supabase } from '../supabase';
import { logAdminAction } from './audit';

// ===================== Tipos publicos =====================

export type DashboardPeriodPreset = 'today' | '7d' | '30d' | 'custom';
export type DashboardUserType = 'all' | 'motorista' | 'embarcador';

/** UFs brasileiras (mesmo set usado em embarcadores.branch_state na migration 033). */
export const UF_BR = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export type UF = (typeof UF_BR)[number];

export interface DashboardFilters {
  period: DashboardPeriodPreset;
  from: string | null; // YYYY-MM-DD, so usado quando period='custom'
  to: string | null;
  userType: DashboardUserType;
  uf: UF | null;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  period: '7d',
  from: null,
  to: null,
  userType: 'all',
  uf: null,
};

export interface DashboardKPI {
  value: number | null;
  previousValue: number | null;
  deltaPct: number | null; // null quando previous === 0 (evita divisao por zero)
  deltaDirection: 'up' | 'down' | 'flat';
}

export interface DashboardSeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface DashboardGeoBucket {
  uf: UF;
  count: number;
  motoristas?: number;
  embarcadores?: number;
  total?: number;
}

export interface DashboardSecurityAlertRaw {
  action: string;
  count: number;
  lastAt: string;
  sampleTargetId: string | null;
}

export interface DashboardTopListItem {
  id: string;
  name: string;
  primaryValue: number;
  primaryLabel: string;
  secondary?: string;
  link: string;
}

export interface DashboardMetricsBundle {
  meta: {
    from: string;
    to: string;
    userType: DashboardUserType;
    uf: UF | null;
    previousFrom: string;
    previousTo: string;
    days: number;
    generatedAt: string;
  };
  kpis: {
    usuariosAtivos: DashboardKPI;
    novosCadastros: DashboardKPI;
    fretesAtivos: DashboardKPI;
    fretesPostados: DashboardKPI;
    fretesEncerrados: DashboardKPI;
    taxaConversaoPct: DashboardKPI;
    volumeTransacionado: DashboardKPI | null;
    loginsAdmin: DashboardKPI | null;
    alertasSeguranca24h: DashboardKPI | null;
  };
  series: {
    cadastrosMotoristas: DashboardSeriesPoint[];
    cadastrosEmbarcadores: DashboardSeriesPoint[];
    fretesPostados: DashboardSeriesPoint[];
    fretesEncerrados: DashboardSeriesPoint[];
    volumeDiario: DashboardSeriesPoint[] | null;
  };
  geo: {
    fretesAtivos: DashboardGeoBucket[];
    usuariosAtivos: DashboardGeoBucket[];
  };
  securityAlerts: { items: DashboardSecurityAlertRaw[] } | null;
  topEmbarcadores: { items: DashboardTopListItem[] } | null;
  topMotoristas: { items: DashboardTopListItem[] };
  topRotas: { items: DashboardTopListItem[] };
  errors: Partial<Record<DashboardBlockKey, string>>;
}

export type DashboardBlockKey =
  | 'kpis'
  | 'cadastros'
  | 'fretes'
  | 'volume'
  | 'geo'
  | 'security_alerts'
  | 'top_embarcadores'
  | 'top_motoristas'
  | 'top_rotas';

export type DashboardErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_PERIOD'
  | 'INVALID_USER_TYPE'
  | 'INVALID_UF'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNKNOWN';

export class DashboardServiceError extends Error {
  constructor(
    public code: DashboardErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DashboardServiceError';
  }
}

export const DASHBOARD_ERROR_MESSAGES: Record<DashboardErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para acessar o painel.',
  INVALID_PERIOD: 'Período inválido. Selecione no máximo 365 dias.',
  INVALID_USER_TYPE: 'Tipo de usuário inválido.',
  INVALID_UF: 'UF inválida.',
  TIMEOUT: 'A consulta demorou demais. Tente novamente.',
  NETWORK: 'Falha de conexão. Verifique sua internet e tente novamente.',
  UNKNOWN: 'Não foi possível carregar os dados do painel.',
};

// ===================== Helpers puros =====================

/**
 * Resolve filtros para par { from, to } absoluto em ISO 8601 UTC.
 *  - 'today'  → inicio do dia atual UTC .. NOW()
 *  - '7d'     → NOW() - 7d .. NOW()
 *  - '30d'    → NOW() - 30d .. NOW()
 *  - 'custom' → from + 'T00:00:00Z' .. to + 'T23:59:59Z'
 */
export function resolvePeriod(
  f: DashboardFilters,
  now: Date = new Date()
): { from: string; to: string } {
  switch (f.period) {
    case 'today': {
      const from = new Date(now);
      from.setUTCHours(0, 0, 0, 0);
      return { from: from.toISOString(), to: now.toISOString() };
    }
    case '7d': {
      const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      return { from: from.toISOString(), to: now.toISOString() };
    }
    case '30d': {
      const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      return { from: from.toISOString(), to: now.toISOString() };
    }
    case 'custom': {
      if (!f.from || !f.to) {
        throw new DashboardServiceError('INVALID_PERIOD', 'period=custom requer from/to');
      }
      return {
        from: `${f.from}T00:00:00Z`,
        to: `${f.to}T23:59:59Z`,
      };
    }
  }
}

/**
 * Variacao percentual com tratamento de divisao por zero.
 * - previous === 0  → null (UI exibe "Novo" ou "—")
 * - thresholds      → > 0.1% sobe, < -0.1% desce, senao flat
 */
export function computeDelta(
  value: number,
  previous: number
): { deltaPct: number | null; deltaDirection: 'up' | 'down' | 'flat' } {
  if (previous === 0) return { deltaPct: null, deltaDirection: 'flat' };
  const pct = Math.round(((value - previous) / previous) * 1000) / 10;
  const direction: 'up' | 'down' | 'flat' = pct > 0.1 ? 'up' : pct < -0.1 ? 'down' : 'flat';
  return { deltaPct: pct, deltaDirection: direction };
}

export function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function describePeriod(f: DashboardFilters): string {
  switch (f.period) {
    case 'today':
      return 'Hoje';
    case '7d':
      return 'Últimos 7 dias';
    case '30d':
      return 'Últimos 30 dias';
    case 'custom': {
      if (!f.from || !f.to) return 'Customizado';
      return `${formatDate(`${f.from}T00:00:00Z`)} a ${formatDate(`${f.to}T00:00:00Z`)}`;
    }
  }
}

const ALERT_LABELS: Record<string, { label: string; severity: 'info' | 'warn' | 'high' }> = {
  ADMIN_LOGIN_FAILURE: { label: 'Tentativa de login admin falhou', severity: 'high' },
  ADMIN_LOCKOUT: { label: 'Conta admin bloqueada após tentativas', severity: 'high' },
  ADMIN_STEALTH_BLOCK: { label: 'Acesso furtivo bloqueado', severity: 'warn' },
  BLACKLIST_LOGIN_BLOCKED: { label: 'Login bloqueado por blacklist', severity: 'warn' },
  BLACKLIST_SIGNUP_BLOCKED: { label: 'Cadastro bloqueado por blacklist', severity: 'warn' },
  BLACKLIST_EMAIL_BLOCKED: { label: 'E-mail bloqueado por blacklist', severity: 'info' },
  USER_BANNED: { label: 'Usuário banido', severity: 'warn' },
};

export function resolveAlertLabel(action: string): {
  label: string;
  severity: 'info' | 'warn' | 'high';
} {
  return ALERT_LABELS[action] ?? { label: action, severity: 'info' };
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = now.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) {
    return `ontem ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (days < 7) return `há ${days} dias`;
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Centroides aproximados das 27 UFs (latitude, longitude) — usados pelo
 * Dashboard_Geo_Map para posicionar Circles proporcionais.
 */
export const UF_CENTROIDS: Record<UF, [number, number]> = {
  AC: [-9.0238, -70.812],
  AL: [-9.5713, -36.782],
  AP: [1.4138, -51.77],
  AM: [-3.4168, -65.8561],
  BA: [-12.5797, -41.7007],
  CE: [-5.4984, -39.3206],
  DF: [-15.8267, -47.9218],
  ES: [-19.1834, -40.3089],
  GO: [-15.827, -49.836],
  MA: [-5.4209, -45.4347],
  MT: [-12.6819, -56.9211],
  MS: [-20.7722, -54.7852],
  MG: [-18.5122, -44.555],
  PA: [-3.4168, -52.0],
  PB: [-7.2399, -36.7819],
  PR: [-24.4842, -51.8149],
  PE: [-8.8137, -36.9541],
  PI: [-7.7183, -42.7289],
  RJ: [-22.9099, -43.2095],
  RN: [-5.7945, -36.3541],
  RS: [-30.0346, -53.2],
  RO: [-10.83, -63.34],
  RR: [2.7376, -62.0751],
  SC: [-27.2423, -50.2189],
  SP: [-22.19, -48.79],
  SE: [-10.5741, -37.3857],
  TO: [-10.1753, -48.2982],
};

// ===================== URL <-> filtros =====================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(s: string | null): string | null {
  if (s == null || !ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

export function parseFiltersFromQuery(qs: URLSearchParams): DashboardFilters {
  const period = qs.get('period');
  const userType = qs.get('userType');
  const uf = qs.get('uf');

  const validPeriod: DashboardPeriodPreset =
    period === 'today' || period === '7d' || period === '30d' || period === 'custom'
      ? period
      : '7d';
  const validUserType: DashboardUserType =
    userType === 'all' || userType === 'motorista' || userType === 'embarcador' ? userType : 'all';
  const validUf: UF | null = uf && (UF_BR as readonly string[]).includes(uf) ? (uf as UF) : null;

  return {
    period: validPeriod,
    from: validPeriod === 'custom' ? parseIsoDate(qs.get('from')) : null,
    to: validPeriod === 'custom' ? parseIsoDate(qs.get('to')) : null,
    userType: validUserType,
    uf: validUf,
  };
}

export function serializeFiltersToQuery(f: DashboardFilters): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.period !== '7d') qs.set('period', f.period);
  if (f.period === 'custom' && f.from) qs.set('from', f.from);
  if (f.period === 'custom' && f.to) qs.set('to', f.to);
  if (f.userType !== 'all') qs.set('userType', f.userType);
  if (f.uf) qs.set('uf', f.uf);
  return qs;
}

// ===================== getMetrics (RPC wrapper com timeout 10s) =====================

const RPC_TIMEOUT_MS = 10_000;

interface RawKpi {
  value: number | null;
  previous_value: number | null;
}

interface RawSeriesPoint {
  date: string;
  value: number | string;
}

interface RawSecAlert {
  action: string;
  count: number;
  last_at: string;
  sample_target_id: string | null;
}

interface RawTopEmb {
  id: string;
  name: string;
  volume_total: number | string;
  fretes_encerrados: number;
}

interface RawTopMot {
  id: string;
  name: string;
  cliques: number;
  curtidas: number;
  total: number;
}

interface RawTopRot {
  origin: string;
  destination: string;
  label: string;
  count: number;
}

interface RawBundle {
  meta?: {
    from?: string;
    to?: string;
    user_type?: DashboardUserType;
    uf?: UF | null;
    previous_from?: string;
    previous_to?: string;
    days?: number;
    generated_at?: string;
  };
  kpis?: Record<string, RawKpi | null>;
  series?: Record<string, RawSeriesPoint[] | null>;
  geo?: {
    fretes_ativos?: { uf: string; count: number }[];
    usuarios_ativos?: {
      uf: string;
      motoristas: number;
      embarcadores: number;
      total: number;
    }[];
  };
  security_alerts?: { items?: RawSecAlert[] } | null;
  top_embarcadores?: { items?: RawTopEmb[] } | null;
  top_motoristas?: { items?: RawTopMot[] };
  top_rotas?: { items?: RawTopRot[] };
}

function buildKPI(raw: RawKpi | null | undefined): DashboardKPI {
  const value = raw?.value == null ? 0 : Number(raw.value);
  const prev = raw?.previous_value == null ? 0 : Number(raw.previous_value);
  const { deltaPct, deltaDirection } = computeDelta(value, prev);
  return { value, previousValue: prev, deltaPct, deltaDirection };
}

function buildSeries(raw: RawSeriesPoint[] | null | undefined): DashboardSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({ date: String(p.date), value: Number(p.value) }));
}

function adaptBundle(raw: RawBundle | null | undefined): DashboardMetricsBundle {
  const errors: DashboardMetricsBundle['errors'] = {};
  if (!raw || typeof raw !== 'object') {
    // bundle completo invalido; cada bloco vai cair em error
    errors.kpis = 'Bloco indisponível.';
    errors.cadastros = 'Bloco indisponível.';
    errors.fretes = 'Bloco indisponível.';
    errors.geo = 'Bloco indisponível.';
    errors.top_motoristas = 'Bloco indisponível.';
    errors.top_rotas = 'Bloco indisponível.';
  }

  const meta = raw?.meta ?? {};
  const kpisRaw = (raw?.kpis ?? {}) as Record<string, RawKpi | null>;

  if (!raw?.kpis) errors.kpis = 'Bloco indisponível.';

  const kpis: DashboardMetricsBundle['kpis'] = {
    usuariosAtivos: buildKPI(kpisRaw.usuarios_ativos),
    novosCadastros: buildKPI(kpisRaw.novos_cadastros),
    fretesAtivos: buildKPI(kpisRaw.fretes_ativos),
    fretesPostados: buildKPI(kpisRaw.fretes_postados),
    fretesEncerrados: buildKPI(kpisRaw.fretes_encerrados),
    taxaConversaoPct: buildKPI(kpisRaw.taxa_conversao_pct),
    volumeTransacionado:
      kpisRaw.volume_transacionado === null || kpisRaw.volume_transacionado === undefined
        ? null
        : buildKPI(kpisRaw.volume_transacionado),
    loginsAdmin:
      kpisRaw.logins_admin === null || kpisRaw.logins_admin === undefined
        ? null
        : buildKPI(kpisRaw.logins_admin),
    alertasSeguranca24h:
      kpisRaw.alertas_seguranca_24h === null || kpisRaw.alertas_seguranca_24h === undefined
        ? null
        : buildKPI(kpisRaw.alertas_seguranca_24h),
  };

  const seriesRaw = raw?.series ?? {};
  if (!raw?.series) {
    errors.cadastros = 'Bloco indisponível.';
    errors.fretes = 'Bloco indisponível.';
  }
  const series: DashboardMetricsBundle['series'] = {
    cadastrosMotoristas: buildSeries(seriesRaw.cadastros_motoristas),
    cadastrosEmbarcadores: buildSeries(seriesRaw.cadastros_embarcadores),
    fretesPostados: buildSeries(seriesRaw.fretes_postados),
    fretesEncerrados: buildSeries(seriesRaw.fretes_encerrados),
    volumeDiario:
      seriesRaw.volume_diario === null || seriesRaw.volume_diario === undefined
        ? null
        : buildSeries(seriesRaw.volume_diario),
  };

  const geoRaw = raw?.geo;
  if (!geoRaw) errors.geo = 'Bloco indisponível.';
  const geo: DashboardMetricsBundle['geo'] = {
    fretesAtivos: Array.isArray(geoRaw?.fretes_ativos)
      ? geoRaw!.fretes_ativos!.map((g) => ({
          uf: g.uf as UF,
          count: Number(g.count),
        }))
      : [],
    usuariosAtivos: Array.isArray(geoRaw?.usuarios_ativos)
      ? geoRaw!.usuarios_ativos!.map((g) => ({
          uf: g.uf as UF,
          count: Number(g.total ?? 0),
          motoristas: Number(g.motoristas ?? 0),
          embarcadores: Number(g.embarcadores ?? 0),
          total: Number(g.total ?? 0),
        }))
      : [],
  };

  const securityRaw = raw?.security_alerts;
  const securityAlerts: DashboardMetricsBundle['securityAlerts'] =
    securityRaw === null || securityRaw === undefined
      ? null
      : {
          items: Array.isArray(securityRaw.items)
            ? securityRaw.items.map((a) => ({
                action: String(a.action),
                count: Number(a.count),
                lastAt: String(a.last_at),
                sampleTargetId: a.sample_target_id,
              }))
            : [],
        };

  const topEmbRaw = raw?.top_embarcadores;
  const topEmbarcadores: DashboardMetricsBundle['topEmbarcadores'] =
    topEmbRaw === null || topEmbRaw === undefined
      ? null
      : {
          items: Array.isArray(topEmbRaw.items)
            ? topEmbRaw.items.map((i) => ({
                id: i.id,
                name: i.name,
                primaryValue: Number(i.volume_total),
                primaryLabel: formatBRL(Number(i.volume_total)),
                secondary: `${i.fretes_encerrados} frete(s) encerrado(s)`,
                link: `/admin/users/${i.id}`,
              }))
            : [],
        };

  const topMotRaw = raw?.top_motoristas;
  if (!topMotRaw) errors.top_motoristas = 'Bloco indisponível.';
  const topMotoristas: DashboardMetricsBundle['topMotoristas'] = {
    items: Array.isArray(topMotRaw?.items)
      ? topMotRaw!.items!.map((i) => ({
          id: i.id,
          name: i.name,
          primaryValue: Number(i.total),
          primaryLabel: `${i.total} interaç${i.total === 1 ? 'ão' : 'ões'}`,
          secondary: `${i.cliques} cliques • ${i.curtidas} curtidas`,
          link: `/admin/users/${i.id}`,
        }))
      : [],
  };

  const topRotRaw = raw?.top_rotas;
  if (!topRotRaw) errors.top_rotas = 'Bloco indisponível.';
  const topRotas: DashboardMetricsBundle['topRotas'] = {
    items: Array.isArray(topRotRaw?.items)
      ? topRotRaw!.items!.map((i) => ({
          id: `${i.origin}::${i.destination}`,
          name: i.label,
          primaryValue: Number(i.count),
          primaryLabel: `${i.count} frete(s)`,
          link: `/admin/fretes?q=${encodeURIComponent(i.origin)}`,
        }))
      : [],
  };

  return {
    meta: {
      from: String(meta.from ?? ''),
      to: String(meta.to ?? ''),
      userType: (meta.user_type ?? 'all') as DashboardUserType,
      uf: (meta.uf ?? null) as UF | null,
      previousFrom: String(meta.previous_from ?? ''),
      previousTo: String(meta.previous_to ?? ''),
      days: Number(meta.days ?? 0),
      generatedAt: String(meta.generated_at ?? ''),
    },
    kpis,
    series,
    geo,
    securityAlerts,
    topEmbarcadores,
    topMotoristas,
    topRotas,
    errors,
  };
}

function mapPgErrorToCode(error: { message: string; code?: string }): DashboardErrorCode {
  const msg = error?.message ?? '';
  if (msg.includes('permission_denied')) return 'PERMISSION_DENIED';
  if (msg.startsWith('INVALID_PERIOD')) return 'INVALID_PERIOD';
  if (msg.startsWith('INVALID_USER_TYPE')) return 'INVALID_USER_TYPE';
  if (msg.startsWith('INVALID_UF')) return 'INVALID_UF';
  return 'UNKNOWN';
}

/**
 * Chamada a RPC admin_dashboard_metrics com timeout 10s.
 * Mapeia erros Postgres -> DashboardErrorCode tipado.
 */
export async function getMetrics(filters: DashboardFilters): Promise<DashboardMetricsBundle> {
  const { from, to } = resolvePeriod(filters);

  const rpcPromise = supabase.rpc('admin_dashboard_metrics', {
    p_from: from,
    p_to: to,
    p_user_type: filters.userType,
    p_uf: filters.uf,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new DashboardServiceError('TIMEOUT', DASHBOARD_ERROR_MESSAGES.TIMEOUT)),
      RPC_TIMEOUT_MS
    )
  );

  let raw: unknown;
  try {
    const result = (await Promise.race([rpcPromise, timeout])) as Awaited<typeof rpcPromise>;
    if (result.error) {
      const code = mapPgErrorToCode(result.error);
      throw new DashboardServiceError(code, DASHBOARD_ERROR_MESSAGES[code], {
        message: result.error.message,
      });
    }
    raw = result.data;
  } catch (err) {
    if (err instanceof DashboardServiceError) throw err;
    throw new DashboardServiceError(
      'NETWORK',
      (err as Error)?.message ?? DASHBOARD_ERROR_MESSAGES.NETWORK
    );
  }

  return adaptBundle(raw as RawBundle | null);
}

// ===================== exportCSV =====================

const CSV_LIMIT = 10_000;
const CSV_HEADER = ['secao', 'chave', 'valor', 'valor_anterior', 'variacao_pct'];

function csvEscape(v: string): string {
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function pushKPI(lines: string[][], key: string, kpi: DashboardKPI | null): void {
  if (!kpi) return;
  lines.push([
    'KPIs',
    key,
    String(kpi.value ?? ''),
    String(kpi.previousValue ?? ''),
    kpi.deltaPct === null ? '' : String(kpi.deltaPct),
  ]);
}

function pushSeries(lines: string[][], name: string, s: DashboardSeriesPoint[] | null): void {
  if (!s) return;
  for (const p of s) {
    lines.push(['Series', `${name}:${p.date}`, String(p.value), '', '']);
  }
}

/**
 * Gera CSV padrao admin (BOM UTF-8 + ; + RFC 4180 + truncamento 10000)
 * com snapshot dos KPIs + series + geo + tops.
 *
 * Loga DASHBOARD_EXPORTED em best-effort (falha de log NAO bloqueia o download).
 */
export async function exportCSV(
  filters: DashboardFilters,
  perms: { hasFinanceiro: boolean; hasAudit: boolean }
): Promise<{ csv: string; filename: string; truncated: boolean }> {
  const bundle = await getMetrics(filters);

  const lines: string[][] = [CSV_HEADER];

  // KPIs
  pushKPI(lines, 'usuarios_ativos', bundle.kpis.usuariosAtivos);
  pushKPI(lines, 'novos_cadastros', bundle.kpis.novosCadastros);
  pushKPI(lines, 'fretes_ativos', bundle.kpis.fretesAtivos);
  pushKPI(lines, 'fretes_postados', bundle.kpis.fretesPostados);
  pushKPI(lines, 'fretes_encerrados', bundle.kpis.fretesEncerrados);
  pushKPI(lines, 'taxa_conversao_pct', bundle.kpis.taxaConversaoPct);
  if (perms.hasFinanceiro) pushKPI(lines, 'volume_transacionado', bundle.kpis.volumeTransacionado);
  if (perms.hasAudit) {
    pushKPI(lines, 'logins_admin', bundle.kpis.loginsAdmin);
    pushKPI(lines, 'alertas_seguranca_24h', bundle.kpis.alertasSeguranca24h);
  }

  // Series
  pushSeries(lines, 'cadastros_motoristas', bundle.series.cadastrosMotoristas);
  pushSeries(lines, 'cadastros_embarcadores', bundle.series.cadastrosEmbarcadores);
  pushSeries(lines, 'fretes_postados', bundle.series.fretesPostados);
  pushSeries(lines, 'fretes_encerrados', bundle.series.fretesEncerrados);
  if (perms.hasFinanceiro) pushSeries(lines, 'volume_diario', bundle.series.volumeDiario);

  // Geo
  for (const g of bundle.geo.fretesAtivos) {
    lines.push(['Geo', `${g.uf}:fretes_ativos`, String(g.count), '', '']);
  }
  for (const g of bundle.geo.usuariosAtivos) {
    lines.push(['Geo', `${g.uf}:usuarios_total`, String(g.total ?? 0), '', '']);
  }

  // Top lists
  if (perms.hasFinanceiro && bundle.topEmbarcadores) {
    for (const i of bundle.topEmbarcadores.items) {
      lines.push(['TopEmbarcadores', i.id, i.primaryLabel, '', '']);
    }
  }
  for (const i of bundle.topMotoristas.items) {
    lines.push(['TopMotoristas', i.id, i.primaryLabel, '', '']);
  }
  for (const i of bundle.topRotas.items) {
    lines.push(['TopRotas', i.id, i.primaryLabel, '', '']);
  }

  // Truncate
  const truncated = lines.length > CSV_LIMIT;
  if (truncated) lines.length = CSV_LIMIT;

  const csv = '\uFEFF' + lines.map((row) => row.map(csvEscape).join(';')).join('\r\n');
  const fromDate = bundle.meta.from.slice(0, 10);
  const toDate = bundle.meta.to.slice(0, 10);
  const filename = `dashboard_${fromDate}_a_${toDate}.csv`;

  // Log audit best-effort
  const omitted: string[] = [];
  if (!perms.hasFinanceiro) omitted.push('volume', 'volume_diario', 'top_embarcadores');
  if (!perms.hasAudit) omitted.push('logins_admin', 'alertas_seguranca_24h', 'security_alerts');
  try {
    await logAdminAction({
      action: 'DASHBOARD_EXPORTED',
      targetType: null,
      targetId: null,
      after: {
        filters: { ...filters, resolved: { from: bundle.meta.from, to: bundle.meta.to } },
        kpis_count: 9,
        series_count: 5,
        total_rows: lines.length,
        requested_limit: CSV_LIMIT,
        omitted_blocks: omitted.length ? omitted : undefined,
        truncated: truncated || undefined,
      },
    });
  } catch (e) {
    // best-effort; nao bloqueia o download
    // eslint-disable-next-line no-console
    console.error('[admin/dashboard] DASHBOARD_EXPORTED log failed', e);
  }

  return { csv, filename, truncated };
}

/**
 * Helper utilitario: dispara download de Blob com filename.
 */
export function downloadCsvBlob(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

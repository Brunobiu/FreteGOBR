/**
 * services/admin/rastreamento.ts — camada de serviço do Tracking_Module.
 *
 * Wrappers FINOS sobre as RPCs SECURITY DEFINER da migration 124. TODA mutação
 * passa por `executeAdminMutation` (audit-by-construction) com os action codes
 * oficiais. Leituras agregadas seguem `Partial_Degradation` (`Promise.allSettled`
 * por bloco). O núcleo puro determinístico (`computeFunnelMetrics`,
 * `computeRecoveryRate`, `filterAndSortAtRisk`) é o ESPELHO testado; a RPC é a
 * autoridade de runtime (padrão herdado de cliente-360).
 *
 * REUSO (não duplica/quebra): personalização de mensagem via `AI_Edge_Function`
 * do admin-assistant (`assistant-ai`) com FALLBACK para `DEFAULT_TEMPLATES`;
 * config da chave de IA delega ao Vault via `assistant.setProviderKey`; envio
 * delegado ao motor do whatsapp-automation. Mapeamento de erros pt-BR com
 * PRECEDÊNCIA de `permission_denied`. Nunca loga PII bruta nem segredos.
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 8).
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';
import { setProviderKey } from './assistant';
import {
  computeFunnelMetrics,
  type FunnelMetrics,
  type StageCounts,
} from './rastreamento/funnelMetrics';
import { computeRecoveryRate, type RecoveryCounts } from './rastreamento/recoveryPerformance';
import { DEFAULT_TEMPLATES } from './rastreamento/messageTemplates';
import {
  AI_PROVIDERS,
  FUNNEL_ORDER,
  type AiProvider,
  type ContactStatus,
  type FunnelStage,
  type JourneyEventType,
  type JourneySurface,
  type RecoveryScenario,
  type SuppressionReason,
  type TimeWindow,
} from './rastreamento/domain';
import { type AtRiskRow, type TrackingFilterInput } from './rastreamento/atRiskList';

// ─── Tipos de view (snake_case espelhando as RPCs) ───────────────────────────

/** Página da At_Risk_List. */
export interface AtRiskPage {
  rows: AtRiskRow[];
  total: number;
  page: number;
  page_size: number;
}

/** Item da timeline (rótulo pt-BR resolvido na UI). */
export interface TimelineEvent {
  event_type: JourneyEventType;
  surface: JourneySurface;
  occurred_at: string;
}

/** Bundle da User_Journey_Timeline (Partial_Degradation). */
export interface TimelineBundle {
  events: TimelineEvent[];
  current_stage: FunnelStage;
  errors: Partial<Record<'timeline', string>>;
}

/** Bundle do Conversion_Funnel. */
export interface FunnelBundle {
  window: TimeWindow;
  counts: StageCounts;
  metrics: FunnelMetrics;
  errors: Partial<Record<'funnel', string>>;
}

/** Bundle do Recovery_Performance. */
export interface RecoveryBundle {
  window: TimeWindow;
  counts: RecoveryCounts;
  recovery_rate: number;
  errors: Partial<Record<'recovery', string>>;
}

/** View da Tracking_AI_Config (sem segredo). */
export interface TrackingConfigView {
  active_provider: AiProvider;
  personalization_enabled: boolean;
  inactivity_days: number;
  updated_at: string;
  errors: Partial<Record<'config', string>>;
}

/** Entrada de gatilho manual de recuperação. */
export interface RecoveryTriggerInput {
  kind?: 'EVENT' | 'RISK';
  event_type?: JourneyEventType | null;
  occurred_at?: number;
}

/** Patch de configuração de IA. */
export interface AiConfigPatch {
  active_provider?: AiProvider;
  personalization_enabled?: boolean;
  inactivity_days?: number;
}

/** Resultado de marcar contato (idempotente). */
export type MarkResult =
  | { ok: true; updated_at: string }
  | { skipped: true; reason: 'ALREADY_CONTACTED' };

/** Resultado do gatilho de recuperação. */
export type TriggerResult =
  | { ok: true; scenario: RecoveryScenario; dispatched: boolean }
  | { skipped: true; reason: SuppressionReason | 'NO_ELIGIBLE_SCENARIO' };

// ─── Erros tipados (pt-BR; precedência de permission_denied) ─────────────────

export type RastreamentoErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_INPUT'
  | 'MASTER_ADMIN_IMMUTABLE'
  | 'BLOCK_UNAVAILABLE'
  | 'UNKNOWN';

const RASTREAMENTO_ERROR_MESSAGES: Record<RastreamentoErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Usuário não encontrado.',
  STALE_VERSION: 'Outro admin atualizou. Recarregando.',
  INVALID_INPUT: 'Verifique os dados informados.',
  MASTER_ADMIN_IMMUTABLE: 'Master_Admin é imutável.',
  BLOCK_UNAVAILABLE: 'Bloco indisponível.',
  UNKNOWN: 'Não foi possível concluir.',
};

export class RastreamentoError extends Error {
  readonly code: RastreamentoErrorCode;
  constructor(code: RastreamentoErrorCode, cause?: unknown) {
    super(RASTREAMENTO_ERROR_MESSAGES[code]);
    this.name = 'RastreamentoError';
    this.code = code;
    if (cause !== undefined) (this as unknown as { cause: unknown }).cause = cause;
  }
}

/**
 * Mapeia erros do Postgres/Supabase para RastreamentoError. PRECEDÊNCIA de
 * permission_denied (ERRCODE 42501) é checada PRIMEIRO, antes de qualquer erro
 * de validação simultâneo. Nunca inclui PII bruta.
 */
export function mapRastreamentoError(err: unknown): RastreamentoError {
  if (err instanceof RastreamentoError) return err;
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  // Precedência: permission_denied PRIMEIRO.
  if (code === '42501' || msg.includes('permission_denied')) {
    return new RastreamentoError('PERMISSION_DENIED', err);
  }
  if (msg.includes('STALE_VERSION')) return new RastreamentoError('STALE_VERSION', err);
  if (msg.includes('master')) return new RastreamentoError('MASTER_ADMIN_IMMUTABLE', err);
  if (msg.includes('INVALID_PROVIDER') || msg.includes('INVALID_INACTIVITY') || msg.includes('INVALID_SCENARIO')) {
    return new RastreamentoError('INVALID_INPUT', err);
  }
  if (msg.includes('NOT_FOUND')) return new RastreamentoError('NOT_FOUND', err);
  return new RastreamentoError('UNKNOWN', err);
}

const BLOCK_UNAVAILABLE = 'Bloco indisponível.';

// ─── Validação frontend (backend revalida — autoridade) ──────────────────────

/**
 * Valida o patch de config de IA no frontend (espelho; a RPC revalida APÓS o
 * gating, preservando a precedência). Retorna mensagem pt-BR ou null se válido.
 */
export function validateAiConfigPatch(patch: AiConfigPatch): string | null {
  if (patch.active_provider !== undefined && !(AI_PROVIDERS as readonly string[]).includes(patch.active_provider)) {
    return 'Selecione um provedor de IA válido.';
  }
  if (patch.inactivity_days !== undefined) {
    if (!Number.isInteger(patch.inactivity_days) || patch.inactivity_days < 1) {
      return 'O período de inatividade deve ser de pelo menos 1 dia.';
    }
  }
  return null;
}

// ─── Conversões de filtro (epoch ms ⇄ ISO da RPC) ────────────────────────────

function buildRpcFilter(filter: TrackingFilterInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filter.text !== undefined) out.text = filter.text;
  if (filter.risk_category !== undefined) out.risk_category = filter.risk_category;
  if (filter.problem_type !== undefined) out.problem_type = filter.problem_type;
  if (filter.profile !== undefined) out.profile = filter.profile;
  if (filter.min_score !== undefined) out.min_score = filter.min_score;
  if (filter.max_score !== undefined) out.max_score = filter.max_score;
  if (filter.from !== undefined) out.from = new Date(filter.from).toISOString();
  if (filter.to !== undefined) out.to = new Date(filter.to).toISOString();
  return out;
}

function mapAtRiskRow(raw: Record<string, unknown>): AtRiskRow {
  const last = raw.last_activity_at;
  return {
    user_id: String(raw.user_id ?? ''),
    risk_score: Number(raw.risk_score ?? 0),
    risk_band: raw.risk_band as AtRiskRow['risk_band'],
    abandonment_cause: raw.abandonment_cause as AtRiskRow['abandonment_cause'],
    risk_category: raw.risk_category as AtRiskRow['risk_category'],
    contact_status: (raw.contact_status as ContactStatus) ?? 'AT_RISK',
    name: String(raw.name ?? ''),
    phone_masked: String(raw.phone_masked ?? ''),
    profile: (raw.profile as 'motorista' | 'embarcador') ?? 'motorista',
    last_activity_at: typeof last === 'string' ? Date.parse(last) : Number(last ?? 0),
  };
}

// ─── Leituras (Partial_Degradation) ──────────────────────────────────────────

/** Lista usuários em risco (filtrada/paginada server-side). */
export async function listAtRisk(
  filter: TrackingFilterInput,
  page: number,
  pageSize: 10 | 50 | 100
): Promise<AtRiskPage> {
  const { data, error } = await supabase.rpc('rpc_tracking_at_risk_list', {
    p_filter: buildRpcFilter(filter),
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw mapRastreamentoError(error);
  const raw = (data ?? {}) as { items?: unknown[]; total?: number; page?: number; page_size?: number };
  return {
    rows: (raw.items ?? []).map((r) => mapAtRiskRow(r as Record<string, unknown>)),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    page_size: raw.page_size ?? pageSize,
  };
}

/** Timeline de um usuário (eventos asc + etapa atual). */
export async function getTimeline(userId: string): Promise<TimelineBundle> {
  const bundle: TimelineBundle = { events: [], current_stage: 'VISITOR', errors: {} };
  const { data, error } = await supabase.rpc('rpc_tracking_timeline', { p_user_id: userId });
  if (error) {
    const mapped = mapRastreamentoError(error);
    // permission_denied propaga (UI vira Stealth_404); demais degradam o bloco.
    if (mapped.code === 'PERMISSION_DENIED') throw mapped;
    bundle.errors.timeline = BLOCK_UNAVAILABLE;
    return bundle;
  }
  const raw = (data ?? {}) as { events?: TimelineEvent[]; current_stage?: FunnelStage };
  bundle.events = raw.events ?? [];
  bundle.current_stage = raw.current_stage ?? 'VISITOR';
  return bundle;
}

function emptyStageCounts(): StageCounts {
  const counts = {} as StageCounts;
  for (const stage of FUNNEL_ORDER) counts[stage] = 0;
  return counts;
}

/** Funil de conversão por janela (contagens da RPC + métricas do núcleo). */
export async function getFunnel(window: TimeWindow): Promise<FunnelBundle> {
  const counts = emptyStageCounts();
  const bundle: FunnelBundle = {
    window,
    counts,
    metrics: computeFunnelMetrics(counts),
    errors: {},
  };
  const { data, error } = await supabase.rpc('rpc_tracking_funnel', { p_window: window });
  if (error) {
    const mapped = mapRastreamentoError(error);
    if (mapped.code === 'PERMISSION_DENIED') throw mapped;
    bundle.errors.funnel = BLOCK_UNAVAILABLE;
    return bundle;
  }
  const raw = (data ?? {}) as { counts?: Partial<StageCounts> };
  for (const stage of FUNNEL_ORDER) {
    counts[stage] = Number(raw.counts?.[stage] ?? 0);
  }
  bundle.counts = counts;
  bundle.metrics = computeFunnelMetrics(counts);
  return bundle;
}

/** Desempenho de recuperação por janela (contadores + Recovery_Rate). */
export async function getRecoveryPerformance(window: TimeWindow): Promise<RecoveryBundle> {
  const counts: RecoveryCounts = { AT_RISK: 0, CONTACTED: 0, REPLIED: 0, CONVERTED: 0 };
  const bundle: RecoveryBundle = {
    window,
    counts,
    recovery_rate: 0,
    errors: {},
  };
  const { data, error } = await supabase.rpc('rpc_tracking_recovery_performance', { p_window: window });
  if (error) {
    const mapped = mapRastreamentoError(error);
    if (mapped.code === 'PERMISSION_DENIED') throw mapped;
    bundle.errors.recovery = BLOCK_UNAVAILABLE;
    return bundle;
  }
  const raw = (data ?? {}) as { counts?: Partial<RecoveryCounts> };
  counts.AT_RISK = Number(raw.counts?.AT_RISK ?? 0);
  counts.CONTACTED = Number(raw.counts?.CONTACTED ?? 0);
  counts.REPLIED = Number(raw.counts?.REPLIED ?? 0);
  counts.CONVERTED = Number(raw.counts?.CONVERTED ?? 0);
  bundle.counts = counts;
  bundle.recovery_rate = computeRecoveryRate(counts);
  return bundle;
}

/** Lê a Tracking_AI_Config (sem segredo). */
export async function getTrackingConfig(): Promise<TrackingConfigView> {
  const fallback: TrackingConfigView = {
    active_provider: 'gemini',
    personalization_enabled: false,
    inactivity_days: 14,
    updated_at: '',
    errors: {},
  };
  const { data, error } = await supabase.rpc('rpc_tracking_get_config');
  if (error) {
    const mapped = mapRastreamentoError(error);
    if (mapped.code === 'PERMISSION_DENIED') throw mapped;
    fallback.errors.config = BLOCK_UNAVAILABLE;
    return fallback;
  }
  const raw = (data ?? {}) as Partial<TrackingConfigView>;
  return {
    active_provider: (raw.active_provider as AiProvider) ?? 'gemini',
    personalization_enabled: Boolean(raw.personalization_enabled),
    inactivity_days: Number(raw.inactivity_days ?? 14),
    updated_at: String(raw.updated_at ?? ''),
    errors: {},
  };
}

// ─── Personalização de IA (reuso admin-assistant) + delegação whatsapp ───────

/**
 * Personaliza a mensagem do cenário via `AI_Edge_Function` (assistant-ai),
 * enviando contexto MÍNIMO (sem PII). Degrada para `DEFAULT_TEMPLATES[scenario]`
 * em qualquer falha/indisponibilidade do provedor (Req 10.5, 12.6).
 */
export async function personalizeRecoveryMessage(
  scenario: RecoveryScenario,
  context: { current_stage: FunnelStage; risk_band: string; abandonment_cause: string }
): Promise<string> {
  const fallback = DEFAULT_TEMPLATES[scenario];
  try {
    const { data, error } = await supabase.functions.invoke('assistant-ai', {
      body: {
        purpose: 'recovery_personalization',
        scenario,
        context, // mínimo e sem PII
        template: fallback,
      },
    });
    if (error) return fallback;
    const reply = (data as { reply?: unknown } | null)?.reply;
    return typeof reply === 'string' && reply.trim().length > 0 ? reply.trim() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Delega o envio ao motor do whatsapp-automation (Job_Worker/Dispatch_Job).
 * Seam de composição: NÃO recria QR/sessão/envio. Lança em falha de delegação
 * (o chamador então NÃO marca CONTACTED — Req 9.12). Retorna o id do
 * Dispatch_Job quando criado (ou null quando o envio é manual via Inbox).
 */
export async function deliverRecoveryMessage(
  userId: string,
  scenario: RecoveryScenario,
  message: string
): Promise<{ dispatch_job_id: string | null }> {
  const { data, error } = await supabase.functions.invoke('whatsapp-evolution-proxy', {
    body: { action: 'enqueue_recovery', user_id: userId, scenario, message },
  });
  if (error) throw mapRastreamentoError(error);
  const ok = (data as { ok?: unknown } | null)?.ok;
  if (ok === false) throw new RastreamentoError('UNKNOWN');
  const jobId = (data as { dispatch_job_id?: unknown } | null)?.dispatch_job_id;
  return { dispatch_job_id: typeof jobId === 'string' ? jobId : null };
}

// ─── Mutações (executeAdminMutation; idempotência; STALE_VERSION) ────────────

/**
 * Marca um usuário como contatado. Idempotente: já contatado/respondido/
 * convertido ⇒ `_SKIPPED` (`ALREADY_CONTACTED`) — o audit do skip
 * (`TRACKING_CONTACT_MARK_SKIPPED`) é gravado pela própria RPC, sem mutação
 * real (padrão herdado: idempotência _SKIPPED não usa executeAdminMutation). A
 * mutação real grava `TRACKING_CONTACT_MARK` (best-effort, não bloqueia).
 */
export async function markContacted(
  userId: string,
  expectedUpdatedAt: string
): Promise<MarkResult> {
  const { data, error } = await supabase.rpc('rpc_tracking_mark_contacted', {
    p_user_id: userId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw mapRastreamentoError(error);
  const raw = (data ?? {}) as { skipped?: boolean; reason?: string; updated_at?: string };
  if (raw.skipped) return { skipped: true, reason: 'ALREADY_CONTACTED' };

  // Mutação real ocorreu na RPC: grava o audit positivo (não bloqueia — Req 15.7).
  await logAdminAction({
    action: 'TRACKING_CONTACT_MARK',
    targetType: 'recovery_attempts',
    targetId: userId,
  }).catch(() => null);
  return { ok: true, updated_at: raw.updated_at ?? '' };
}

/**
 * Aciona a recuperação manual. A RPC `rpc_tracking_trigger_recovery` é a
 * AUTORIDADE do motor: SUPPRESS ⇒ `_SKIPPED` (a RPC grava RECOVERY_TRIGGER_SKIPPED).
 * DISPATCH ⇒ personaliza (IA, fallback template), delega ao whatsapp e registra
 * a Recovery_Attempt; falha na delegação ⇒ conclui, loga em separado e NÃO
 * marca CONTACTED (Req 9.12). O caminho DISPATCH é auditado via
 * executeAdminMutation (RECOVERY_TRIGGER).
 */
export async function triggerRecovery(
  userId: string,
  trigger: RecoveryTriggerInput
): Promise<TriggerResult> {
  const triggerPayload = {
    kind: trigger.kind ?? 'RISK',
    event_type: trigger.event_type ?? null,
    occurred_at: trigger.occurred_at ? new Date(trigger.occurred_at).toISOString() : null,
    message_hash: '',
  };

  const { data, error } = await supabase.rpc('rpc_tracking_trigger_recovery', {
    p_user_id: userId,
    p_trigger: triggerPayload,
  });
  if (error) throw mapRastreamentoError(error);
  const decision = (data ?? {}) as {
    skipped?: boolean;
    reason?: string;
    scenario?: RecoveryScenario;
  };

  if (decision.skipped) {
    const reason = (decision.reason ?? 'NO_ELIGIBLE_SCENARIO') as
      | SuppressionReason
      | 'NO_ELIGIBLE_SCENARIO';
    return { skipped: true, reason };
  }

  const scenario = decision.scenario as RecoveryScenario;
  return executeAdminMutation(
    {
      action: 'RECOVERY_TRIGGER',
      targetType: 'recovery_attempts',
      targetId: userId,
      after: { scenario },
    },
    async (): Promise<TriggerResult> => {
      // (1) personaliza (IA com fallback de template) — contexto mínimo, sem PII.
      const message = await personalizeRecoveryMessage(scenario, {
        current_stage: 'VISITOR',
        risk_band: '',
        abandonment_cause: '',
      });
      // (2) delega ao whatsapp; falha ⇒ NÃO marca CONTACTED (Req 9.12).
      let dispatchJobId: string | null = null;
      try {
        const res = await deliverRecoveryMessage(userId, scenario, message);
        dispatchJobId = res.dispatch_job_id;
      } catch {
        // log estruturado em separado (sem PII); recuperação permanece operável.
        console.error(
          JSON.stringify({ level: 'error', ts: Date.now(), event: 'recovery_dispatch_failed', scenario })
        );
        return { ok: true, scenario, dispatched: false };
      }
      // (3) registra a Recovery_Attempt (CONTACTED) com a referência ao dispatch.
      const { error: recErr } = await supabase.rpc('rpc_tracking_record_dispatch', {
        p_user_id: userId,
        p_scenario: scenario,
        p_message_hash: '',
        p_trigger_event_id: null,
        p_dispatch_job_id: dispatchJobId,
        p_auto: false,
      });
      if (recErr) throw mapRastreamentoError(recErr);
      return { ok: true, scenario, dispatched: true };
    }
  );
}

/**
 * Atualiza a Tracking_AI_Config (sem segredo) com versionamento otimista.
 * `STALE_VERSION` quando `expected_updated_at` diverge. A CHAVE de IA NUNCA
 * transita aqui — use `setTrackingAiKey` (delega ao Vault do admin-assistant).
 */
export async function updateAiConfig(
  patch: AiConfigPatch,
  expectedUpdatedAt: string
): Promise<{ updated_at: string }> {
  return executeAdminMutation(
    { action: 'TRACKING_AI_CONFIG_UPDATE', targetType: 'tracking_ai_config', targetId: 'singleton' },
    async () => {
      const { data, error } = await supabase.rpc('rpc_tracking_update_ai_config', {
        p_patch: patch,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapRastreamentoError(error);
      const raw = (data ?? {}) as { updated_at?: string };
      return { updated_at: raw.updated_at ?? '' };
    }
  );
}

/**
 * Registra a chave de IA do provedor — REUSA o Vault da Provider_Abstraction do
 * admin-assistant (`setProviderKey`). NÃO cria novo cofre; a chave nunca volta
 * ao frontend (Req 12.2, 12.3).
 */
export async function setTrackingAiKey(provider: AiProvider, rawKey: string): Promise<{ ok: true }> {
  return setProviderKey(provider, rawKey);
}

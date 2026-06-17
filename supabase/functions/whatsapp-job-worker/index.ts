// ============================================================================
// Edge Function: whatsapp-job-worker
// ============================================================================
// Spec: .kiro/specs/whatsapp-automation/{requirements,design,tasks}.md
//   Task 12.1 — claim atomico de jobs e recipients (PENDING -> SENDING).
//   Task 12.2 — pacing por relogio (shouldSendNow) + quota por execucao
//               (exec_sent_count >= execution_quota -> PAUSED com pendentes).
//   Task 12.3 — envio via sessao da PROPRIA instancia (renderMessage no momento
//               do envio), marcacao SENT/FAILED + failure_reason, e transicao
//               para COMPLETED quando todos processados.
//   Task 12.4 — varredura de Scheduled_Dispatches vencidos (-> QUEUED) no inicio
//               do tick.
//   Task 12.5 — recuperacao (Req 27): recipients SENDING orfaos -> PENDING e
//               jobs inconsistentes (sem recipients) -> JOB_FAILED, seguindo com
//               os demais.
//
// O processamento de disparos e SERVER-SIDE e DURAVEL (design.md > "Worker
// duravel"): a fila vive em Postgres e este worker, acionado pelo pg_cron a cada
// minuto (`* * * * *`, SECTION 11 da migration 092 via net.http_post/pg_net),
// drena a fila em background. Cada tick e STATELESS: le o estado duravel, faz
// uma fatia de trabalho respeitando Send_Interval/quota e persiste o progresso.
// Se o tick morre no meio, o proximo tick retoma do proximo Dispatch_Recipient
// PENDING (a "recuperacao" e o comportamento normal do proximo tick, reforcado
// pela varredura de orfaos da task 12.5).
//
// Pacing sem dormir (Req 8.6): como os ticks sao curtos, o worker NAO dorme pelo
// Send_Interval — ele OLHA O RELOGIO. Apos um envio, last_send_at = now; a
// proxima iteracao do mesmo tick so enviaria se now >= last_send_at + interval,
// o que (para qualquer interval > 0) e falso dentro do mesmo tick. Resultado:
// no maximo ~1 envio por tick por job, espacando os envios por >= o periodo do
// cron (anti-ban). A quota por execucao acumula ATRAVES de ticks (exec_sent_count
// e persistido; so e zerado no RESUME — migration 101); ao atingir a quota com
// pendentes, o job vai a PAUSED ate o Admin_User clicar "Continuar".
//
// Postura de seguranca (design.md > "Security Posture"):
//   * verify_jwt = FALSE: acionado pelo pg_cron (server-to-server). Deploy:
//       supabase functions deploy whatsapp-job-worker --no-verify-jwt
//   * Autenticidade via SEGREDO DE INVOCACAO no header `x-worker-secret`, que
//     SOMENTE o pg_cron conhece (Vault `whatsapp_worker_secret`). FAIL-CLOSED:
//     segredo ausente/invalido => 401 SEM efeito. Comparacao em tempo constante.
//   * Cada job usa EXCLUSIVAMENTE a WhatsApp_Session e a Evolution_Api_Key do
//     `instance_id` do PROPRIO job (Req 10.9, 27.7). A chave e lida do Vault
//     (`whatsapp_evolution_key_<instance_id>`) e NUNCA trafega ao browser nem e
//     logada. Todo dado externo e tratado como NAO CONFIAVEL.
//
// Contrato de requisicao (POST, JSON; corpo do pg_cron e opcional/ignorado):
//   headers: { 'x-worker-secret': '<segredo do Vault>' }
//
// Contrato de resposta (JSON):
//   sucesso:        200 { ok: true, jobsClaimed, sent, failed, scheduledSwept,
//                         recoveredRecipients, failedJobs }
//   segredo invalido: 401 { ok: false, error: 'unauthorized' }
//   metodo != POST:   405 { ok: false, error: 'method_not_allowed' }
//
// Env vars:
//   SUPABASE_URL               (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injetado) — chama as RPCs (GRANT service_role)
//                              e le o Vault.
//   WHATSAPP_WORKER_SECRET     (opcional) — segredo de invocacao esperado; se
//                              ausente, cai no Vault `whatsapp_worker_secret`.
//   EVOLUTION_API_URL          (opcional) — base URL da Evolution; se ausente,
//                              cai no Vault `whatsapp_evolution_url`.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===================== Env ==================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_SECRET_ENV = Deno.env.get('WHATSAPP_WORKER_SECRET') ?? '';
const EVOLUTION_API_URL_ENV = Deno.env.get('EVOLUTION_API_URL') ?? '';

// Teto defensivo de jobs reivindicados por tick (alinhado ao p_limit da RPC).
const MAX_JOBS_PER_TICK = 50;
// Janela (segundos) para considerar um recipient SENDING como orfao (task 12.5).
const ORPHAN_STALE_SECONDS = 300;
// Validade (segundos) da signed URL de midia enviada a Evolution.
const MEDIA_URL_TTL_SECONDS = 120;

// Mensagens de falha (pt-BR, sem segredos — Req 10.6, 23.8).
const MSG_SEND_FAILED = 'Falha ao enviar a mensagem.';
const MSG_CONTENT_UNAVAILABLE = 'Conteudo do disparo indisponivel.';
const MSG_MEDIA_UNAVAILABLE = 'Midia do disparo indisponivel.';
const MSG_EMPTY_CONTENT = 'Conteudo do disparo vazio.';
const MSG_NO_TARGET = 'Destinatario sem numero/grupo valido.';

// ===================== Helpers de I/O =======================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Comparacao de strings em tempo constante (evita timing-attack na validacao do
 * segredo de invocacao). O segredo nunca e logado nem ecoado.
 */
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function safeJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

// ===================== Logica PURA inline (espelha src/.../worker.ts) ========
// A Edge Function roda em Deno e NAO importa de src/. Estes helpers sao copias
// fieis de `src/services/admin/whatsapp/{dispatch,render,worker}.ts`, que sao
// os ESPELHOS TESTAVEIS (vitest) desta logica. Manter ambos em sincronia.

/** Pacing por relogio (Req 8.6). epoch ms; `lastSendAtMs` null no 1o envio. */
function shouldSendNow(nowMs: number, lastSendAtMs: number | null, intervalSec: number): boolean {
  if (lastSendAtMs === null) return true;
  return nowMs >= lastSendAtMs + intervalSec * 1000;
}

/** Quota da execucao atingida (Req 8.5). quota null => sem limite. */
function quotaReached(execSentCount: number, executionQuota: number | null): boolean {
  return executionQuota !== null && execSentCount >= executionQuota;
}

const VARIABLE_MARKER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const SUPPORTED_VARIABLES = ['nome', 'telefone', 'empresa'];

/** Renderiza Message_Variables (Req 25); nunca vaza marcador literal (P8). */
function renderMessage(template: string, data: Record<string, unknown>): string {
  return template.replace(VARIABLE_MARKER, (_m, rawName: string) => {
    const name = String(rawName).trim().toLowerCase();
    if (!SUPPORTED_VARIABLES.includes(name)) return '';
    const value = data?.[name];
    return typeof value === 'string' && value !== '' ? value : '';
  });
}

/** Nome deterministico da instancia na Evolution (Req 4.6). */
function deriveInstanceName(instanceId: string): string {
  return `frego_wa_${instanceId}`;
}

/** Mapeia o dominio media_type (IMAGE/...) para o `mediatype` da Evolution. */
function mapMediaType(mediaType: string): string {
  switch (String(mediaType).toUpperCase()) {
    case 'IMAGE':
      return 'image';
    case 'VIDEO':
      return 'video';
    case 'AUDIO':
      return 'audio';
    default:
      return 'document';
  }
}

// ===================== Segredo de invocacao (env -> Vault) ==================

let cachedExpectedSecret: string | null = null;

/** Le um segredo do Vault pelo nome (service-role). '' quando ausente. */
async function readVaultSecret(sb: SupabaseClient, name: string): Promise<string> {
  try {
    const { data, error } = await sb
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', name)
      .limit(1)
      .maybeSingle();
    if (error) return '';
    const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
    return typeof secret === 'string' ? secret : '';
  } catch {
    return '';
  }
}

/**
 * Resolve o segredo de invocacao esperado: env `WHATSAPP_WORKER_SECRET` tem
 * prioridade; fallback no Vault `whatsapp_worker_secret`. '' => validacao SEMPRE
 * falha (401, fail-closed). O valor nunca e logado nem retornado.
 */
async function resolveExpectedSecret(sb: SupabaseClient): Promise<string> {
  if (cachedExpectedSecret !== null) return cachedExpectedSecret;
  let secret = WORKER_SECRET_ENV.trim();
  if (!secret) secret = (await readVaultSecret(sb, 'whatsapp_worker_secret')).trim();
  cachedExpectedSecret = secret;
  return secret;
}

/** Segredo apresentado pelo invocador no header `x-worker-secret` (nao confiavel). */
function extractPresentedSecret(req: Request): string {
  return (req.headers.get('x-worker-secret') ?? '').trim();
}

/**
 * Base URL da Evolution: env `EVOLUTION_API_URL` ou Vault `whatsapp_evolution_url`.
 * Sem barra final; '' quando ausente (=> envio impossivel).
 */
async function resolveEvolutionBaseUrl(sb: SupabaseClient): Promise<string> {
  let base = EVOLUTION_API_URL_ENV.trim();
  if (!base) base = (await readVaultSecret(sb, 'whatsapp_evolution_url')).trim();
  return base ? base.replace(/\/+$/, '') : '';
}

/** Evolution_Api_Key da PROPRIA instancia (Vault, escopo por instance_id). */
async function readEvolutionKey(sb: SupabaseClient, instanceId: string): Promise<string> {
  return (await readVaultSecret(sb, `whatsapp_evolution_key_${instanceId}`)).trim();
}

// ===================== Tipos do dominio =====================================

interface ClaimedJob {
  id: string;
  instance_id: string;
  kind: string;
  status: string;
  send_interval_sec: number;
  execution_quota: number | null;
  exec_sent_count: number;
  last_send_at: string | null;
}

interface ClaimedRecipient {
  id: string;
  instance_id: string;
  target_kind: string;
  phone: string | null;
  group_jid: string | null;
  recipient_data: Record<string, unknown>;
  assigned_content_id: string | null;
}

interface ContentToSend {
  body: string;
  media: { mediaType: string; storagePath: string } | null;
}

// ===================== Parsers de payload nao confiavel =====================

function parseClaimedJobs(data: unknown): ClaimedJob[] {
  if (!Array.isArray(data)) return [];
  const out: ClaimedJob[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.instance_id !== 'string') continue;
    out.push({
      id: o.id,
      instance_id: o.instance_id,
      kind: typeof o.kind === 'string' ? o.kind : '',
      status: typeof o.status === 'string' ? o.status : '',
      send_interval_sec: typeof o.send_interval_sec === 'number' ? o.send_interval_sec : 0,
      execution_quota: typeof o.execution_quota === 'number' ? o.execution_quota : null,
      exec_sent_count: typeof o.exec_sent_count === 'number' ? o.exec_sent_count : 0,
      last_send_at: typeof o.last_send_at === 'string' ? o.last_send_at : null,
    });
  }
  return out;
}

function parseClaimedRecipient(data: unknown): ClaimedRecipient | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.instance_id !== 'string') return null;
  return {
    id: o.id,
    instance_id: o.instance_id,
    target_kind: typeof o.target_kind === 'string' ? o.target_kind : 'CONTACT',
    phone: typeof o.phone === 'string' ? o.phone : null,
    group_jid: typeof o.group_jid === 'string' ? o.group_jid : null,
    recipient_data:
      typeof o.recipient_data === 'object' && o.recipient_data !== null
        ? (o.recipient_data as Record<string, unknown>)
        : {},
    assigned_content_id: typeof o.assigned_content_id === 'string' ? o.assigned_content_id : null,
  };
}

/** Extrai o provider_message_id de uma resposta nao confiavel da Evolution. */
function extractMessageId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  const key = o.key;
  if (typeof key === 'object' && key !== null) {
    const id = (key as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  if (typeof o.id === 'string' && o.id.length > 0) return o.id;
  return null;
}

// ===================== RPC wrappers (migrations 103 + 111) ==================

async function claimDueJobs(sb: SupabaseClient, limit: number): Promise<ClaimedJob[]> {
  try {
    const { data, error } = await sb.rpc('whatsapp_claim_due_jobs', { p_limit: limit });
    if (error) return [];
    return parseClaimedJobs(data);
  } catch {
    return [];
  }
}

async function claimNextRecipient(
  sb: SupabaseClient,
  jobId: string
): Promise<ClaimedRecipient | null> {
  try {
    const { data, error } = await sb.rpc('whatsapp_claim_next_recipient', { p_job_id: jobId });
    if (error) return null;
    return parseClaimedRecipient(data);
  } catch {
    return null;
  }
}

/** Marca SENT; retorna o exec_sent_count atualizado (ou null em erro). */
async function markSent(
  sb: SupabaseClient,
  recipientId: string,
  providerMessageId: string | null,
  nowIso: string
): Promise<{ execSentCount: number | null }> {
  try {
    const { data, error } = await sb.rpc('whatsapp_worker_mark_sent', {
      p_recipient_id: recipientId,
      p_provider_message_id: providerMessageId,
      p_now: nowIso,
    });
    if (error || typeof data !== 'object' || data === null) return { execSentCount: null };
    const exec = (data as Record<string, unknown>).exec_sent_count;
    return { execSentCount: typeof exec === 'number' ? exec : null };
  } catch {
    return { execSentCount: null };
  }
}

async function markFailed(
  sb: SupabaseClient,
  recipientId: string,
  failureReason: string
): Promise<void> {
  try {
    await sb.rpc('whatsapp_worker_mark_failed', {
      p_recipient_id: recipientId,
      p_failure_reason: failureReason,
    });
  } catch {
    // best-effort: a recuperacao (task 12.5) cobre recipients presos em SENDING.
  }
}

async function releaseRecipient(sb: SupabaseClient, recipientId: string): Promise<void> {
  try {
    await sb.rpc('whatsapp_worker_release_recipient', { p_recipient_id: recipientId });
  } catch {
    // best-effort
  }
}

async function finalizeJob(sb: SupabaseClient, jobId: string): Promise<void> {
  try {
    await sb.rpc('whatsapp_worker_finalize_job', { p_job_id: jobId });
  } catch {
    // best-effort: o proximo tick re-finaliza.
  }
}

async function sweepScheduled(sb: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await sb.rpc('whatsapp_worker_sweep_scheduled', { p_limit: 100 });
    if (error || typeof data !== 'object' || data === null) return 0;
    const promoted = (data as Record<string, unknown>).promoted;
    return typeof promoted === 'number' ? promoted : 0;
  } catch {
    return 0;
  }
}

async function recover(sb: SupabaseClient): Promise<{ recipients: number; jobs: number }> {
  try {
    const { data, error } = await sb.rpc('whatsapp_worker_recover', {
      p_stale_seconds: ORPHAN_STALE_SECONDS,
      p_limit: 500,
    });
    if (error || typeof data !== 'object' || data === null) return { recipients: 0, jobs: 0 };
    const o = data as Record<string, unknown>;
    return {
      recipients: typeof o.recovered_recipients === 'number' ? o.recovered_recipients : 0,
      jobs: typeof o.failed_jobs === 'number' ? o.failed_jobs : 0,
    };
  } catch {
    return { recipients: 0, jobs: 0 };
  }
}

// ===================== Leitura de sessao e conteudo =========================

async function readSessionStatus(sb: SupabaseClient, instanceId: string): Promise<string> {
  try {
    const { data, error } = await sb
      .from('whatsapp_sessions')
      .select('status')
      .eq('instance_id', instanceId)
      .maybeSingle();
    if (error || !data) return 'DISCONNECTED';
    const status = (data as { status?: unknown }).status;
    return typeof status === 'string' ? status : 'DISCONNECTED';
  } catch {
    return 'DISCONNECTED';
  }
}

/** Carrega o Content (body + 1a midia) do assigned_content_id. null se ausente. */
async function loadContent(sb: SupabaseClient, contentId: string): Promise<ContentToSend | null> {
  try {
    const { data: content, error } = await sb
      .from('whatsapp_contents')
      .select('id, body')
      .eq('id', contentId)
      .maybeSingle();
    if (error || !content) return null;

    let media: { mediaType: string; storagePath: string } | null = null;
    const { data: mediaRow } = await sb
      .from('whatsapp_content_media')
      .select('media_type, storage_path')
      .eq('content_id', contentId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (mediaRow) {
      const m = mediaRow as Record<string, unknown>;
      if (typeof m.media_type === 'string' && typeof m.storage_path === 'string') {
        media = { mediaType: m.media_type, storagePath: m.storage_path };
      }
    }

    const body = typeof (content as { body?: unknown }).body === 'string' ? (content as { body: string }).body : '';
    return { body, media };
  } catch {
    return null;
  }
}

/** Cria signed URL temporaria para a midia no bucket privado whatsapp-media. */
async function createMediaSignedUrl(sb: SupabaseClient, storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await sb.storage
      .from('whatsapp-media')
      .createSignedUrl(storagePath, MEDIA_URL_TTL_SECONDS);
    if (error) return null;
    const url = (data as { signedUrl?: unknown } | null)?.signedUrl;
    return typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

// ===================== Envio via Evolution (sessao da instancia) ============

interface SendResult {
  ok: boolean;
  messageId: string | null;
}

async function sendText(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
  number: string,
  text: string
): Promise<SendResult> {
  try {
    const resp = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number, text }),
    });
    const data = resp.ok ? await safeJson(resp) : null;
    return { ok: resp.ok, messageId: extractMessageId(data) };
  } catch {
    return { ok: false, messageId: null };
  }
}

async function sendMedia(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
  number: string,
  mediatype: string,
  mediaUrl: string,
  caption: string
): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = { number, mediatype, media: mediaUrl };
    if (caption.length > 0) body.caption = caption;
    const resp = await fetch(`${baseUrl}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
    });
    const data = resp.ok ? await safeJson(resp) : null;
    return { ok: resp.ok, messageId: extractMessageId(data) };
  } catch {
    return { ok: false, messageId: null };
  }
}

// ===================== Processamento de um job (uma fatia) ==================

/**
 * Processa uma fatia do job (tasks 12.2/12.3): respeita quota e pacing,
 * reivindica/envia/marca um recipient por vez e finaliza o job. Usa
 * EXCLUSIVAMENTE a sessao/chave do `instance_id` do proprio job (Req 10.9).
 */
async function processJob(
  sb: SupabaseClient,
  job: ClaimedJob,
  baseUrl: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  // Sessao da PROPRIA instancia precisa estar CONNECTED (Req 4.5/10.9). Caso
  // contrario, nao queima tentativas como falhas: deixa o job RUNNING (finalize
  // mantem RUNNING com pendentes) e aguarda reconexao no proximo tick.
  const session = await readSessionStatus(sb, job.instance_id);
  if (session !== 'CONNECTED') {
    await finalizeJob(sb, job.id);
    return { sent, failed };
  }

  // Chave da Evolution escopada por instancia; sem chave/baseUrl, envio
  // impossivel => nao falha em massa, apenas aguarda configuracao.
  const apiKey = await readEvolutionKey(sb, job.instance_id);
  if (!baseUrl || !apiKey) {
    await finalizeJob(sb, job.id);
    return { sent, failed };
  }
  const instanceName = deriveInstanceName(job.instance_id);

  let execSentCount = job.exec_sent_count;
  let lastSendAtMs = job.last_send_at ? Date.parse(job.last_send_at) : null;
  if (Number.isNaN(lastSendAtMs as number)) lastSendAtMs = null;
  const intervalSec = job.send_interval_sec;
  const quota = job.execution_quota;

  for (;;) {
    // (1) Quota da execucao (Req 8.5): atingida => para (finalize => PAUSED).
    if (quotaReached(execSentCount, quota)) break;

    // (2) Claim atomico do proximo PENDING (idempotencia por destinatario).
    const rec = await claimNextRecipient(sb, job.id);
    if (!rec) break; // sem PENDING — finalize decide COMPLETED.

    // (3) Pacing por relogio (Req 8.6): se nao venceu, devolve e aguarda tick.
    const nowMs = Date.now();
    if (!shouldSendNow(nowMs, lastSendAtMs, intervalSec)) {
      await releaseRecipient(sb, rec.id);
      break;
    }

    // (4) Resolve destino e conteudo.
    const number = rec.target_kind === 'GROUP' ? rec.group_jid : rec.phone;
    if (!number) {
      await markFailed(sb, rec.id, MSG_NO_TARGET);
      failed++;
      continue;
    }
    const content = rec.assigned_content_id ? await loadContent(sb, rec.assigned_content_id) : null;
    if (!content) {
      await markFailed(sb, rec.id, MSG_CONTENT_UNAVAILABLE);
      failed++;
      continue;
    }

    // (5) Render no momento do envio (Req 25.2); template nunca e alterado.
    const text = renderMessage(content.body, rec.recipient_data);

    // (6) Envio via sessao da instancia. Midia => uma mensagem com legenda;
    //     senao texto. Conteudo vazio (sem texto e sem midia) => FAILED.
    let result: SendResult;
    if (content.media) {
      const url = await createMediaSignedUrl(sb, content.media.storagePath);
      if (!url) {
        await markFailed(sb, rec.id, MSG_MEDIA_UNAVAILABLE);
        failed++;
        continue;
      }
      result = await sendMedia(
        baseUrl,
        instanceName,
        apiKey,
        number,
        mapMediaType(content.media.mediaType),
        url,
        text
      );
    } else if (text.length > 0) {
      result = await sendText(baseUrl, instanceName, apiKey, number, text);
    } else {
      await markFailed(sb, rec.id, MSG_EMPTY_CONTENT);
      failed++;
      continue;
    }

    // (7) Marcacao duravel imediata (Req 10.3) + atualizacao do pacing/quota.
    if (result.ok) {
      const snap = await markSent(sb, rec.id, result.messageId, new Date().toISOString());
      sent++;
      execSentCount = snap.execSentCount ?? execSentCount + 1;
      lastSendAtMs = Date.now();
    } else {
      await markFailed(sb, rec.id, MSG_SEND_FAILED);
      failed++;
    }
    // A proxima iteracao re-checa pacing: como last_send_at = agora, para
    // qualquer interval > 0 o tick encerra aqui (~1 envio/tick por job).
  }

  // (8) Finaliza o job: COMPLETED se drenado, PAUSED se quota com pendentes.
  await finalizeJob(sb, job.id);
  return { sent, failed };
}

// ===================== Tick =================================================

async function runTick(sb: SupabaseClient): Promise<{
  jobsClaimed: number;
  sent: number;
  failed: number;
  scheduledSwept: number;
  recoveredRecipients: number;
  failedJobs: number;
}> {
  // (A) Recuperacao (task 12.5): orfaos SENDING -> PENDING; jobs sem recipients
  //     -> JOB_FAILED. Roda ANTES do claim para reabilitar pendentes recuperados.
  const rec = await recover(sb);

  // (B) Varredura de agendados vencidos (task 12.4): DRAFT -> QUEUED.
  const scheduledSwept = await sweepScheduled(sb);

  // (C) Claim dos jobs elegiveis (QUEUED/RUNNING), marca RUNNING.
  const jobs = await claimDueJobs(sb, MAX_JOBS_PER_TICK);

  // (D) Base URL da Evolution (server unico; a chave e por instancia).
  const baseUrl = await resolveEvolutionBaseUrl(sb);

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const r = await processJob(sb, job, baseUrl);
    sent += r.sent;
    failed += r.failed;
  }

  return {
    jobsClaimed: jobs.length,
    sent,
    failed,
    scheduledSwept,
    recoveredRecipients: rec.recipients,
    failedJobs: rec.jobs,
  };
}

// ===================== Handler ==============================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Autenticidade: segredo de invocacao no header `x-worker-secret` (fail-closed).
  const expectedSecret = await resolveExpectedSecret(sb);
  const presentedSecret = extractPresentedSecret(req);
  if (!expectedSecret || !safeEq(presentedSecret, expectedSecret)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const result = await runTick(sb);
  return jsonResponse({ ok: true, ...result });
});

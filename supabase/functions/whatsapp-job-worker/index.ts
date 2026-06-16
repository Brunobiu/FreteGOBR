// ============================================================================
// Edge Function: whatsapp-job-worker
// ============================================================================
// Spec: .kiro/specs/whatsapp-automation/{requirements,design,tasks}.md
//   Task 12.1 — Esqueleto do TICK do drenador de fila durável + claim atomico
//               de jobs elegiveis e do proximo recipient PENDING -> SENDING
//               (idempotencia por destinatario; um SENT NUNCA e reenviado).
//
// O processamento de disparos e SERVER-SIDE e DURAVEL (design.md > Architecture
// "Worker durável"): a fila vive em Postgres e este worker, acionado pelo
// pg_cron a cada minuto (`* * * * *`, SECTION 11 da migration 092 via
// net.http_post/pg_net), drena a fila em background. Cada tick e STATELESS: le
// o estado duravel, faz uma fatia de trabalho e persiste o progresso. Se o tick
// morrer no meio, o proximo tick retoma do proximo Dispatch_Recipient PENDING.
// Nao ha estado em memoria a recuperar — a "recuperacao" e o comportamento
// normal do proximo tick (Recovery_Process, Req 27; task 12.5).
//
// Postura de seguranca (design.md > "Security Posture"):
//   * verify_jwt = FALSE: este endpoint NAO recebe JWT de admin — quem o invoca
//     e o pg_cron (server-to-server). Deploy:
//       supabase functions deploy whatsapp-job-worker --no-verify-jwt
//   * A autenticidade e garantida validando um SEGREDO DE INVOCACAO proprio que
//     SOMENTE o pg_cron conhece, enviado no header `x-worker-secret`. O segredo
//     vive no Vault em `whatsapp_worker_secret` (provisionado fora da migration)
//     e NUNCA trafega ao browser nem aparece em respostas/colunas/logs.
//   * FAIL-CLOSED: segredo ausente/invalido => 401 SEM efeito (nenhuma claim,
//     nenhuma mutacao). O segredo nunca e logado nem ecoado; comparacao em
//     tempo constante (evita timing-attack).
//   * Todo dado externo e tratado como NAO CONFIAVEL; nenhum segredo e ecoado.
//
// ESCOPO DESTA TASK (12.1) — apenas os PRIMITIVOS de claim:
//   1. Valida o segredo de invocacao (401 fail-closed).
//   2. Reivindica os jobs elegiveis (QUEUED|RUNNING) via RPC
//      `whatsapp_claim_due_jobs` (FOR UPDATE SKIP LOCKED, marca RUNNING).
//   3. Para cada job, reivindica ATOMICAMENTE o proximo recipient PENDING ->
//      SENDING via RPC `whatsapp_claim_next_recipient` (idempotencia: um SENT
//      jamais e reivindicado). No esqueleto, como o ENVIO ainda nao existe
//      (task 12.3), o recipient reivindicado e DEVOLVIDO a PENDING (release)
//      para nao ficar preso em SENDING — mantendo o tick um no-op seguro e
//      repetivel ate as proximas tasks ligarem o envio real.
//
// FORA DE ESCOPO (extension points marcados abaixo, NAO implementar aqui):
//   - task 12.2: pacing por relogio (`shouldSendNow`) + quota por execucao
//                (`exec_sent_count >= execution_quota` -> PAUSED).
//   - task 12.3: envio via sessao da instancia (renderMessage no momento do
//                envio), marcacao SENT/FAILED + failure_reason, COMPLETED.
//   - task 12.4: varredura de Scheduled_Dispatches vencidos -> QUEUED.
//   - task 12.5: recuperacao fina (SENDING orfao, jobs inconsistentes ->
//                JOB_FAILED) e semantica de retomada por estado.
//
// Contrato de requisicao (POST, JSON; corpo do pg_cron e opcional/ignorado):
//   headers: { 'x-worker-secret': '<segredo do Vault>' }
//   body:    { source?: string, invoked_at?: string }   // tratado como dado nao confiavel
//
// Contrato de resposta (JSON):
//   sucesso:        200 { ok: true, jobsClaimed: number, recipientsClaimed: number }
//   segredo invalido: 401 { ok: false, error: 'unauthorized' }
//   metodo != POST:   405 { ok: false, error: 'method_not_allowed' }
//
// Env vars:
//   SUPABASE_URL               (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injetado) — chama as RPCs de claim (que
//                              sao GRANTed apenas a service_role) e le o Vault.
//   WHATSAPP_WORKER_SECRET     (opcional) — segredo de invocacao esperado; se
//                              ausente, cai no segredo de Vault
//                              `whatsapp_worker_secret`.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===================== Env ==================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_SECRET_ENV = Deno.env.get('WHATSAPP_WORKER_SECRET') ?? '';

// Teto defensivo de jobs reivindicados por tick (alinhado ao p_limit da RPC).
const MAX_JOBS_PER_TICK = 50;

// ===================== Helpers de I/O =======================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Comparacao de strings em tempo constante (evita timing-attack na validacao do
 * segredo de invocacao). Difere imediatamente apenas no tamanho — o segredo
 * nunca e logado nem ecoado.
 */
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ===================== Segredo de invocacao (env -> Vault) ==================

// Cache em memoria do segredo esperado (resolvido uma vez por cold start). `null`
// = ainda nao resolvido.
let cachedExpectedSecret: string | null = null;

/**
 * Resolve o segredo de invocacao esperado: env `WHATSAPP_WORKER_SECRET` tem
 * prioridade; fallback no segredo de Vault `whatsapp_worker_secret` (lido via
 * service-role — o mesmo nome usado pelo pg_cron na SECTION 11 da migration
 * 092). Retorna string vazia quando nenhum esta configurado (validacao SEMPRE
 * falha => 401, fail-closed). O valor nunca e logado nem retornado.
 */
async function resolveExpectedSecret(sb: SupabaseClient): Promise<string> {
  if (cachedExpectedSecret !== null) return cachedExpectedSecret;

  let secret = WORKER_SECRET_ENV.trim();
  if (!secret) {
    try {
      const { data } = await sb
        .schema('vault')
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('name', 'whatsapp_worker_secret')
        .limit(1)
        .maybeSingle();
      const value = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof value === 'string') secret = value.trim();
    } catch {
      // sem vault exposto / segredo ausente => vazio (fail-closed)
    }
  }
  cachedExpectedSecret = secret;
  return secret;
}

/**
 * Extrai o segredo apresentado pelo invocador no header dedicado
 * `x-worker-secret` (o mesmo header que o pg_cron envia). Header e dado nao
 * confiavel; retornamos string vazia quando ausente.
 */
function extractPresentedSecret(req: Request): string {
  return (req.headers.get('x-worker-secret') ?? '').trim();
}

// ===================== Tipos do dominio (claim) =============================

/** Job reivindicado (subconjunto retornado por whatsapp_claim_due_jobs). */
interface ClaimedJob {
  id: string;
  instance_id: string;
  kind: string;
  status: string;
  // Campos consumidos pelas tasks 12.2/12.3 (pacing/quota/envio):
  send_interval_sec: number;
  execution_quota: number | null;
  exec_sent_count: number;
  last_send_at: string | null;
}

/** Extrai os jobs reivindicados de um retorno jsonb (array) nao tipado. */
function parseClaimedJobs(data: unknown): ClaimedJob[] {
  if (!Array.isArray(data)) return [];
  const out: ClaimedJob[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string' || typeof obj.instance_id !== 'string') continue;
    out.push({
      id: obj.id,
      instance_id: obj.instance_id,
      kind: typeof obj.kind === 'string' ? obj.kind : '',
      status: typeof obj.status === 'string' ? obj.status : '',
      send_interval_sec: typeof obj.send_interval_sec === 'number' ? obj.send_interval_sec : 0,
      execution_quota: typeof obj.execution_quota === 'number' ? obj.execution_quota : null,
      exec_sent_count: typeof obj.exec_sent_count === 'number' ? obj.exec_sent_count : 0,
      last_send_at: typeof obj.last_send_at === 'string' ? obj.last_send_at : null,
    });
  }
  return out;
}

/** Extrai o id do recipient reivindicado (ou null se nenhum). */
function parseClaimedRecipientId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

// ===================== Primitivos de claim (RPCs da migration 103) ==========

/**
 * Reivindica os jobs elegiveis (QUEUED|RUNNING) via RPC SECURITY DEFINER
 * `whatsapp_claim_due_jobs` (FOR UPDATE SKIP LOCKED; marca RUNNING + started_at).
 * Erro de RPC => lista vazia (o tick e best-effort; o proximo tick re-tenta).
 */
async function claimDueJobs(sb: SupabaseClient, limit: number): Promise<ClaimedJob[]> {
  try {
    const { data, error } = await sb.rpc('whatsapp_claim_due_jobs', { p_limit: limit });
    if (error) return [];
    return parseClaimedJobs(data);
  } catch {
    return [];
  }
}

/**
 * Reivindica ATOMICAMENTE o proximo recipient PENDING do job (PENDING ->
 * SENDING) via RPC `whatsapp_claim_next_recipient`. Idempotencia por
 * destinatario: um recipient SENT/FAILED/SKIPPED jamais e reivindicado. Sem
 * PENDING (ou erro) => null.
 */
async function claimNextRecipient(sb: SupabaseClient, jobId: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('whatsapp_claim_next_recipient', {
      p_job_id: jobId,
    });
    if (error) return null;
    return parseClaimedRecipientId(data);
  } catch {
    return null;
  }
}

/**
 * SKELETON-ONLY (task 12.1): devolve um recipient reivindicado de volta a
 * PENDING (SENDING -> PENDING), evitando que ele fique preso em SENDING enquanto
 * o ENVIO real (task 12.3) nao existe. Idempotente e seguro: so afeta a linha
 * que este tick acabou de reivindicar e somente se ainda estiver em SENDING.
 *
 * >>> Sera REMOVIDO na task 12.3: no lugar deste release entrara o fluxo
 *     render + sendMessage + marcacao SENT/FAILED (ver extension point abaixo).
 */
async function releaseRecipient(sb: SupabaseClient, recipientId: string): Promise<void> {
  try {
    await sb
      .from('whatsapp_dispatch_recipients')
      .update({ status: 'PENDING' })
      .eq('id', recipientId)
      .eq('status', 'SENDING');
  } catch {
    // best-effort: se falhar, a task 12.5 (recuperacao de SENDING orfao) cobre.
  }
}

// ===================== Tick =================================================

/**
 * Executa um tick do worker (escopo task 12.1): reivindica os jobs elegiveis e,
 * por job, reivindica o proximo recipient PENDING (demonstrando os primitivos
 * atomicos). Como o envio nao existe ainda, o recipient e devolvido a PENDING.
 *
 * Retorna contadores para observabilidade (sem nenhum dado de PII/segredo).
 */
async function runTick(sb: SupabaseClient): Promise<{
  jobsClaimed: number;
  recipientsClaimed: number;
}> {
  const jobs = await claimDueJobs(sb, MAX_JOBS_PER_TICK);
  let recipientsClaimed = 0;

  for (const _job of jobs) {
    // ========================================================================
    // >>> EXTENSION POINT (task 12.2 — pacing + quota) <<<
    // Antes de reivindicar/enviar, o worker decidira por job se PODE enviar
    // agora:
    //   - pacing por relogio: `shouldSendNow(now, last_send_at, send_interval_sec)`
    //     (Req 8.6); se ainda nao venceu, encerra a fatia deste job (sem claim)
    //     e aguarda o proximo tick.
    //   - quota por execucao: se `exec_sent_count >= execution_quota`, transiciona
    //     o job para PAUSED quando restam PENDING (Req 8.5, 8.7).
    // ========================================================================

    // Claim atomico do proximo recipient PENDING -> SENDING (task 12.1).
    // Idempotencia: um recipient ja SENT nunca e reivindicado de novo.
    const recipientId = await claimNextRecipient(sb, _job.id);
    if (recipientId === null) {
      // Sem PENDING para este job no momento.
      // >>> EXTENSION POINT (task 12.3 — COMPLETED): quando NAO ha mais PENDING
      //     e nada esta SENDING, o job sera transicionado para COMPLETED
      //     (completed_at = now), Req 10.7.
      continue;
    }

    recipientsClaimed++;

    // ========================================================================
    // >>> EXTENSION POINT (task 12.3 — envio + marcacao) <<<
    // Aqui entrara, para o recipient reivindicado:
    //   1. render da mensagem (renderMessage(template, recipient_data) no
    //      momento do envio — Req 25.2), usando a sessao da PROPRIA instancia;
    //   2. envio via Evolution API (sendMessage) lendo a Evolution_Api_Key do
    //      Vault escopada por instancia;
    //   3. sucesso => SENT + provider_message_id, last_send_at = now,
    //      exec_sent_count++, sent_count++ (Req 10.3, 10.6);
    //      falha => FAILED + failure_reason (pt-BR, sem segredos), prossegue
    //      (Req 10.6, 10.9).
    // Enquanto isso NAO existe, devolvemos o recipient a PENDING para nao deixa-
    // lo preso em SENDING (skeleton-only; ver releaseRecipient).
    // ========================================================================
    await releaseRecipient(sb, recipientId);
  }

  // ==========================================================================
  // >>> EXTENSION POINT (task 12.4 — scheduled sweep) <<<
  // No inicio do tick (antes do claim de jobs) entrara a varredura de
  // Scheduled_Dispatches vencidos: `scheduled_at <= now AND executed_at IS NULL`
  // -> QUEUED (Req 13.3), executando na primeira varredura apos indisponibilidade
  // (Req 13.6, 27.4).
  //
  // >>> EXTENSION POINT (task 12.5 — recuperacao) <<<
  // Retomada por estado (QUEUED/RUNNING retomam do proximo PENDING; PAUSED
  // permanece), recuperacao de SENDING orfao e marcacao de job inconsistente
  // como FAILED/JOB_FAILED seguindo com os demais (Req 27).
  // ==========================================================================

  return { jobsClaimed: jobs.length, recipientsClaimed };
}

// ===================== Handler ==============================================

Deno.serve(async (req: Request): Promise<Response> => {
  // O pg_cron invoca via POST. Outros metodos => 405 (sem efeito).
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Autenticidade: segredo de invocacao no header `x-worker-secret`. Falha
  //    => 401, SEM efeito (fail-closed). Nunca revelamos o motivo nem ecoamos
  //    o segredo. Comparacao em tempo constante.
  const expectedSecret = await resolveExpectedSecret(sb);
  const presentedSecret = extractPresentedSecret(req);
  if (!expectedSecret || !safeEq(presentedSecret, expectedSecret)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  // 2. Tick: claim atomico de jobs + recipients (task 12.1). Best-effort —
  //    qualquer falha pontual e re-tentada no proximo tick (durabilidade).
  const result = await runTick(sb);

  return jsonResponse({
    ok: true,
    jobsClaimed: result.jobsClaimed,
    recipientsClaimed: result.recipientsClaimed,
  });
});

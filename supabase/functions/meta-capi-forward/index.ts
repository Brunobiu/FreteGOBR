// ============================================================================
// Edge Function: meta-capi-forward  (admin-marketing 048, task 6.3)
// ============================================================================
// Spec: .kiro/specs/admin-marketing/{requirements,design,tasks}.md
//   Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 11.6, 12.2
//
// Meta_CAPI_Function: encaminha Tracked_Events server-side a Meta via Conversions
// API (CAPI), compartilhando o mesmo `event_id` do disparo do Pixel no browser
// para que a Meta faca a deduplicacao (CP-4). Toda PII (email/phone/visitor/user)
// e normalizada e hasheada em SHA-256 antes do envio e da persistencia (CP-6);
// PII em texto claro NUNCA e persistida nem retornada (Req 11.6). O
// Meta_Access_Token e lido EXCLUSIVAMENTE do Vault server-side e NUNCA aparece
// em respostas, logs de cliente ou mensagens de erro (CP-7, Req 12.2).
//
// Comportamento (design.md secao 4 "meta-capi-forward"):
//  1. Valida Bearer service-role (padrao send-push-notification).
//  2. Valida `event_name in Tracked_Event` e `event_id` UUID v4 valido.
//  3. normalizePII + hashPII (SHA-256) de email/phone/visitor/user; valores ja
//     hasheados NAO sao re-hasheados (CP-6, Req 11.5).
//  4. upsert em marketing_events ON CONFLICT (event_id) DO UPDATE — reenvio nao
//     duplica o log (dedup, Req 9.8). Registra event_id/event_name/hashes/
//     event_time/send_status (Req 9.5).
//  5. Envia o evento a Meta CAPI com o `event_id` compartilhado + dados hasheados,
//     lendo o token do Vault (Req 9.2, 9.7).
//  6. Falha CAPI (ou token ausente) => send_status='failed' + erro estruturado
//     sem segredos (Req 9.6).
//
// Deploy (verify_jwt = FALSE — chamada server-side via trigger/pg_net injeta o
// SERVICE_ROLE como Bearer, NAO um JWT de user; a validacao ocorre dentro desta
// function checando o Bearer, mesmo padrao de send-push-notification):
//   supabase functions deploy meta-capi-forward --no-verify-jwt
//
// Env vars necessarias:
//   SUPABASE_URL                (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injetado) — le config + Vault, grava log
//   META_GRAPH_API_VERSION      (opcional, default 'v21.0')
//   META_CAPI_DEV_LOG           (opcional, 'true' => nao envia a Meta, so loga)
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  hashPII,
  isPiiHash,
  isTrackedEvent,
  isUuidV4,
  META_EVENT_MAP,
  normalizeEmail,
  normalizePhone,
  type TrackedEvent,
} from '../_shared/marketing.ts';

// ===================== Env + helpers de I/O =================================

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v21.0';
const DEV_LOG = Deno.env.get('META_CAPI_DEV_LOG') === 'true';

/** Nome estavel do segredo no Vault (paridade com migration 048 token_set). */
const META_TOKEN_SECRET_NAME = 'meta_access_token';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ===================== Contrato de entrada/saida ============================

/**
 * Payload de entrada. `event_name` e `event_id` sao obrigatorios; os campos de
 * PII sao opcionais e podem chegar em texto claro (serao normalizados+hasheados)
 * OU ja no formato de PII_Hash (64 hex minusculos) — nesse caso NAO sao
 * re-hasheados (CP-6).
 */
interface ForwardPayload {
  event_name?: string;
  event_id?: string;
  email?: string | null;
  phone?: string | null;
  visitor_id?: string | null;
  user_id?: string | null;
  event_time?: string | null; // ISO; default = agora
  event_source_url?: string | null; // opcional, repassado a Meta
  action_source?: string | null; // opcional, default 'website'
  test_event_code?: string | null; // opcional, para o Test Events da Meta
}

/** Conjunto de hashes derivados da PII (todos opcionais). */
interface HashedPii {
  email_hash: string | null;
  phone_hash: string | null;
  visitor_id_hash: string | null;
  user_id_hash: string | null;
}

// ===================== Hashing de PII (CP-6) ================================
// Importante: verificar isPiiHash ANTES de normalizar. Para telefone, a
// normalizacao (so digitos) corromperia um hash hex ja pronto; por isso o
// short-circuit por isPiiHash acontece antes de qualquer normalizacao.

/** Hash de email: ja-hash => inalterado; senao trim+lowercase e SHA-256. */
async function hashEmailField(raw: string): Promise<string> {
  if (isPiiHash(raw)) return raw;
  return await hashPII(normalizeEmail(raw));
}

/** Hash de telefone: ja-hash => inalterado; senao so-digitos+DDI e SHA-256. */
async function hashPhoneField(raw: string): Promise<string> {
  if (isPiiHash(raw)) return raw;
  return await hashPII(normalizePhone(raw));
}

/** Hash de id (visitor/user): ja-hash => inalterado; senao trim e SHA-256. */
async function hashIdField(raw: string): Promise<string> {
  if (isPiiHash(raw)) return raw;
  return await hashPII(raw.trim());
}

/**
 * Deriva os hashes de PII a partir do payload. Campos ausentes/vazios viram
 * NULL (nunca persistimos PII em claro — Req 11.6, CP-6).
 */
async function deriveHashes(payload: ForwardPayload): Promise<HashedPii> {
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const visitor = typeof payload.visitor_id === 'string' ? payload.visitor_id.trim() : '';
  const user = typeof payload.user_id === 'string' ? payload.user_id.trim() : '';

  return {
    email_hash: email.length > 0 ? await hashEmailField(email) : null,
    phone_hash: phone.length > 0 ? await hashPhoneField(phone) : null,
    visitor_id_hash: visitor.length > 0 ? await hashIdField(visitor) : null,
    user_id_hash: user.length > 0 ? await hashIdField(user) : null,
  };
}

// ===================== Leitura do token no Vault (CP-7) =====================

/**
 * Le o Meta_Access_Token EXCLUSIVAMENTE do Vault via service-role client.
 * Retorna `null` quando ausente. NUNCA loga nem retorna o valor bruto
 * (CP-7, Req 9.7, 12.2).
 *
 * Estrategia em duas camadas (espelha o padrao da Edge assistant-ai):
 *   1. Caminho direto via `.schema('vault').from('decrypted_secrets')`. So
 *      funciona quando o schema `vault` esta exposto ao Data API
 *      (Settings > API > Exposed schemas). Quando exposto, e o caminho
 *      preferencial.
 *   2. Fallback via RPC `public.marketing_token_read_secret(uuid)`
 *      (SECURITY DEFINER, GRANT EXECUTE TO service_role). Permite ler o
 *      Vault sem expor o schema, mantendo a leitura sempre server-side.
 *
 * O segredo e gravado pela RPC `marketing_token_set` (migration 048) sob o
 * nome estavel `meta_access_token`; o id retornado pela criacao e guardado
 * em `marketing_config.token_secret_id`. Aqui localizamos o id pelo nome (no
 * caminho direto) ou usamos a coluna `token_secret_id` (no fallback por RPC).
 */
async function readMetaTokenFromVault(sb: SupabaseClient): Promise<string | null> {
  // ---------- Caminho 1: schema vault exposto ao Data API ----------
  try {
    const { data, error } = await sb
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
    // cai no fallback por RPC
  }

  // ---------- Caminho 2 (fallback): RPC public.marketing_token_read_secret ----------
  // A RPC le pelo id; precisamos buscar o token_secret_id na config. Como o
  // service-role bypassa RLS, podemos consultar `marketing_config` direto.
  try {
    const { data: cfg, error: cfgErr } = await sb
      .from('marketing_config')
      .select('token_secret_id')
      .eq('singleton', true)
      .limit(1)
      .maybeSingle();
    if (cfgErr) return null;
    const tokenSecretId = (cfg as { token_secret_id?: unknown } | null)?.token_secret_id;
    if (typeof tokenSecretId !== 'string' || tokenSecretId.length === 0) return null;

    const { data, error } = await sb.rpc('marketing_token_read_secret', {
      p_secret_id: tokenSecretId,
    });
    if (error) return null;
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

// ===================== Envio a Meta CAPI ====================================

interface CapiResult {
  ok: boolean;
  error?: string; // categoria/codigo SEM segredos
  status?: number; // status HTTP de origem, quando aplicavel
}

/**
 * Monta o `user_data` da CAPI a partir dos hashes (Meta exige SHA-256). Campos
 * ausentes sao omitidos. `external_id` agrega user_id_hash e visitor_id_hash.
 */
function buildUserData(hashes: HashedPii): Record<string, string[]> {
  const userData: Record<string, string[]> = {};
  if (hashes.email_hash) userData.em = [hashes.email_hash];
  if (hashes.phone_hash) userData.ph = [hashes.phone_hash];
  const externalIds: string[] = [];
  if (hashes.user_id_hash) externalIds.push(hashes.user_id_hash);
  if (hashes.visitor_id_hash) externalIds.push(hashes.visitor_id_hash);
  if (externalIds.length > 0) userData.external_id = externalIds;
  return userData;
}

/**
 * Envia o evento a Meta CAPI com o `event_id` compartilhado + dados hasheados.
 * O `access_token` vai no CORPO do POST (nunca na URL) e NUNCA e logado (CP-7).
 * Em DEV_LOG, apenas loga e simula sucesso (sem chamar a Meta).
 */
async function sendToCapi(input: {
  pixelId: string;
  token: string;
  metaEventName: string;
  eventId: string;
  eventTimeIso: string;
  userData: Record<string, string[]>;
  eventSourceUrl: string | null;
  actionSource: string;
  testEventCode: string | null;
}): Promise<CapiResult> {
  const eventTimeUnix = Math.floor(new Date(input.eventTimeIso).getTime() / 1000);

  const eventData: Record<string, unknown> = {
    event_name: input.metaEventName,
    event_time: eventTimeUnix,
    event_id: input.eventId,
    action_source: input.actionSource,
    user_data: input.userData,
  };
  if (input.eventSourceUrl) eventData.event_source_url = input.eventSourceUrl;

  const body: Record<string, unknown> = {
    data: [eventData],
    access_token: input.token,
  };
  if (input.testEventCode) body.test_event_code = input.testEventCode;

  if (DEV_LOG) {
    // Nunca loga o corpo (contem o token). So metadados nao sensiveis.
    console.log(
      `[DEV][meta-capi-forward] event=${input.metaEventName} event_id=${input.eventId} ` +
        `keys=${Object.keys(input.userData).join(',') || 'none'}`
    );
    return { ok: true };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${input.pixelId}/events`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) return { ok: true, status: resp.status };
    // Lemos o texto apenas para classificar; NAO o repassamos ao cliente (pode
    // conter detalhes do request, ainda que nao o token). Logamos so o status.
    await resp.text().catch(() => '');
    console.warn(
      `[meta-capi-forward] CAPI respondeu status=${resp.status} event_id=${input.eventId}`
    );
    return { ok: false, error: 'META_API_ERROR', status: resp.status };
  } catch (err) {
    // Erro de rede/timeout — mensagem generica, sem segredos.
    console.warn(
      `[meta-capi-forward] falha de rede ao chamar CAPI event_id=${input.eventId}: ` +
        `${err instanceof Error ? err.name : 'erro'}`
    );
    return { ok: false, error: 'META_API_UNAVAILABLE' };
  }
}

// ===================== Persistencia (dedup por event_id) ====================

/**
 * Upsert em marketing_events por event_id (UNIQUE) — dedup: reenvio nao duplica
 * o log (Req 9.8). Persiste APENAS hashes (nunca PII em claro — Req 11.6, CP-6)
 * + event_name + event_time + send_status. ON CONFLICT (event_id) DO UPDATE
 * atualiza o status (ex.: um 'failed' anterior vira 'sent' num reenvio).
 */
async function upsertEvent(
  sb: SupabaseClient,
  input: {
    eventId: string;
    eventName: TrackedEvent;
    eventTimeIso: string;
    hashes: HashedPii;
    sendStatus: 'sent' | 'failed';
  }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('marketing_events').upsert(
    {
      event_id: input.eventId,
      event_name: input.eventName,
      visitor_id_hash: input.hashes.visitor_id_hash,
      user_id_hash: input.hashes.user_id_hash,
      email_hash: input.hashes.email_hash,
      phone_hash: input.hashes.phone_hash,
      event_time: input.eventTimeIso,
      send_status: input.sendStatus,
    },
    { onConflict: 'event_id' }
  );
  if (error) {
    console.warn(`[meta-capi-forward] erro ao upsert marketing_events event_id=${input.eventId}`);
    return { ok: false, error: 'PERSIST_FAILED' };
  }
  return { ok: true };
}

// ===================== Handler ==============================================

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  // ---------- Auth: aceita exclusivamente Bearer SERVICE_ROLE_KEY ----------
  // verify_jwt=false => validamos o Bearer aqui (server-only). Nenhuma sessao
  // de usuario do browser invoca esta function (o browser nao tem a service key).
  const auth = req.headers.get('Authorization') ?? '';
  if (!SERVICE_ROLE_KEY || auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server_misconfigured' }, 500);
  }

  // ---------- Parse + validacao de dominio ----------
  let payload: ForwardPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (!isTrackedEvent(payload.event_name)) {
    return json({ ok: false, error: 'INVALID_EVENT_NAME' }, 400);
  }
  if (!isUuidV4(payload.event_id)) {
    return json({ ok: false, error: 'INVALID_EVENT_ID' }, 400);
  }

  // A partir daqui os type guards garantem os tipos.
  const eventName: TrackedEvent = payload.event_name;
  const eventId: string = payload.event_id;
  const eventTimeIso =
    typeof payload.event_time === 'string' && !Number.isNaN(Date.parse(payload.event_time))
      ? new Date(payload.event_time).toISOString()
      : new Date().toISOString();
  const eventSourceUrl =
    typeof payload.event_source_url === 'string' && payload.event_source_url.length > 0
      ? payload.event_source_url
      : null;
  const actionSource =
    typeof payload.action_source === 'string' && payload.action_source.length > 0
      ? payload.action_source
      : 'website';
  const testEventCode =
    typeof payload.test_event_code === 'string' && payload.test_event_code.length > 0
      ? payload.test_event_code
      : null;

  // ---------- Hash de PII (CP-6) — nunca persistimos PII em claro ----------
  const hashes = await deriveHashes(payload);

  // Service-role client: le config + Vault e grava o log server-side (RLS
  // bypassada por design — mesmo padrao de send-push-notification).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---------- Pre-requisitos do envio: pixel_id (config) + token (Vault) ----------
  const { data: cfg, error: cfgErr } = await supabase
    .from('marketing_config')
    .select('pixel_id')
    .eq('singleton', true)
    .limit(1)
    .maybeSingle();

  const pixelId =
    !cfgErr && cfg && typeof (cfg as { pixel_id?: unknown }).pixel_id === 'string'
      ? ((cfg as { pixel_id: string }).pixel_id as string)
      : null;

  const token = await readMetaTokenFromVault(supabase);

  // ---------- Envio a Meta CAPI (event_id compartilhado + hashes) ----------
  let capi: CapiResult;
  if (!token) {
    capi = { ok: false, error: 'TOKEN_NOT_CONFIGURED' };
  } else if (!pixelId) {
    capi = { ok: false, error: 'PIXEL_NOT_CONFIGURED' };
  } else {
    capi = await sendToCapi({
      pixelId,
      token,
      metaEventName: META_EVENT_MAP[eventName],
      eventId,
      eventTimeIso,
      userData: buildUserData(hashes),
      eventSourceUrl,
      actionSource,
      testEventCode,
    });
  }

  const sendStatus: 'sent' | 'failed' = capi.ok ? 'sent' : 'failed';

  // ---------- Persiste o evento (dedup por event_id, Req 9.5/9.6/9.8) ----------
  // Persistimos SEMPRE — inclusive em falha (Req 9.6 grava send_status='failed').
  const persist = await upsertEvent(supabase, {
    eventId,
    eventName,
    eventTimeIso,
    hashes,
    sendStatus,
  });

  // ---------- Resposta estruturada (sem segredos nem PII em claro, CP-7) ----------
  if (!capi.ok) {
    // Falha CAPI/token/pixel: send_status='failed' ja persistido; erro estruturado.
    const responseBody: Record<string, unknown> = {
      ok: false,
      event_id: eventId,
      send_status: 'failed',
      error: capi.error ?? 'META_API_UNAVAILABLE',
    };
    if (typeof capi.status === 'number') responseBody.status = capi.status;
    if (!persist.ok) responseBody.persist_error = persist.error;
    return json(responseBody, 200);
  }

  if (!persist.ok) {
    // CAPI ok mas a persistencia do log falhou — sinaliza sem vazar segredos.
    return json({ ok: false, event_id: eventId, send_status: 'sent', error: persist.error }, 200);
  }

  return json({ ok: true, event_id: eventId, send_status: 'sent' });
});

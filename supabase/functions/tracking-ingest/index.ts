// ============================================================================
// Edge Function: tracking-ingest
// ============================================================================
// Spec: .kiro/specs/admin-rastreamento-inteligente/{requirements,design,tasks}.md
//   Task 7.1 — Journey_Ingest_Endpoint: ingestao WRITE-ONLY de Journey_Event a
//   partir das tres superficies (site/dashboard/app).
//
// Caso de uso EXPLICITAMENTE anonimo (como is_blacklisted): o site publico
// emite eventos sem sessao. Por isso esta function deve ser publicada com
//   supabase functions deploy tracking-ingest --no-verify-jwt
// A autorizacao real e do banco: a RPC `rpc_tracking_ingest_event` e concedida
// a `anon` + `authenticated` e valida o dominio fechado server-side.
//
// Seguranca / privacidade (Req 3.5, 3.6, 3.7, 3.8):
//   * WRITE-ONLY: a resposta NUNCA carrega jornada, contagem por usuario ou
//     existencia de usuario. So `{ ok: true }` ou `{ ok: false, error: 'INVALID_EVENT_TYPE' }`.
//   * Identidade: encaminha o header Authorization do caller para que
//     `auth.uid()` resolva o `user_id` server-side quando autenticado; anonimo
//     (sem header) cai no `visitor_id`. NUNCA confia em `user_id` vindo do corpo.
//   * Payload minimo: somente uma allowlist de chaves NAO sensiveis e repassada
//     (sem CPF/e-mail/telefone/nome/token/senha). Tudo fora da allowlist e
//     descartado na borda.
//   * Lote pequeno: ate 50 eventos por chamada (a RPC tambem limita/rate-limita).
//
// Contrato de resposta (JSON):
//   metodo != POST:        405 { ok: false, error: 'method_not_allowed' }
//   JSON invalido / vazio: 400 { ok: false, error: 'invalid_payload' }
//   algum evento invalido: 200 { ok: false, error: 'INVALID_EVENT_TYPE' }
//   sucesso:               200 { ok: true }
//
// Env vars (auto-injetadas pela plataforma):
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handlePreflight, withCors } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Dominio fechado de Journey_Event_Type (espelha a migration 124 e domain.ts). */
const EVENT_TYPES = new Set<string>([
  'SITE_VISIT', 'SIGNUP_STARTED', 'SIGNUP_COMPLETED', 'SIGNUP_ABANDONED',
  'DOCUMENT_UPLOAD_STARTED', 'DOCUMENT_UPLOAD_FAILED', 'DOCUMENT_APPROVED',
  'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'CHECKOUT_STARTED', 'CHECKOUT_ABANDONED',
  'PAYMENT_STARTED', 'PAYMENT_FAILED', 'PAYMENT_SUCCEEDED', 'SUBSCRIPTION_ACTIVATED',
  'APP_OPENED', 'APP_CRASH', 'FREIGHT_VIEWED', 'FREIGHT_IGNORED', 'FREIGHT_ACCEPTED',
  'FIRST_FREIGHT_COMPLETED', 'INACTIVITY_DETECTED', 'INTERNAL_ERROR', 'NETWORK_TIMEOUT',
]);

/** Dominio fechado de Journey_Surface. */
const SURFACES = new Set<string>(['SITE', 'DASHBOARD', 'APP']);

/** Chaves de payload NAO sensiveis permitidas (allowlist anti-PII). */
const PAYLOAD_ALLOWLIST = new Set<string>([
  'path', 'screen', 'step', 'ref', 'source', 'reason', 'code', 'plan', 'feature',
]);

const MAX_BATCH = 50;

function jsonResponse(body: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

/**
 * Sanitiza o payload de um evento: mantem APENAS as chaves da allowlist com
 * valores primitivos (string/number/boolean), truncando strings. Garante que
 * nenhuma PII chegue ao banco, mesmo se o cliente enviar campos extras.
 */
function sanitizePayload(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PAYLOAD_ALLOWLIST.has(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Forma normalizada de um evento aceito para encaminhar a RPC. */
interface NormalizedEvent {
  event_type: string;
  surface: string;
  visitor_id: string | null;
  occurred_at: string | null;
  payload: Record<string, string | number | boolean>;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  // Parse defensivo do corpo (dado nao confiavel).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_payload' }, 400);
  }

  // Aceita { events: [...] } ou um array direto.
  const rawEvents = Array.isArray(body)
    ? body
    : Array.isArray((body as { events?: unknown })?.events)
      ? (body as { events: unknown[] }).events
      : null;
  if (rawEvents === null || rawEvents.length === 0) {
    return jsonResponse({ ok: false, error: 'invalid_payload' }, 400);
  }

  // Normaliza/valida na borda (defesa em profundidade; a RPC revalida).
  let sawInvalidType = false;
  const normalized: NormalizedEvent[] = [];
  for (const item of rawEvents.slice(0, MAX_BATCH)) {
    if (item === null || typeof item !== 'object') {
      sawInvalidType = true;
      continue;
    }
    const obj = item as Record<string, unknown>;
    const eventType = typeof obj.event_type === 'string' ? obj.event_type : '';
    const surface = typeof obj.surface === 'string' ? obj.surface : '';
    if (!EVENT_TYPES.has(eventType) || !SURFACES.has(surface)) {
      sawInvalidType = true;
      continue;
    }
    const visitorId =
      typeof obj.visitor_id === 'string' && obj.visitor_id.length > 0
        ? obj.visitor_id.slice(0, 80)
        : null;
    const occurredAt = typeof obj.occurred_at === 'string' ? obj.occurred_at : null;
    normalized.push({
      event_type: eventType,
      surface,
      visitor_id: visitorId,
      occurred_at: occurredAt,
      payload: sanitizePayload(obj.payload),
    });
  }

  // Cliente que PRESERVA a identidade do caller: encaminha o Authorization para
  // que `auth.uid()` resolva server-side. Sem header => contexto anon.
  const authHeader = req.headers.get('Authorization');
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Mesmo sem nenhum evento valido, chamamos com lista vazia? Nao: se nada valido
  // e houve invalido, retorna INVALID_EVENT_TYPE sem tocar o banco (anti-enum).
  if (normalized.length > 0) {
    try {
      const { error } = await sb.rpc('rpc_tracking_ingest_event', { p_events: normalized });
      if (error) {
        // Falha de RPC e contida: nunca vaza detalhe. Cliente pode reenviar.
        return jsonResponse({ ok: false, error: 'ingest_failed' }, 200);
      }
    } catch {
      return jsonResponse({ ok: false, error: 'ingest_failed' }, 200);
    }
  }

  // Write-only: resposta minima. Algum tipo invalido no lote => INVALID_EVENT_TYPE.
  if (sawInvalidType) {
    return jsonResponse({ ok: false, error: 'INVALID_EVENT_TYPE' }, 200);
  }
  return jsonResponse({ ok: true }, 200);
});

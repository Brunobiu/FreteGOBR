// ============================================================================
// Edge Function: login-otp-verify
// ============================================================================
// Spec: .kiro/specs/login-sem-senha/{requirements,design,tasks}.md
//
// Login sem senha: recebe POST { identifier, code } do browser (anon) e:
//   1. valida o código via RPC `verify_login_otp` (autoridade no banco);
//   2. em sucesso, emite a sessão via `auth.admin.generateLink({type:'magiclink'})`
//      e retorna o `token_hash` ao cliente, que faz `verifyOtp({token_hash})`
//      para estabelecer a `Sessao_Supabase`.
//
// Postura de segurança:
//   * verify_jwt = FALSE (o usuário ainda NÃO está logado — é o ponto do login).
//     A segurança é o PRÓPRIO código OTP (precisa estar correto) + rate limit
//     (em request_login_otp) + anti-enumeração + uso único.
//   * service role usado SOMENTE aqui (server-side) para verify + generateLink;
//     o cliente nunca recebe service role.
//   * Respostas neutras (não revelam conta) + tempo mínimo de resposta
//     (anti-timing). NUNCA loga código, token_hash, e-mail ou segredos.
//
// Deploy: supabase functions deploy login-otp-verify --no-verify-jwt
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetadas).
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS, handlePreflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Tempo mínimo de resposta (ms) para mitigar timing-attacks (espelha auth.ts).
const MIN_RESPONSE_MS = 500;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ensureMinTime(startMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const start = Date.now();

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let body: { identifier?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
  }

  const identifier = (body.identifier ?? '').trim();
  const code = (body.code ?? '').trim();
  if (!identifier || !code) {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'unavailable' }, 200);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // (1) Valida o código (autoridade no banco). Resposta neutra em qualquer falha.
  let status: string | undefined;
  let email: string | undefined;
  try {
    const { data, error } = await sb.rpc('verify_login_otp', {
      p_identifier: identifier,
      p_code: code,
    });
    if (error) {
      await ensureMinTime(start);
      return jsonResponse({ ok: false, error: 'invalid_code' }, 200);
    }
    const result = (data ?? {}) as { status?: string; email?: string };
    status = result.status;
    email = result.email;
  } catch {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'invalid_code' }, 200);
  }

  if (status !== 'OK' || !email) {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'invalid_code' }, 200);
  }

  // (2) Emite a sessão: magiclink → token_hash (trocado por sessão no cliente).
  try {
    const { data, error } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
    if (error || !tokenHash) {
      await ensureMinTime(start);
      return jsonResponse({ ok: false, error: 'session_failed' }, 200);
    }
    await ensureMinTime(start);
    return jsonResponse({ ok: true, token_hash: tokenHash });
  } catch {
    await ensureMinTime(start);
    return jsonResponse({ ok: false, error: 'session_failed' }, 200);
  }
});

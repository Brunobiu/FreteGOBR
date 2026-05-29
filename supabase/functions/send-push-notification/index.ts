// ============================================================================
// Edge Function: send-push-notification
// ============================================================================
// Spec: .kiro/specs/mobile-app-capacitor/{design,tasks}.md
//
// Recebe POST com:
//   { notification_id, user_id, type, title, message, link }
//
// Comportamento:
//  1. Le todos os device_tokens do user_id.
//  2. Para tokens Android, dispara via FCM HTTP v1.
//  3. Para tokens iOS, dispara via APN (placeholder Phase 2).
//  4. Tokens invalidos / expirados sao removidos.
//
// Deploy:
//   supabase functions deploy send-push-notification --no-verify-jwt
//
// Por que `--no-verify-jwt`: a Edge eh chamada via pg_net do trigger SQL,
// que injeta o SERVICE_ROLE como Bearer mas NAO um JWT de user. A
// validacao acontece dentro da function checando o Bearer.
//
// Env vars necessarias:
//   SUPABASE_URL                (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injetado)
//   FCM_PROJECT_ID              (Firebase: projetoId)
//   FCM_SERVICE_ACCOUNT_JSON    (JSON inteiro da service account FCM,
//                                gerado em Firebase Console -> Settings ->
//                                Service Accounts -> Generate new private key)
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface Payload {
  notification_id?: string;
  user_id?: string;
  type?: string;
  title?: string;
  message?: string;
  link?: string | null;
}

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') ?? '';
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ─── OAuth2 token cache (FCM HTTP v1 exige access token) ────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  if (!FCM_SERVICE_ACCOUNT_JSON) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON ausente');
  }

  const sa = JSON.parse(FCM_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const b64url = (data: ArrayBuffer | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
    return btoa(String.fromCharCode(...bytes))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  const headerB64 = b64url(JSON.stringify(header));
  const claimsB64 = b64url(JSON.stringify(claims));
  const payload = `${headerB64}.${claimsB64}`;

  // Importa a private key (PEM PKCS8) do service account
  const pem = sa.private_key as string;
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(payload));
  const signatureB64 = b64url(signature);
  const jwt = `${payload}.${signatureB64}`;

  // Troca JWT por access token no Google OAuth2
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Falha OAuth2 FCM: ${resp.status} ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

// ─── FCM v1 send ────────────────────────────────────────────────────────────

interface FcmSendResult {
  ok: boolean;
  invalidToken?: boolean;
  error?: string;
}

async function sendViaFcm(token: string, input: Payload): Promise<FcmSendResult> {
  if (!FCM_PROJECT_ID) {
    return { ok: false, error: 'FCM_PROJECT_ID ausente' };
  }
  try {
    const accessToken = await getFcmAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
    const body = {
      message: {
        token,
        notification: {
          title: input.title ?? 'FreteGO',
          body: input.message ?? '',
        },
        data: {
          notification_id: input.notification_id ?? '',
          type: input.type ?? '',
          link: input.link ?? '',
        },
        android: {
          priority: 'HIGH',
          notification: {
            sound: 'default',
            channel_id: 'fretego_default',
          },
        },
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      return { ok: true };
    }
    const text = await resp.text();
    // Tokens invalidos: UNREGISTERED, INVALID_ARGUMENT
    const invalidToken = /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/i.test(text);
    return { ok: false, invalidToken, error: `FCM ${resp.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Auth: aceita Bearer SERVICE_ROLE_KEY (chamada do trigger SQL via pg_net).
  const auth = req.headers.get('Authorization') ?? '';
  if (!SERVICE_ROLE_KEY || auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!payload.user_id) {
    return json({ error: 'user_id ausente' }, 400);
  }

  // Cliente Supabase service role para ler/limpar tokens
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Le todos os tokens do user
  const { data: tokens, error: tokensErr } = await supabase
    .from('device_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id);

  if (tokensErr) {
    console.error('[send-push] erro ao ler device_tokens', tokensErr);
    return json({ error: 'tokens_read_failed' }, 500);
  }

  if (!tokens || tokens.length === 0) {
    return json({ ok: true, sent: 0, reason: 'no_tokens' });
  }

  let sent = 0;
  let invalid = 0;
  const invalidIds: string[] = [];

  for (const t of tokens) {
    if (t.platform === 'android' || t.platform === 'web') {
      // Web Push tambem usa FCM via mesmo endpoint
      const r = await sendViaFcm(t.token, payload);
      if (r.ok) {
        sent++;
      } else if (r.invalidToken) {
        invalid++;
        invalidIds.push(t.id);
      } else {
        console.warn('[send-push] FCM falhou', r.error);
      }
    } else if (t.platform === 'ios') {
      // APN: Phase 2.
      console.log('[send-push] iOS APN ainda nao implementado');
    }
  }

  // Cleanup: remove tokens invalidos
  if (invalidIds.length > 0) {
    await supabase.from('device_tokens').delete().in('id', invalidIds);
  }

  return json({ ok: true, sent, invalid });
});

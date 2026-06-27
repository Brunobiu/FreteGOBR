// ============================================================================
// Edge Function: send-signup-otp
// ============================================================================
// Spec: .kiro/specs/auth-otp-whatsapp/{requirements,design,tasks}.md
//
// Recebe POST { phone, email, code, force_email } da RPC `request_signup_otp`
// (via pg_net) e despacha o código de verificação:
//   1. force_email = true  → envia direto por e-mail (fallback manual).
//   2. caso normal         → tenta WhatsApp Cloud API (template de autenticação);
//                            em qualquer falha (credenciais ausentes, HTTP != 2xx,
//                            rede/timeout) cai para e-mail com O MESMO código.
// Grava `sent_channel` em `signup_otp_verifications` (best-effort) para que a
// confirmação saiba qual canal foi efetivamente usado.
//
// Segurança:
//   * Aceita Bearer == SUPABASE_SERVICE_ROLE_KEY OU == EDGE_SHARED_SECRET
//     (comparação em tempo constante). A RPC envia o EDGE_SHARED_SECRET do Vault.
//   * Trata toda resposta externa (Cloud API) como dado NÃO confiável.
//   * NUNCA loga o código, o telefone completo ou segredos.
//
// Env vars:
//   SUPABASE_URL                     (auto-injetada) — base p/ chamar a Edge de e-mail
//   SUPABASE_SERVICE_ROLE_KEY        (auto-injetada) — auth + update do sent_channel
//   EDGE_SHARED_SECRET               (recomendada)   — secret dedicado RPC<->Edge
//   WHATSAPP_CLOUD_TOKEN             — token da Cloud API (system user)
//   WHATSAPP_CLOUD_PHONE_NUMBER_ID   — phone_number_id da Cloud API
//   WHATSAPP_CLOUD_TEMPLATE_NAME     — nome do template de autenticação aprovado
//   WHATSAPP_CLOUD_TEMPLATE_LANG     (opcional, default 'pt_BR')
//   WHATSAPP_CLOUD_API_VERSION       (opcional, default 'v21.0')
//   WHATSAPP_CLOUD_TEMPLATE_BUTTON   (opcional, default 'url'; 'none' = sem botão)
//
// Degradação controlada: sem as credenciais da Cloud API, o WhatsApp é pulado
// e tudo cai no e-mail — o cadastro continua funcionando (Req 15).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Payload = {
  phone?: string;
  email?: string | null;
  code?: string;
  force_email?: boolean;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EDGE_SHARED_SECRET = Deno.env.get('EDGE_SHARED_SECRET') ?? '';

const WA_TOKEN = Deno.env.get('WHATSAPP_CLOUD_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WHATSAPP_CLOUD_PHONE_NUMBER_ID') ?? '';
const WA_TEMPLATE = Deno.env.get('WHATSAPP_CLOUD_TEMPLATE_NAME') ?? '';
const WA_LANG = Deno.env.get('WHATSAPP_CLOUD_TEMPLATE_LANG') ?? 'pt_BR';
const WA_API_VERSION = Deno.env.get('WHATSAPP_CLOUD_API_VERSION') ?? 'v21.0';
const WA_BUTTON = (Deno.env.get('WHATSAPP_CLOUD_TEMPLATE_BUTTON') ?? 'url').toLowerCase();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Comparação em tempo constante (anti-timing) para validar o Bearer. */
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Mascara o telefone para log (mantém só os 4 últimos dígitos). */
function maskPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length <= 4 ? '****' : `****${d.slice(-4)}`;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** WhatsApp Cloud API configurada? */
function whatsappConfigured(): boolean {
  return WA_TOKEN.length > 0 && WA_PHONE_ID.length > 0 && WA_TEMPLATE.length > 0;
}

/**
 * Envia o código via WhatsApp Cloud API (template de autenticação). Retorna
 * true em HTTP 2xx. Trata a resposta como dado não confiável; nunca loga segredos.
 */
async function sendWhatsApp(phoneE164: string, code: string): Promise<boolean> {
  if (!whatsappConfigured()) return false;

  const components: unknown[] = [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
  ];
  // Botão de copiar código (templates de autenticação). Configurável; 'none' omite.
  if (WA_BUTTON !== 'none') {
    components.push({
      type: 'button',
      sub_type: WA_BUTTON, // 'url' (copy-code) na maioria dos templates de auth
      index: 0,
      parameters: [{ type: 'text', text: code }],
    });
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WA_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneE164,
          type: 'template',
          template: { name: WA_TEMPLATE, language: { code: WA_LANG }, components },
        }),
      }
    );
    if (!resp.ok) {
      // Loga só o status (sem corpo, que pode conter dados sensíveis).
      console.error(`[send-signup-otp] WhatsApp Cloud API HTTP ${resp.status} para ${maskPhone(phoneE164)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[send-signup-otp] Erro de rede na Cloud API:', String(err));
    return false;
  }
}

/**
 * Fallback: envia o MESMO código por e-mail reusando a Edge
 * `send-verification-email` (Resend). Retorna true em sucesso.
 */
async function sendEmail(email: string, code: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-verification-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ email, code }),
    });
    return resp.ok;
  } catch (err) {
    console.error('[send-signup-otp] Erro ao chamar send-verification-email:', String(err));
    return false;
  }
}

/** Registra o canal efetivo na linha pendente do telefone (best-effort). */
async function recordSentChannel(phoneE164: string, channel: 'whatsapp' | 'email'): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await sb
      .from('signup_otp_verifications')
      .update({ sent_channel: channel })
      .eq('phone', phoneE164)
      .eq('consumed', false);
  } catch (err) {
    // best-effort: a confirmação cai para o `channel` pretendido se não gravar.
    console.error('[send-signup-otp] Falha ao gravar sent_channel:', String(err));
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Autorização: Bearer == service role OU == shared secret (tempo constante).
  const auth = req.headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const authorized =
    (SERVICE_ROLE_KEY.length > 0 && safeEq(bearer, SERVICE_ROLE_KEY)) ||
    (EDGE_SHARED_SECRET.length > 0 && safeEq(bearer, EDGE_SHARED_SECRET));
  if (!authorized) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const phone = (payload.phone ?? '').trim();
  const email = (payload.email ?? '').trim();
  const code = (payload.code ?? '').trim();
  const forceEmail = payload.force_email === true;
  const hasEmail = email !== '' && EMAIL_RE.test(email);

  if (!phone || !code) {
    return json({ error: 'phone and code are required' }, 400);
  }

  // Decisão de canal + envio (espelha src/utils/otpChannel.ts).
  let sentChannel: 'whatsapp' | 'email' | null = null;

  if (forceEmail) {
    if (hasEmail && (await sendEmail(email, code))) sentChannel = 'email';
  } else {
    if (await sendWhatsApp(phone, code)) {
      sentChannel = 'whatsapp';
    } else if (hasEmail && (await sendEmail(email, code))) {
      // Fallback automático WhatsApp → e-mail.
      sentChannel = 'email';
    }
  }

  if (!sentChannel) {
    console.error(`[send-signup-otp] Nenhum canal entregou para ${maskPhone(phone)} (force_email=${forceEmail}, hasEmail=${hasEmail})`);
    return json({ ok: false, error: 'no_channel_delivered' }, 502);
  }

  await recordSentChannel(phone, sentChannel);
  return json({ ok: true, channel: sentChannel });
});

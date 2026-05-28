// ============================================================================
// Edge Function: send-public-ticket-reply
// ============================================================================
// Spec: .kiro/specs/notifications-hub/{requirements,design,tasks}.md
//
// Envia por email a resposta do admin a um ticket de suporte publico
// (visitante anonimo, user_id NULL no ticket).
//
// Recebe POST com:
//   {
//     ticket_id, guest_name, guest_email, subject, body, admin_name,
//     reply_link (opcional, URL absoluta para responder)
//   }
//
// Resposta:
//   200 { ok: true,  message_id: string }   — email enviado com sucesso
//   200 { ok: false, error: string }        — falha do provider
//   400 { error: string }                   — payload invalido
//   401 { error: 'Unauthorized' }           — JWT invalido / sem permissao
//   405 { error: 'Method not allowed' }
//
// Modos suportados (mesmo padrao de send-verification-email):
//   * Dev:  PUBLIC_TICKET_DEV_LOG=true → apenas console.log da resposta.
//   * Prod: integra com Resend / SendGrid (env EMAIL_PROVIDER).
//
// Seguranca:
//   * Deploy com verify_jwt=true: o gateway Supabase ja valida o JWT.
//   * Esta function aceita JWT do admin autenticado (chamada do client via
//     supabase.functions.invoke) OU Bearer SERVICE_ROLE_KEY (chamada interna
//     via pg_net.http_post de RPC SECURITY DEFINER).
//   * Quando JWT do user, a function consulta is_admin_with_permission
//     ('SUPORTE_REPLY') via Supabase REST com mesmo JWT — se a RPC retornar
//     false, rejeita 401.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface Payload {
  ticket_id?: string;
  guest_name?: string;
  guest_email?: string;
  subject?: string;
  body?: string;
  admin_name?: string;
  reply_link?: string;
}

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const DEV_LOG = Deno.env.get('PUBLIC_TICKET_DEV_LOG') === 'true';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'suporte@fretego.com.br';
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME') ?? 'FreteGO Suporte';

// Provider candidato 1: Resend (https://resend.com).
// Provider candidato 2: SendGrid.
// A escolha eh por env var: EMAIL_PROVIDER = 'resend' | 'sendgrid' | 'log'.
const EMAIL_PROVIDER = (Deno.env.get('EMAIL_PROVIDER') ?? 'log').toLowerCase();
const EMAIL_PROVIDER_API_KEY = Deno.env.get('EMAIL_PROVIDER_API_KEY') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ─── Utilities ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Escapa HTML básico para evitar XSS no template do email (admin pode
 * digitar tags por engano e o webmail rendera).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renderiza o corpo do email em HTML simples com estilo inline (compatível
 * com clientes de email).
 */
function renderEmailHtml(input: {
  guestName: string;
  subject: string;
  body: string;
  adminName: string;
  replyLink: string | null;
}): string {
  const greetingName = escapeHtml(input.guestName.split(' ')[0] ?? 'Olá');
  const subject = escapeHtml(input.subject);
  // Body do admin pode conter quebras de linha — preserva via white-space CSS.
  const body = escapeHtml(input.body);
  const adminName = escapeHtml(input.adminName);

  const replyButton = input.replyLink
    ? `<p style="margin: 24px 0; text-align: center;">
        <a href="${escapeHtml(input.replyLink)}"
           style="display: inline-block; background: #16a34a; color: #fff;
                  padding: 12px 24px; border-radius: 8px; text-decoration: none;
                  font-weight: 600; font-size: 14px;">
          Continuar conversa
        </a>
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
              sans-serif; background: #f3f4f6; padding: 24px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px;
              overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
    <div style="background: #16a34a; color: #fff; padding: 16px 24px;">
      <h1 style="margin: 0; font-size: 18px;">FreteGO Suporte</h1>
    </div>
    <div style="padding: 24px; color: #1f2937; font-size: 14px; line-height: 1.6;">
      <p>Olá, <strong>${greetingName}</strong>.</p>
      <p>Recebemos seu contato sobre <strong>${subject}</strong>. Nossa equipe respondeu:</p>
      <div style="background: #f9fafb; border-left: 4px solid #16a34a;
                  padding: 16px; margin: 16px 0; white-space: pre-wrap;">
${body}
      </div>
      <p style="margin-top: 16px; color: #6b7280; font-size: 13px;">
        — ${adminName}, equipe FreteGO
      </p>
      ${replyButton}
    </div>
    <div style="background: #f9fafb; padding: 12px 24px; color: #9ca3af;
                font-size: 11px; text-align: center;">
      Este email foi enviado em resposta ao seu contato em fretego.com.br/contato.<br />
      Se voce nao reconhece esta mensagem, ignore.
    </div>
  </div>
</body>
</html>`;
}

// ─── Email providers ────────────────────────────────────────────────────────

interface EmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Provider Resend (https://resend.com/docs/api-reference/emails/send-email).
 */
async function sendViaResend(input: {
  to: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  if (!EMAIL_PROVIDER_API_KEY) {
    return { ok: false, error: 'EMAIL_PROVIDER_API_KEY ausente' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${EMAIL_PROVIDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
        to: [`${input.toName} <${input.to}>`],
        subject: input.subject,
        html: input.html,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `Resend ${resp.status}: ${text.slice(0, 200)}` };
    }
    const data = await resp.json();
    return { ok: true, messageId: (data?.id as string | undefined) ?? '' };
  } catch (err) {
    return {
      ok: false,
      error: `Resend exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Provider SendGrid (https://docs.sendgrid.com/api-reference/mail-send/mail-send).
 */
async function sendViaSendGrid(input: {
  to: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  if (!EMAIL_PROVIDER_API_KEY) {
    return { ok: false, error: 'EMAIL_PROVIDER_API_KEY ausente' };
  }
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${EMAIL_PROVIDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: input.to, name: input.toName }],
            subject: input.subject,
          },
        ],
        from: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
        content: [{ type: 'text/html', value: input.html }],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `SendGrid ${resp.status}: ${text.slice(0, 200)}` };
    }
    // SendGrid retorna 202 sem body; usa header X-Message-Id quando presente.
    const messageId = resp.headers.get('X-Message-Id') ?? '';
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: `SendGrid exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Modo dev: apenas loga (não envia).
 */
function sendViaLog(input: {
  to: string;
  toName: string;
  subject: string;
  html: string;
}): EmailResult {
  console.log(
    `[DEV][send-public-ticket-reply] to=${input.to} (${input.toName}) subject="${input.subject}"`
  );
  console.log(`[DEV][send-public-ticket-reply] html length=${input.html.length} chars`);
  return { ok: true, messageId: `dev-${Date.now()}` };
}

async function dispatchEmail(input: {
  to: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  if (DEV_LOG || EMAIL_PROVIDER === 'log') {
    return sendViaLog(input);
  }
  if (EMAIL_PROVIDER === 'resend') return sendViaResend(input);
  if (EMAIL_PROVIDER === 'sendgrid') return sendViaSendGrid(input);
  return { ok: false, error: `EMAIL_PROVIDER desconhecido: ${EMAIL_PROVIDER}` };
}

// ─── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Auth: aceita SERVICE_ROLE_KEY (chamada interna) OU JWT de admin com
  // permissao SUPORTE_REPLY (chamada do client browser).
  const auth = req.headers.get('Authorization') ?? '';
  const isServiceRole = SERVICE_ROLE_KEY !== undefined && auth === `Bearer ${SERVICE_ROLE_KEY}`;

  let authorized = isServiceRole;

  if (!authorized && auth.startsWith('Bearer ')) {
    // Tem JWT — valida via RPC is_admin_with_permission no proprio Supabase.
    // O gateway ja validou o JWT (verify_jwt=true), entao temos seguranca de
    // que eh um user autenticado real. Falta checar a permissao SUPORTE_REPLY.
    if (!SUPABASE_URL) {
      console.warn('[send-public-ticket-reply] SUPABASE_URL ausente; bloqueando.');
      return json({ error: 'Unauthorized' }, 401);
    }
    try {
      const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin_with_permission`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_action: 'SUPORTE_REPLY' }),
      });
      if (rpcResp.ok) {
        const isAllowed = await rpcResp.json();
        authorized = isAllowed === true;
      }
    } catch (err) {
      console.warn(`[send-public-ticket-reply] erro ao validar permissao: ${err}`);
    }
  }

  if (!authorized) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { ticket_id, guest_name, guest_email, subject, body, admin_name, reply_link } = payload;

  // Validações rígidas — mesmo padrão das RPCs SQL
  if (!ticket_id || typeof ticket_id !== 'string') {
    return json({ error: 'ticket_id ausente ou invalido' }, 400);
  }
  if (!guest_email || typeof guest_email !== 'string' || !EMAIL_REGEX.test(guest_email)) {
    return json({ error: 'guest_email invalido' }, 400);
  }
  if (!guest_name || typeof guest_name !== 'string' || guest_name.length < 2) {
    return json({ error: 'guest_name invalido' }, 400);
  }
  if (!subject || typeof subject !== 'string' || subject.length === 0) {
    return json({ error: 'subject ausente' }, 400);
  }
  if (!body || typeof body !== 'string' || body.length === 0) {
    return json({ error: 'body ausente' }, 400);
  }
  if (!admin_name || typeof admin_name !== 'string') {
    return json({ error: 'admin_name ausente' }, 400);
  }

  const html = renderEmailHtml({
    guestName: guest_name,
    subject,
    body,
    adminName: admin_name,
    replyLink: reply_link ?? null,
  });

  const result = await dispatchEmail({
    to: guest_email,
    toName: guest_name,
    subject: `[FreteGO Suporte] Re: ${subject}`,
    html,
  });

  if (!result.ok) {
    console.warn(
      `[send-public-ticket-reply] falha provider=${EMAIL_PROVIDER} ticket=${ticket_id} error=${result.error}`
    );
    return json({ ok: false, error: result.error ?? 'Falha ao enviar' }, 200);
  }

  return json({ ok: true, message_id: result.messageId ?? '' });
});

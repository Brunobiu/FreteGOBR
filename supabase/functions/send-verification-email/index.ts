// ============================================================================
// Edge Function: send-verification-email
// ============================================================================
// Recebe POST { email, code } e dispara um e-mail com o codigo de verificacao
// de 6 digitos para o usuario do FreteGO via Resend (https://resend.com).
//
// Variaveis de ambiente:
//   * SUPABASE_SERVICE_ROLE_KEY   (auto-injetada) - autoriza chamadas vindas da RPC
//   * EDGE_SHARED_SECRET          (recomendada)   - secret dedicado RPC<->Edge.
//                                                   A RPC passa este valor como Bearer
//                                                   (lido do Vault). Robusto a troca de
//                                                   formato de chave legacy<->nova.
//   * RESEND_API_KEY              (obrigatoria)  - chave do Resend (re_...)
//   * RESEND_FROM                 (opcional)     - remetente. DEVE usar um dominio
//                                                  verificado no Resend (ex:
//                                                  'FreteGO <nao-responda@fretegobr.com.br>')
//   * VERIFICATION_DEV_LOG        (opcional)     - 'true' = nao envia, so loga.
//
// Seguranca:
//   * Aceita Bearer == SUPABASE_SERVICE_ROLE_KEY OU == EDGE_SHARED_SECRET.
//   * Funcao invocada via pg_net.http_post a partir da RPC
//     `generate_email_verification_code` (SECURITY DEFINER, le creds do Vault).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type Payload = {
  email?: string;
  code?: string;
};

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EDGE_SHARED_SECRET = Deno.env.get('EDGE_SHARED_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'FreteGO <onboarding@resend.dev>';
const DEV_LOG = Deno.env.get('VERIFICATION_DEV_LOG') === 'true';

/**
 * Comparacao em tempo constante para evitar timing attacks na verificacao
 * do Bearer.
 */
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Template HTML do e-mail de verificacao do FreteGO.
 * Formato simples, mobile-friendly, com codigo destacado.
 */
function buildEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codigo de verificacao FreteGO</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header verde FreteGO -->
          <tr>
            <td style="background-color:#16a34a; padding:24px 32px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700; letter-spacing:-0.02em;">
                FreteGO
              </h1>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px 0; color:#111827; font-size:20px; font-weight:600;">
                Confirme seu e-mail
              </h2>
              <p style="margin:0 0 24px 0; color:#4b5563; font-size:14px; line-height:1.6;">
                Use o codigo abaixo para confirmar seu e-mail no FreteGO. Ele e valido por <strong>10 minutos</strong>.
              </p>

              <!-- Caixa do codigo -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center" style="background-color:#f0fdf4; border:2px dashed #16a34a; border-radius:8px; padding:24px;">
                    <div style="color:#15803d; font-size:32px; font-weight:700; letter-spacing:0.5em; font-family:'Courier New', monospace;">
                      ${code}
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0 0; color:#6b7280; font-size:12px; line-height:1.5;">
                Se voce nao solicitou este codigo, ignore este e-mail. Sua conta continua segura.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb; padding:16px 32px; border-top:1px solid #e5e7eb; text-align:center;">
              <p style="margin:0; color:#9ca3af; font-size:11px;">
                FreteGO &middot; Conectando motoristas e embarcadores
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Versao texto-puro do e-mail (fallback para clientes que nao renderizam HTML).
 */
function buildEmailText(code: string): string {
  return [
    'FreteGO - Confirme seu e-mail',
    '',
    `Seu codigo de verificacao e: ${code}`,
    '',
    'Ele e valido por 10 minutos.',
    '',
    'Se voce nao solicitou este codigo, ignore este e-mail.',
  ].join('\n');
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Validacao de autorizacao: aceita Bearer == SUPABASE_SERVICE_ROLE_KEY
  // (env injetada pelo Supabase) OU == EDGE_SHARED_SECRET (secret dedicado
  // no Vault, robusto a troca de formato de chave legacy<->nova).
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

  const { email, code } = payload;
  if (!email || !code) {
    return json({ error: 'email and code are required' }, 400);
  }

  // Modo dev: apenas log, nao envia
  if (DEV_LOG) {
    console.log(`[DEV][send-verification-email] email=${email} code=${code}`);
    return json({ ok: true, mode: 'dev' });
  }

  // Sem chave do Resend: nao consegue enviar. Retorna 500 para a RPC.
  if (!RESEND_API_KEY) {
    console.error('[send-verification-email] RESEND_API_KEY nao configurada');
    return json({ error: 'email_provider_not_configured' }, 500);
  }

  // Envio via Resend (https://resend.com/docs/api-reference/emails/send-email)
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: 'Seu codigo de verificacao FreteGO',
        html: buildEmailHtml(code),
        text: buildEmailText(code),
      }),
    });

    const data = (await resp.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: string;
    };

    if (!resp.ok) {
      console.error(
        `[send-verification-email] Resend retornou ${resp.status}:`,
        JSON.stringify(data)
      );
      return json(
        {
          error: 'resend_failed',
          status: resp.status,
          detail: data?.message ?? data?.error ?? null,
        },
        502
      );
    }

    console.log(
      `[send-verification-email] enviado via Resend, id=${data?.id ?? 'unknown'} email=${email}`
    );
    return json({ ok: true, mode: 'resend', id: data?.id ?? null });
  } catch (err) {
    console.error('[send-verification-email] Erro ao chamar Resend:', err);
    return json({ error: 'resend_exception', detail: String(err) }, 500);
  }
});

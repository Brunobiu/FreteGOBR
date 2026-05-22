// ============================================================================
// Edge Function: send-verification-email
// ============================================================================
// Recebe POST { email, code } e dispara um e-mail com o código de verificação
// de 6 dígitos para o usuário do FreteGO.
//
// Modos suportados:
//   * Dev:  VERIFICATION_DEV_LOG=true → apenas console.log do código.
//   * Prod: TODO — integrar com Resend/SendGrid/SMTP do Supabase.
//
// Segurança:
//   * Header Authorization Bearer com SUPABASE_SERVICE_ROLE_KEY é obrigatório.
//   * Função invocada via pg_net.http_post a partir da RPC
//     `generate_email_verification_code` (SECURITY DEFINER).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type Payload = {
  email?: string;
  code?: string;
};

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DEV_LOG = Deno.env.get('VERIFICATION_DEV_LOG') === 'true';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Validação de autorização
  const auth = req.headers.get('Authorization') ?? '';
  const expected = SERVICE_ROLE_KEY ? `Bearer ${SERVICE_ROLE_KEY}` : null;
  if (!expected || auth !== expected) {
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

  // Modo dev: apenas log
  if (DEV_LOG) {
    console.log(`[DEV][send-verification-email] email=${email} code=${code}`);
    return json({ ok: true, mode: 'dev' });
  }

  // Modo produção (stub): integrar Resend/SendGrid aqui.
  // Por enquanto, apenas confirma recepção sem enviar e-mail real.
  // TODO: chamar provedor SMTP/transactional aqui.
  console.log(`[PROD-STUB][send-verification-email] (no provider configured) email=${email}`);
  return json({ ok: true, mode: 'stub' });
});

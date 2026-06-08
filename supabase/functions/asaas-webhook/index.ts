// ============================================================================
// Edge Function: asaas-webhook
// ============================================================================
// Recebe os webhooks de cobrança do Asaas, valida a autenticidade, garante
// idempotência e atualiza o estado da assinatura do motorista.
//
// Fluxo:
//   1. Valida header `asaas-access-token` == secret ASAAS_WEBHOOK_TOKEN.
//      Falha => 401, sem efeito no estado.
//   2. Parseia o corpo e deriva (eventId, action, externalReference=user_id).
//   3. Idempotência: INSERT em asaas_webhook_events (asaas_event_id UNIQUE)
//      com ON CONFLICT DO NOTHING. Se 0 linhas, evento já processado => 200.
//   4. Aplica a ação:
//        mark_paid     -> subscription_mark_paid(user_id, payment_id)
//        mark_past_due -> subscription_mark_past_due(user_id) + notifica
//        ignore        -> no-op
//
// Deploy:
//   supabase functions deploy asaas-webhook --no-verify-jwt
//   (a autenticidade é validada pelo token do Asaas, não por JWT de usuário.)
//
// Env vars:
//   SUPABASE_URL                (auto)
//   SUPABASE_SERVICE_ROLE_KEY   (auto) — escreve ignorando RLS
//   ASAAS_WEBHOOK_TOKEN         (obrigatória) — token configurado no painel Asaas
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ASAAS_WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ─── Lógica pura (espelho de src/utils/asaasWebhook.ts, validada por testes) ──

const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH']);
const PAST_DUE_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
]);

type WebhookAction = 'mark_paid' | 'mark_past_due' | 'ignore';

function mapAsaasEventToAction(event: string | null | undefined): WebhookAction {
  const e = (event ?? '').trim().toUpperCase();
  if (PAID_EVENTS.has(e)) return 'mark_paid';
  if (PAST_DUE_EVENTS.has(e)) return 'mark_past_due';
  return 'ignore';
}

function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ─── Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Autenticidade: token do Asaas no header. Falha => 401 sem efeito.
  const token = req.headers.get('asaas-access-token') ?? '';
  if (!ASAAS_WEBHOOK_TOKEN || !safeEq(token, ASAAS_WEBHOOK_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const payment = (body?.payment ?? {}) as Record<string, unknown>;
  const eventType = String(body?.event ?? '')
    .trim()
    .toUpperCase();
  const paymentId: string | null = (payment?.id as string | undefined) ?? null;
  const rawEventId: string | null = (body?.id as string | undefined) ?? null;
  const eventId = rawEventId ?? (paymentId ? `${eventType}:${paymentId}` : null);
  const userId: string | null = (payment?.externalReference as string | undefined) ?? null;
  const action = mapAsaasEventToAction(eventType);

  if (!eventId) {
    // Sem chave de idempotência não há como deduplicar; aceitamos sem efeito.
    return json({ ok: true, ignored: 'no_event_id' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 3. Idempotência: tenta registrar o evento. Conflito => já processado.
  const { data: inserted, error: insErr } = await supabase
    .from('asaas_webhook_events')
    .insert({ asaas_event_id: eventId, event_type: eventType, payload: body })
    .select('id')
    .maybeSingle();

  if (insErr) {
    // 23505 = unique_violation => evento duplicado, idempotente: 200 sem efeito.
    if ((insErr as { code?: string }).code === '23505') {
      return json({ ok: true, duplicate: true });
    }
    console.error('[asaas-webhook] erro ao registrar evento', insErr);
    return json({ error: 'event_persist_failed' }, 500);
  }
  if (!inserted) {
    return json({ ok: true, duplicate: true });
  }

  // 4. Aplica a ação sobre a assinatura (quando há user_id resolvido).
  if (action === 'ignore' || !userId) {
    return json({ ok: true, action: action === 'ignore' ? 'ignore' : 'no_user' });
  }

  try {
    if (action === 'mark_paid') {
      await supabase.rpc('subscription_mark_paid', {
        p_user_id: userId,
        p_asaas_payment_id: paymentId,
      });
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'plan_charged',
        title: 'Pagamento confirmado',
        message: 'Sua assinatura do FreteGO foi renovada com sucesso.',
        link: '/motorista/plano',
      });
    } else if (action === 'mark_past_due') {
      await supabase.rpc('subscription_mark_past_due', { p_user_id: userId });
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'plan_payment_failed',
        title: 'Falha no pagamento',
        message:
          'Não conseguimos confirmar seu pagamento. Você tem 5 dias para regularizar antes da suspensão.',
        link: '/motorista/plano',
      });
    }
  } catch (err) {
    console.error('[asaas-webhook] erro ao aplicar acao', action, err);
    // O evento já foi registrado; retornamos 200 para o Asaas não re-tentar
    // em loop — a reconciliação fica para o cron/admin.
    return json({ ok: true, action, applied: false });
  }

  return json({ ok: true, action, applied: true });
});

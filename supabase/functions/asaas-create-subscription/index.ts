// ============================================================================
// Edge Function: asaas-create-subscription
// ============================================================================
// Cria a assinatura de um motorista no Asaas e persiste o estado local.
// Detém a API key do Asaas (secret) — NUNCA exposta ao cliente.
//
// Entrada (POST, requer JWT do motorista autenticado):
//   {
//     plan: 'mensal' | 'trimestral' | 'semestral',
//     payment_method: 'credit_card' | 'pix' | 'boleto',
//     cpfCnpj: string,                 // do titular (exigido pelo Asaas)
//     card?: {                         // só p/ credit_card (recorrência automática)
//       holderName, number, expiryMonth, expiryYear, ccv,
//       holderEmail, holderCpfCnpj, holderPostalCode, holderAddressNumber, holderPhone
//     }
//   }
//
// Comportamento:
//   - credit_card => cria customer + SUBSCRIPTION recorrente (Asaas cobra sozinho).
//   - pix/boleto  => cria customer + PAYMENT único do ciclo (renovação manual).
//   - Persiste subscriptions + subscription_charges(pending) via service-role.
//   - Não persiste número de cartão (transita direto ao Asaas).
//
// Deploy:
//   supabase functions deploy asaas-create-subscription
//   (verify_jwt = true — exige usuário autenticado.)
//
// Env vars:
//   SUPABASE_URL                (auto)
//   SUPABASE_SERVICE_ROLE_KEY   (auto)
//   ASAAS_API_KEY               (obrigatória, secret)
//   ASAAS_BASE_URL              (ex.: https://sandbox.asaas.com/api/v3)
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') ?? '';
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ─── Catálogo de planos (espelho de src/utils/subscriptionPlans.ts) ──────────
const PLAN_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6 };
const PLAN_MONTHLY: Record<string, number> = { mensal: 39.9, trimestral: 34.9, semestral: 29.9 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function planTotal(plan: string): number | null {
  const months = PLAN_MONTHS[plan];
  const monthly = PLAN_MONTHLY[plan];
  if (months == null || monthly == null) return null;
  return round2(monthly * months);
}

async function asaas(
  path: string,
  method: string,
  payload?: unknown
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: ASAAS_API_KEY,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`asaas ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!ASAAS_API_KEY) return json({ error: 'ASAAS_UNAVAILABLE' }, 503);

  // Auth: resolve o usuário autenticado a partir do JWT do header.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'permission_denied' }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  const authUser = userData?.user;
  if (userErr || !authUser) return json({ error: 'permission_denied' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const plan = String(body?.plan ?? '');
  const paymentMethod = String(body?.payment_method ?? '');
  const cpfCnpj = String(body?.cpfCnpj ?? '').replace(/\D/g, '');

  if (!(plan in PLAN_MONTHS)) return json({ error: 'INVALID_INPUT', field: 'plan' }, 400);
  if (!['credit_card', 'pix', 'boleto'].includes(paymentMethod)) {
    return json({ error: 'INVALID_INPUT', field: 'payment_method' }, 400);
  }
  if (cpfCnpj.length < 11) return json({ error: 'INVALID_INPUT', field: 'cpfCnpj' }, 400);

  // Confirma que é motorista.
  const { data: profile } = await supabase
    .from('users')
    .select('user_type, name, email')
    .eq('id', authUser.id)
    .maybeSingle();
  if (!profile || profile.user_type !== 'motorista') {
    return json({ error: 'permission_denied' }, 403);
  }

  const total = planTotal(plan)!;
  const months = PLAN_MONTHS[plan];
  const ASAAS_BILLING: Record<string, string> = {
    credit_card: 'CREDIT_CARD',
    pix: 'PIX',
    boleto: 'BOLETO',
  };

  try {
    // 1. Cria/recupera customer no Asaas.
    const customer = await asaas('/customers', 'POST', {
      name: profile.name ?? 'Motorista FreteGO',
      cpfCnpj,
      email: profile.email ?? undefined,
      externalReference: authUser.id,
    });
    const customerId = customer.id as string;

    const dueDate = new Date().toISOString().slice(0, 10);
    let asaasSubscriptionId: string | null = null;
    let asaasPaymentId: string | null = null;
    let checkout: Record<string, unknown> = {};

    if (paymentMethod === 'credit_card') {
      // Recorrência automática: SUBSCRIPTION no ciclo do plano.
      const cycle = months === 1 ? 'MONTHLY' : months === 3 ? 'QUARTERLY' : 'SEMIANNUALLY';
      const sub = await asaas('/subscriptions', 'POST', {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: total,
        nextDueDate: dueDate,
        cycle,
        externalReference: authUser.id,
        creditCard: body?.card,
        creditCardHolderInfo: body?.cardHolderInfo,
      });
      asaasSubscriptionId = sub.id as string;
    } else {
      // PIX/boleto: cobrança única do ciclo (renovação manual ao vencer).
      const payment = await asaas('/payments', 'POST', {
        customer: customerId,
        billingType: ASAAS_BILLING[paymentMethod],
        value: total,
        dueDate,
        externalReference: authUser.id,
        description: `FreteGO - Plano ${plan}`,
      });
      asaasPaymentId = payment.id as string;
      checkout = {
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        pixQrCode: payment.pixQrCodeId ? { id: payment.pixQrCodeId } : undefined,
      };
    }

    // 2. Persiste subscription (status 'active' só após webhook confirmar;
    //    aqui criamos como 'past_due' provisório p/ pix/boleto e 'active'
    //    otimista p/ recorrência? -> mantemos 'past_due' até o webhook de
    //    confirmação, exceto que o acesso ainda vale pelo trial. Para não
    //    bloquear, deixamos 'active' apenas quando o webhook confirmar.
    //    Estado inicial: 'past_due' sem grace acionado seria ruim; usamos um
    //    registro com status atual do fluxo: o webhook chama mark_paid.)
    const startedAt = new Date().toISOString();
    await supabase.from('subscriptions').upsert(
      {
        user_id: authUser.id,
        plan,
        payment_method: paymentMethod,
        status: 'active', // provisório; webhook reconcilia (mark_paid/past_due)
        auto_recurring: paymentMethod === 'credit_card',
        started_at: startedAt,
        next_charge_at: null,
        asaas_customer_id: customerId,
        asaas_subscription_id: asaasSubscriptionId,
        updated_at: startedAt,
      },
      { onConflict: 'user_id' }
    );

    const { data: subRow } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', authUser.id)
      .maybeSingle();

    // 3. Registra a cobrança pendente do ciclo.
    if (subRow) {
      await supabase.from('subscription_charges').insert({
        subscription_id: subRow.id,
        user_id: authUser.id,
        amount: total,
        payment_method: paymentMethod,
        status: 'pending',
        period_start: startedAt,
        asaas_payment_id: asaasPaymentId,
      });
    }

    return json({ ok: true, plan, total, checkout, asaas_subscription_id: asaasSubscriptionId });
  } catch (err) {
    console.error('[asaas-create-subscription] erro', err);
    const msg = String((err as Error)?.message ?? '');
    if (msg.includes('asaas 4')) {
      // 4xx do Asaas (ex.: cartão recusado).
      return json({ error: 'ASAAS_CARD_FAILED', detail: msg.slice(0, 200) }, 400);
    }
    return json({ error: 'ASAAS_UNAVAILABLE' }, 502);
  }
});

/**
 * Lógica PURA de mapeamento de eventos do webhook do Asaas (FreteGO).
 *
 * Módulo sem I/O (sem rede, sem banco). Traduz um evento do Asaas na ação de
 * domínio que o sistema deve executar. É o alvo de teste da Property 4 (parte
 * pura) e mantém a Edge Function `asaas-webhook` fina e testável.
 *
 * Referência de eventos do Asaas (webhook de cobrança):
 *   https://docs.asaas.com/docs/webhook-para-cobrancas
 */

/** Ação de domínio derivada de um evento do Asaas. */
export type WebhookAction =
  | 'mark_paid' // pagamento confirmado/recebido => assinatura ativa
  | 'mark_past_due' // vencido/estornado/recusado => past_due (+ grace)
  | 'ignore'; // evento sem efeito no estado da assinatura

/**
 * Eventos do Asaas que confirmam recebimento do pagamento.
 * (PAYMENT_CONFIRMED = confirmado; PAYMENT_RECEIVED = caiu na conta.)
 */
const PAID_EVENTS: ReadonlySet<string> = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
]);

/**
 * Eventos que indicam falha/atraso e devem levar a assinatura a `past_due`
 * (abrindo o grace de 5 dias).
 */
const PAST_DUE_EVENTS: ReadonlySet<string> = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
]);

/**
 * Mapeia o `event` do Asaas para a {@link WebhookAction} correspondente.
 * Função total: eventos desconhecidos ou sem efeito retornam `'ignore'`.
 */
export function mapAsaasEventToAction(event: string | null | undefined): WebhookAction {
  const e = (event ?? '').trim().toUpperCase();
  if (PAID_EVENTS.has(e)) return 'mark_paid';
  if (PAST_DUE_EVENTS.has(e)) return 'mark_past_due';
  return 'ignore';
}

/** Formato mínimo do corpo do webhook do Asaas que nos interessa. */
export interface AsaasWebhookBody {
  /** Id único do evento (idempotência). Em alguns formatos vem como `id`. */
  id?: string;
  event?: string;
  payment?: {
    id?: string;
    customer?: string;
    subscription?: string;
    externalReference?: string;
    value?: number;
    billingType?: string;
  };
}

/** Resultado parseado e normalizado de um corpo de webhook. */
export interface ParsedWebhook {
  /** Chave de idempotência: id do evento, ou fallback para id do pagamento. */
  eventId: string | null;
  eventType: string;
  action: WebhookAction;
  asaasPaymentId: string | null;
  asaasCustomerId: string | null;
  asaasSubscriptionId: string | null;
  /** externalReference que setamos na criação = user_id do motorista. */
  externalReference: string | null;
}

/**
 * Extrai e normaliza os campos relevantes do corpo do webhook do Asaas.
 * Função total e defensiva: campos ausentes viram `null`.
 *
 * A chave de idempotência (`eventId`) prefere `body.id` (id do evento); quando
 * ausente, cai para `payment.id` combinado com o tipo do evento, garantindo que
 * o mesmo pagamento+evento não seja processado duas vezes.
 */
export function parseAsaasWebhook(body: AsaasWebhookBody | null | undefined): ParsedWebhook {
  const b = body ?? {};
  const eventType = (b.event ?? '').trim().toUpperCase();
  const paymentId = b.payment?.id ?? null;
  const rawEventId = b.id ?? null;
  const eventId = rawEventId ?? (paymentId ? `${eventType}:${paymentId}` : null);

  return {
    eventId,
    eventType,
    action: mapAsaasEventToAction(eventType),
    asaasPaymentId: paymentId,
    asaasCustomerId: b.payment?.customer ?? null,
    asaasSubscriptionId: b.payment?.subscription ?? null,
    externalReference: b.payment?.externalReference ?? null,
  };
}

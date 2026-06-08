/**
 * Service de assinaturas do motorista (FreteGO) — spec assinaturas-pagamento.
 *
 * Conversa com:
 *   - Edge `asaas-create-subscription` (contratar plano / iniciar cobrança).
 *   - RPC `list_my_charges` (histórico do próprio motorista).
 *   - RPC `cancel_my_subscription` (cancelar a própria assinatura).
 *
 * Toda mensagem user-facing em pt-BR; error codes em inglês.
 */

import { supabase } from './supabase';
import type { PlanId } from '../utils/subscriptionPlans';

export type PaymentMethod = 'credit_card' | 'pix' | 'boleto';

export type ChargeStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface ChargeRow {
  id: string;
  amount: number;
  payment_method: PaymentMethod;
  status: ChargeStatus;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Dados do cartão (só usados em payment_method='credit_card'). */
export interface CreditCardInput {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

/** Dados do titular exigidos pelo Asaas para cartão. */
export interface CardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

export interface CreateSubscriptionInput {
  plan: PlanId;
  payment_method: PaymentMethod;
  cpfCnpj: string;
  card?: CreditCardInput;
  cardHolderInfo?: CardHolderInfo;
}

/** Resultado da contratação: dados de checkout (PIX/boleto/cartão). */
export interface CreateSubscriptionResult {
  ok: boolean;
  plan: PlanId;
  total: number;
  checkout: {
    invoiceUrl?: string;
    bankSlipUrl?: string;
    pixQrCode?: { id?: string };
  };
  asaas_subscription_id: string | null;
}

export type SubscriptionErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'ASAAS_CARD_FAILED'
  | 'ASAAS_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export const SUBSCRIPTION_ERROR_MESSAGES: Record<SubscriptionErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  INVALID_INPUT: 'Dados inválidos. Verifique os campos e tente novamente.',
  ASAAS_CARD_FAILED: 'Não foi possível validar seu cartão. Tente outra forma de pagamento.',
  ASAAS_UNAVAILABLE: 'Pagamento temporariamente indisponível. Tente novamente em instantes.',
  NOT_FOUND: 'Assinatura não encontrada.',
  UNKNOWN: 'Não foi possível concluir a operação. Tente novamente.',
};

export class SubscriptionError extends Error {
  readonly code: SubscriptionErrorCode;
  constructor(code: SubscriptionErrorCode) {
    super(SUBSCRIPTION_ERROR_MESSAGES[code]);
    this.name = 'SubscriptionError';
    this.code = code;
  }
}

/** Mapeia um erro arbitrário (edge/rpc) para SubscriptionError tipado. */
function mapError(raw: unknown): SubscriptionError {
  const e = (raw ?? {}) as { code?: string; message?: string; error?: string };
  const msg = `${e.error ?? ''} ${e.message ?? ''}`.toUpperCase();
  if (e.code === '42501' || msg.includes('PERMISSION_DENIED')) {
    return new SubscriptionError('PERMISSION_DENIED');
  }
  if (msg.includes('ASAAS_CARD_FAILED')) return new SubscriptionError('ASAAS_CARD_FAILED');
  if (msg.includes('ASAAS_UNAVAILABLE')) return new SubscriptionError('ASAAS_UNAVAILABLE');
  if (msg.includes('INVALID_INPUT')) return new SubscriptionError('INVALID_INPUT');
  if (msg.includes('NOT_FOUND')) return new SubscriptionError('NOT_FOUND');
  return new SubscriptionError('UNKNOWN');
}

/**
 * Contrata um plano para o motorista autenticado, via Edge
 * `asaas-create-subscription`. Retorna os dados de checkout (link/QR do PIX,
 * boleto, ou confirmação do cartão recorrente).
 */
export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<CreateSubscriptionResult> {
  const { data, error } = await supabase.functions.invoke('asaas-create-subscription', {
    body: {
      plan: input.plan,
      payment_method: input.payment_method,
      cpfCnpj: input.cpfCnpj,
      card: input.card,
      cardHolderInfo: input.cardHolderInfo,
    },
  });

  if (error) {
    // O corpo de erro da edge function vem em `error.context` em alguns casos;
    // tentamos extrair, senão mapeamos genérico.
    throw mapError((error as { context?: unknown }).context ?? error);
  }
  const raw = (data ?? {}) as Partial<CreateSubscriptionResult> & { error?: string };
  if (raw.error) throw mapError(raw);
  if (!raw.ok) throw new SubscriptionError('UNKNOWN');

  return {
    ok: true,
    plan: raw.plan as PlanId,
    total: Number(raw.total ?? 0),
    checkout: raw.checkout ?? {},
    asaas_subscription_id: raw.asaas_subscription_id ?? null,
  };
}

/** Lista o histórico de cobranças do próprio motorista (RPC list_my_charges). */
export async function listMyCharges(): Promise<ChargeRow[]> {
  const { data, error } = await supabase.rpc('list_my_charges');
  if (error) throw mapError(error);
  const raw = (data ?? {}) as { charges?: ChargeRow[] };
  return Array.isArray(raw.charges) ? raw.charges : [];
}

/** Cancela a assinatura do próprio motorista (idempotente). */
export async function cancelMySubscription(): Promise<{ status: string; skipped?: boolean }> {
  const { data, error } = await supabase.rpc('cancel_my_subscription');
  if (error) throw mapError(error);
  const raw = (data ?? {}) as { status?: string; skipped?: boolean };
  return { status: raw.status ?? 'canceled', skipped: raw.skipped };
}

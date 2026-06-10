/**
 * Service de revalidação periódica de documentos do motorista (30 dias).
 *
 * Ponte entre a UI e as RPCs da migration 073:
 *   - getMyDocRevalidation: lê o estado por grupo (e cria a notificação do
 *     sistema de forma idempotente quando há grupo vencido).
 *   - confirmMyDocRevalidation: confirma TUDO de uma vez (+30 dias).
 *
 * A autoridade é o servidor (`motorista_can_interact` nega interação enquanto
 * há grupo vencido). Aqui é apenas leitura para UX (modal + selos).
 */

import { supabase } from './supabase';
import type { RevalidationGroup } from '../utils/docRevalidation';

export interface DocRevalidationState {
  /** false quando o usuário não é motorista (embarcador/admin). */
  applicable: boolean;
  tracaoConfirmedAt: Date | null;
  carroceriaConfirmedAt: Date | null;
  complementoConfirmedAt: Date | null;
  referenciasConfirmedAt: Date | null;
  contratoConfirmedAt: Date | null;
  /** Grupos vencidos calculados pelo servidor (na ordem canônica). */
  expiredGroups: RevalidationGroup[];
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lê o estado de revalidação do motorista logado. Dispara, no servidor, a
 * criação idempotente da notificação de revalidação quando há grupo vencido.
 *
 * Retorna `{ applicable: false, ... }` para não-motoristas.
 */
export async function getMyDocRevalidation(): Promise<DocRevalidationState> {
  const { data, error } = await supabase.rpc('get_my_doc_revalidation');
  if (error) throw new Error(`Erro ao verificar revalidação: ${error.message}`);

  const row = (data ?? {}) as Record<string, unknown>;
  const applicable = row.applicable === true;

  const expiredRaw = Array.isArray(row.expired_groups) ? row.expired_groups : [];
  const expiredGroups = expiredRaw.filter(
    (g): g is RevalidationGroup =>
      g === 'tracao' ||
      g === 'carroceria' ||
      g === 'complemento' ||
      g === 'referencias' ||
      g === 'contrato'
  );

  return {
    applicable,
    tracaoConfirmedAt: parseDate(row.tracao_confirmed_at),
    carroceriaConfirmedAt: parseDate(row.carroceria_confirmed_at),
    complementoConfirmedAt: parseDate(row.complemento_confirmed_at),
    referenciasConfirmedAt: parseDate(row.referencias_confirmed_at),
    contratoConfirmedAt: parseDate(row.contrato_confirmed_at),
    expiredGroups,
  };
}

/**
 * Confirma todos os grupos de uma vez (reseta os 5 `confirmed_at` para agora)
 * e marca as notificações de revalidação pendentes como lidas.
 */
export async function confirmMyDocRevalidation(): Promise<void> {
  const { error } = await supabase.rpc('confirm_my_doc_revalidation');
  if (error) throw new Error(`Erro ao confirmar documentos: ${error.message}`);
}

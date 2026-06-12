/**
 * Auth Session Verification (bootstrap)
 *
 * Helper de verificação de sessão usado exclusivamente pelo `AuthProvider`
 * na estratégia de **auth otimista** (startup-performance-optimization).
 *
 * Diferente de `getCurrentUser` (que retorna `User | null`, engolindo erros),
 * este helper DISTINGUE explicitamente três desfechos:
 *
 *   - `valid`         → sessão confirmada; traz o `User` fresco do banco.
 *   - `invalid`       → indicação EXPLÍCITA de sessão inválida (ex.: JWT
 *                       inválido, sessão ausente, 401/403 do GoTrue) ⇒ o
 *                       chamador deve limpar a Cached_Session.
 *   - `network-error` → erro de transporte/rede OU qualquer estado ambíguo
 *                       ⇒ o chamador deve PRESERVAR a Cached_Session (nunca
 *                       deslogar por engano).
 *
 * Regra-mãe (não-regressão): em qualquer dúvida, retornamos `network-error`
 * (alternativa segura). Somente uma confirmação positiva de invalidez dispara
 * `invalid`. Este helper NÃO altera `getCurrentUser` — o contrato existente é
 * 100% preservado (Requirements 1.3, 1.4, 12.6).
 */

import {
  isAuthApiError,
  isAuthSessionMissingError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { User } from '../types';

/**
 * Resultado da verificação de sessão no bootstrap.
 *
 * - `valid`: sessão confirmada, com o usuário fresco.
 * - `invalid`: sessão explicitamente inválida ⇒ limpar Cached_Session.
 * - `network-error`: erro de transporte/ambíguo ⇒ preservar Cached_Session.
 */
export type SessionVerification =
  | { kind: 'valid'; user: User }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

/**
 * Linha bruta da tabela `users`. Mantemos a forma mínima necessária ao
 * mapeamento; usamos índice de string para evitar acoplamento de tipo.
 */
type UsersRow = Record<string, unknown>;

/**
 * Mapeia uma linha da tabela `users` para o tipo `User` da aplicação.
 *
 * Espelha EXATAMENTE o mapeamento usado por `getCurrentUser`/`login` em
 * `services/auth.ts`, garantindo equivalência do `User` produzido
 * (Behavior_Baseline preservado).
 */
function mapUserRow(userData: UsersRow): User {
  const lastActivityAt = userData.last_activity_at as string | null | undefined;
  const trialEndsAt = userData.trial_ends_at as string | null | undefined;
  return {
    id: userData.id as string,
    phone: userData.phone as string,
    userType: userData.user_type as User['userType'],
    name: userData.name as string,
    email: userData.email as string | undefined,
    cpf: userData.cpf as string | undefined,
    profilePhotoUrl: userData.profile_photo_url as string | undefined,
    isActive: userData.is_active as boolean,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : undefined,
    createdAt: new Date(userData.created_at as string),
    updatedAt: new Date(userData.updated_at as string),
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    subscriptionStatus: (userData.subscription_status as User['subscriptionStatus']) ?? undefined,
    isSubscribed: (userData.is_subscribed as boolean | undefined) ?? undefined,
  };
}

/**
 * Verifica a sessão atual de forma segura para o bootstrap otimista.
 *
 * @returns `SessionVerification` distinguindo sessão válida, inválida e
 *          erro de rede/transporte. Em qualquer ambiguidade, retorna
 *          `network-error` para preservar a sessão (fail-safe ao baseline).
 */
export async function verifySessionForBootstrap(): Promise<SessionVerification> {
  // 1) Verifica a sessão de autenticação no GoTrue.
  let authUserId: string;
  try {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      // Erro de transporte transitório (fetch/503) ⇒ preservar sessão.
      if (isAuthRetryableFetchError(authError)) {
        return { kind: 'network-error' };
      }
      // Indicação EXPLÍCITA de invalidez (sessão ausente ou erro da API
      // GoTrue, ex.: JWT inválido/expirado, 401/403) ⇒ limpar sessão.
      if (isAuthSessionMissingError(authError) || isAuthApiError(authError)) {
        return { kind: 'invalid' };
      }
      // Outros AuthError sem confirmação clara de invalidez ⇒ preservar.
      return { kind: 'network-error' };
    }

    if (!authUser) {
      // Sem erro e sem usuário é um estado ambíguo: NÃO confirma invalidez.
      // Preferimos preservar a sessão (alternativa segura).
      return { kind: 'network-error' };
    }

    authUserId = authUser.id;
  } catch (error) {
    // Exceção lançada: somente desloga se for confirmadamente um erro de auth.
    if (isAuthSessionMissingError(error) || isAuthApiError(error)) {
      return { kind: 'invalid' };
    }
    // Caso contrário (TypeError de fetch, etc.) tratamos como erro de rede.
    return { kind: 'network-error' };
  }

  // 2) Busca o perfil do usuário. Falhas aqui NÃO confirmam invalidez de
  //    sessão, então preservamos (network-error) em vez de deslogar.
  try {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .single();

    if (userError || !userData) {
      return { kind: 'network-error' };
    }

    return { kind: 'valid', user: mapUserRow(userData as UsersRow) };
  } catch {
    return { kind: 'network-error' };
  }
}

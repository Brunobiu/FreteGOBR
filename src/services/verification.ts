/**
 * Verification Service
 *
 * Cliente das RPCs `generate_email_verification_code` e
 * `confirm_email_verification_code` definidas na Migration 010.
 *
 * Fluxo (visão geral):
 *   1. UI chama `sendEmailVerificationCode(email)` → RPC gera código,
 *      salva hash em `verification_codes` e dispara Edge Function que
 *      envia o e-mail (ou loga em dev).
 *   2. Usuário digita o código no `ModalVerificacaoEmail`.
 *   3. UI chama `confirmEmailVerificationCode(code)` → RPC compara hash;
 *      em sucesso atualiza `users.email_verified = true`.
 */

import { supabase } from './supabase';

export type VerificationStatus = 'OK' | 'INVALID' | 'EXPIRED' | 'BLOCKED';

export class VerificationError extends Error {
  constructor(
    message: string,
    public code: VerificationStatus | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}

/**
 * Solicita o envio de um código de verificação de 6 dígitos para o e-mail.
 * Lança `VerificationError` em caso de falha.
 */
export async function sendEmailVerificationCode(email: string): Promise<void> {
  const trimmed = (email ?? '').trim();
  if (!trimmed) {
    throw new VerificationError('Informe um e-mail válido.', 'UNKNOWN');
  }

  const { error } = await supabase.rpc('generate_email_verification_code', {
    p_email: trimmed,
  });

  if (error) {
    const msg = error.message ?? '';
    if (/rate_limited/i.test(msg)) {
      throw new VerificationError(
        'Muitas tentativas. Tente novamente em algumas horas.',
        'RATE_LIMITED'
      );
    }
    if (/invalid_email/i.test(msg)) {
      throw new VerificationError('E-mail em formato inválido.', 'UNKNOWN');
    }
    if (/unauthenticated/i.test(msg)) {
      throw new VerificationError('Faça login para continuar.', 'UNKNOWN');
    }
    throw new VerificationError(`Erro ao enviar código: ${msg}`, 'NETWORK_ERROR');
  }
}

/**
 * Confirma o código de verificação digitado pelo usuário.
 * Lança `VerificationError` quando a RPC retorna status diferente de OK
 * (INVALID/EXPIRED/BLOCKED) ou quando há erro de rede.
 */
export async function confirmEmailVerificationCode(code: string): Promise<void> {
  const normalized = (code ?? '').replace(/\D/g, '');
  if (normalized.length !== 6) {
    throw new VerificationError('O código deve ter 6 dígitos.', 'INVALID');
  }

  const { data, error } = await supabase.rpc('confirm_email_verification_code', {
    p_code: normalized,
  });

  if (error) {
    throw new VerificationError(`Erro ao validar código: ${error.message}`, 'NETWORK_ERROR');
  }

  const status = (data?.status ?? 'UNKNOWN') as VerificationStatus | 'UNKNOWN';
  switch (status) {
    case 'OK':
      return;
    case 'INVALID':
      throw new VerificationError('Código incorreto. Tente novamente.', 'INVALID');
    case 'EXPIRED':
      throw new VerificationError('Código expirado. Solicite um novo código.', 'EXPIRED');
    case 'BLOCKED':
      throw new VerificationError('Código bloqueado. Solicite um novo código.', 'BLOCKED');
    default:
      throw new VerificationError('Falha ao validar o código.', 'UNKNOWN');
  }
}

/**
 * Lê o estado atual de verificação do usuário autenticado.
 */
export async function getVerificationStatus(): Promise<{ emailVerified: boolean }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { emailVerified: false };

  const { data, error } = await supabase
    .from('users')
    .select('email_verified')
    .eq('id', user.id)
    .single();

  if (error || !data) return { emailVerified: false };
  return { emailVerified: !!data.email_verified };
}

/**
 * services/signupVerification.ts
 *
 * Cliente da verificação de e-mail PRÉ-CADASTRO (anônima) — migration 066.
 * Usado pelo cadastro multi-step (dados → código → senha): o e-mail é
 * verificado ANTES de a conta existir, e a conta nasce com email_verified=true.
 *
 *   1. requestSignupEmailCode(email)  → envia código de 6 dígitos por e-mail.
 *   2. confirmSignupEmailCode(email, code) → valida; retorna verification_token.
 *   3. o token é passado ao signup (auth.ts), que o consome no servidor.
 */

import { supabase } from './supabase';

export type SignupVerificationStatus = 'OK' | 'INVALID' | 'EXPIRED' | 'BLOCKED';

/**
 * Verifica a disponibilidade de um identificador (phone|email) antes de enviar
 * o código — para já avisar no campo certo (borda vermelha). Fail-open: em erro
 * de infra retorna `true` (disponível); o trigger no banco é a autoridade final.
 */
export async function isIdentifierAvailable(
  type: 'phone' | 'email',
  value: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_identifier_available', {
      p_type: type,
      p_value: value,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/**
 * Verifica se o identificador (phone) está bloqueado por exclusão prévia.
 * Fail-open. Retorna `true` somente quando a RPC indica bloqueio explícito.
 */
export async function isIdentifierBlocked(type: 'phone' | 'cpf', value: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_identifier_blocked', {
      p_type: type,
      p_value: value,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export class SignupVerificationError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_EMAIL' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'SignupVerificationError';
  }
}

/**
 * Solicita o envio de um código de verificação para o e-mail informado.
 * Não revela se o e-mail já tem conta (anti-enumeração): nesse caso a RPC
 * retorna ok sem enviar, e o signup final aborta por duplicidade.
 */
export async function requestSignupEmailCode(email: string): Promise<void> {
  const trimmed = (email ?? '').trim();
  const { error } = await supabase.rpc('request_signup_email_code', { p_email: trimmed });
  if (error) {
    const msg = error.message ?? '';
    if (/invalid_email/i.test(msg)) {
      throw new SignupVerificationError('E-mail em formato inválido.', 'INVALID_EMAIL');
    }
    if (/rate_limited/i.test(msg)) {
      throw new SignupVerificationError(
        'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        'RATE_LIMITED'
      );
    }
    throw new SignupVerificationError('Não foi possível enviar o código.', 'NETWORK_ERROR');
  }
}

/**
 * Confirma o código digitado. Em sucesso, retorna o `verification_token` que
 * deve ser enviado ao signup. Lança erro em falha de rede; retorna o status
 * (INVALID/EXPIRED/BLOCKED) para a UI tratar.
 */
export async function confirmSignupEmailCode(
  email: string,
  code: string
): Promise<{ status: SignupVerificationStatus; token?: string }> {
  const trimmed = (email ?? '').trim();
  const normalized = (code ?? '').replace(/\D/g, '');
  const { data, error } = await supabase.rpc('confirm_signup_email_code', {
    p_email: trimmed,
    p_code: normalized,
  });
  if (error) {
    throw new SignupVerificationError('Não foi possível validar o código.', 'NETWORK_ERROR');
  }
  const result = (data ?? {}) as { status?: SignupVerificationStatus; token?: string };
  return { status: result.status ?? 'INVALID', token: result.token };
}

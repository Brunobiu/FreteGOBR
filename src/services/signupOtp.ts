/**
 * services/signupOtp.ts
 *
 * Cliente da verificação de cadastro por TELEFONE (WhatsApp Cloud API com
 * fallback de e-mail) — migration 125. Substitui o canal de e-mail do
 * `signupVerification.ts` no fluxo de cadastro multi-step (dados → código →
 * senha), mantendo o e-mail apenas como identidade/recuperação.
 *
 *   1. requestSignupOtp(phone, email, forceEmail?) → RPC gera o código e dispara
 *      a Edge `send-signup-otp` (WhatsApp; em falha, e-mail). `forceEmail=true`
 *      é o fallback manual ("não recebi — enviar por e-mail").
 *   2. confirmSignupOtp(phone, code) → valida; retorna { status, token, channel }.
 *   3. o `token` é passado ao signup (auth.ts), que o consome no servidor.
 *
 * A normalização do telefone para E.164 é feita no servidor (RPC); aqui só
 * encaminhamos o que o usuário digitou. Para validação local use `phoneE164`.
 */

import { supabase } from './supabase';

export type SignupOtpStatus = 'OK' | 'INVALID' | 'EXPIRED' | 'BLOCKED';
export type SignupOtpChannel = 'whatsapp' | 'email';

export class SignupOtpError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_PHONE' | 'INVALID_EMAIL' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'SignupOtpError';
  }
}

/**
 * Solicita o envio de um código para o telefone (via WhatsApp, com fallback de
 * e-mail). Não revela se o telefone/e-mail já tem conta (anti-enumeração): a RPC
 * retorna ok sem enviar nesse caso, e o signup final aborta por duplicidade.
 *
 * @param forceEmail quando true, força o envio por e-mail (fallback manual).
 */
export async function requestSignupOtp(
  phone: string,
  email: string,
  forceEmail = false
): Promise<void> {
  const { error } = await supabase.rpc('request_signup_otp', {
    p_phone: (phone ?? '').trim(),
    p_email: (email ?? '').trim(),
    p_force_email: forceEmail,
  });

  if (error) {
    const msg = error.message ?? '';
    if (/invalid_phone/i.test(msg)) {
      throw new SignupOtpError('Informe um WhatsApp válido.', 'INVALID_PHONE');
    }
    if (/invalid_email/i.test(msg)) {
      throw new SignupOtpError('E-mail em formato inválido.', 'INVALID_EMAIL');
    }
    if (/rate_limited/i.test(msg)) {
      throw new SignupOtpError(
        'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        'RATE_LIMITED'
      );
    }
    throw new SignupOtpError('Não foi possível enviar o código.', 'NETWORK_ERROR');
  }
}

/**
 * Confirma o código digitado. Em sucesso, retorna o `token` (consumido no
 * signup) e o `channel` verificado. Lança erro de rede; retorna o status
 * (INVALID/EXPIRED/BLOCKED) para a UI tratar.
 */
export async function confirmSignupOtp(
  phone: string,
  code: string
): Promise<{ status: SignupOtpStatus; token?: string; channel?: SignupOtpChannel }> {
  const { data, error } = await supabase.rpc('confirm_signup_otp', {
    p_phone: (phone ?? '').trim(),
    p_code: (code ?? '').replace(/\D/g, ''),
  });

  if (error) {
    throw new SignupOtpError('Não foi possível validar o código.', 'NETWORK_ERROR');
  }

  const result = (data ?? {}) as {
    status?: SignupOtpStatus;
    token?: string;
    channel?: SignupOtpChannel;
  };
  return {
    status: result.status ?? 'INVALID',
    token: result.token,
    channel: result.channel,
  };
}

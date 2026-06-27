/**
 * services/passwordlessLogin.ts
 *
 * Cliente do login SEM SENHA (OTP por WhatsApp ou e-mail) — migration 126 +
 * Edge `login-otp-verify`. O login por senha continua existindo; este é uma
 * opção adicional (recuperação de acesso do motorista que esqueceu a senha).
 *
 *   1. requestLoginCode(identifier) → RPC `request_login_otp` gera o código e
 *      dispara o canal (WhatsApp se telefone, e-mail se e-mail). Anti-enumeração:
 *      sempre "ok"; nunca revela se a conta existe.
 *   2. verifyLoginCode(identifier, code) → Edge valida o código e devolve um
 *      `token_hash`; trocamos por uma sessão real via `supabase.auth.verifyOtp`.
 */

import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import { toE164BR } from '../utils/phoneE164';
import type { AuthResponse } from '../types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type IdentifierKind = 'email' | 'phone' | 'invalid';

/**
 * Classifica o identificador digitado (PURA — espelhada no servidor): contém
 * `@` ⇒ e-mail (válido se casar o formato); senão tenta telefone BR (E.164).
 */
export function classifyIdentifier(identifier: string): IdentifierKind {
  const id = (identifier ?? '').trim();
  if (id === '') return 'invalid';
  if (id.includes('@')) return EMAIL_RE.test(id) ? 'email' : 'invalid';
  return toE164BR(id) !== null ? 'phone' : 'invalid';
}

export class PasswordlessLoginError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_IDENTIFIER' | 'INVALID_CODE' | 'NETWORK_ERROR' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'PasswordlessLoginError';
  }
}

/**
 * Solicita o envio do código de login para o identificador. Retorna o canal
 * detectado (para a UI exibir "enviado para seu WhatsApp/e-mail"). Não revela
 * se a conta existe (anti-enumeração).
 */
export async function requestLoginCode(identifier: string): Promise<{ kind: IdentifierKind }> {
  const kind = classifyIdentifier(identifier);
  if (kind === 'invalid') {
    throw new PasswordlessLoginError('Informe um e-mail ou WhatsApp válido.', 'INVALID_IDENTIFIER');
  }
  const { error } = await supabase.rpc('request_login_otp', { p_identifier: identifier.trim() });
  if (error) {
    throw new PasswordlessLoginError('Não foi possível enviar o código.', 'NETWORK_ERROR');
  }
  return { kind };
}

/**
 * Verifica o código e estabelece a sessão. A Edge valida o código e devolve um
 * `token_hash` (magiclink); trocamos por sessão com `verifyOtp`. Retorna o
 * `AuthResponse` (consumido pelo `useAuth.loginWithCode`).
 */
export async function verifyLoginCode(identifier: string, code: string): Promise<AuthResponse> {
  const normalizedCode = (code ?? '').replace(/\D/g, '');

  const { data, error } = await supabase.functions.invoke('login-otp-verify', {
    body: { identifier: identifier.trim(), code: normalizedCode },
  });
  if (error) {
    throw new PasswordlessLoginError('Não foi possível validar o código.', 'NETWORK_ERROR');
  }

  const result = (data ?? {}) as { ok?: boolean; token_hash?: string };
  if (!result.ok || !result.token_hash) {
    throw new PasswordlessLoginError('Código incorreto ou expirado.', 'INVALID_CODE');
  }

  // Troca o token_hash (magiclink) por uma sessão real do Supabase.
  const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: result.token_hash,
    type: 'magiclink',
  });
  if (verifyErr || !verifyData.session || !verifyData.user) {
    throw new PasswordlessLoginError('Não foi possível concluir o login.', 'UNKNOWN');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new PasswordlessLoginError('Não foi possível carregar o usuário.', 'UNKNOWN');
  }

  return {
    user,
    accessToken: verifyData.session.access_token,
    refreshToken: verifyData.session.refresh_token,
    expiresIn: verifyData.session.expires_in ?? 3600,
  };
}

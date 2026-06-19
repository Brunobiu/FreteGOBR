/**
 * cliente360/loginCorrelation.ts — correlacao de login por telefone (PURO).
 *
 * Espelha a clausula `WHERE regexp_replace(COALESCE(phone,''),'\D','','g') =
 * v_digits` de `admin_user_login_history` (migration 116). A correlacao usa o
 * telefone normalizado (somente digitos); quando o Cliente nao tem telefone, o
 * conjunto e vazio (has_phone=false na RPC).
 *
 * Alvo da Correctness Property CP-9* (opcional). Reusa normalizeDigits de
 * admin-users.
 *
 * Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md (Task 3.3).
 */

import { normalizeDigits } from '../users';

/** Telefone -> somente digitos. Espelha regexp_replace(\D). null/'' => ''. */
export function normalizePhoneForCorrelation(phone: string | null | undefined): string {
  if (phone == null) return '';
  return normalizeDigits(phone);
}

/**
 * true sse o Cliente tem telefone E o telefone normalizado da tentativa e
 * igual ao do Cliente. Sem telefone do Cliente => sempre false (lista vazia).
 * Invariante a mascara/formatacao (so digitos contam). (CP-9*)
 */
export function loginAttemptMatchesUser(
  attemptPhone: string | null | undefined,
  userPhone: string | null | undefined
): boolean {
  const user = normalizePhoneForCorrelation(userPhone);
  if (user.length === 0) return false;
  return normalizePhoneForCorrelation(attemptPhone) === user;
}

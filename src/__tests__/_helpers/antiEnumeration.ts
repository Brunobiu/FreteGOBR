/**
 * Assertions canônicas anti-enumeração — spec `testes` (Tarefa 2).
 *
 * Decisão oficial: em falhas de autenticação, envio de código e cadastro
 * duplicado, retornar SEMPRE a mensagem canônica anti-enumeration, e as
 * respostas para identidades existentes e inexistentes devem ser
 * indistinguíveis. Dados parciais podem existir temporariamente antes do
 * cleanup (não é exigido ausência de registros parciais).
 *
 * Validates: Requirements 7.6, 7.7, 7.8, 18.3
 */

import { expect } from 'vitest';

/** Mensagens canônicas user-facing (pt-BR) — project-conventions.md. */
export const CANONICAL_MESSAGES = {
  AUTH: 'Não foi possível autenticar.',
  SIGNUP: 'Não foi possível concluir o cadastro.',
  CODE: 'Não foi possível enviar o código.',
} as const;

export type CanonicalKind = keyof typeof CANONICAL_MESSAGES;

/** Aprova se a mensagem for exatamente a canônica do tipo informado. */
export function expectAntiEnumeration(message: string, kind: CanonicalKind): void {
  expect(message).toBe(CANONICAL_MESSAGES[kind]);
}

/**
 * Aprova se as duas respostas (identidade existente vs inexistente) forem
 * indistinguíveis — mesma mensagem e mesmo status. Impede enumeração.
 */
export function expectIndistinguishable(
  existing: { message: string; status?: number },
  nonExisting: { message: string; status?: number }
): void {
  expect(existing.message).toBe(nonExisting.message);
  if (existing.status !== undefined || nonExisting.status !== undefined) {
    expect(existing.status).toBe(nonExisting.status);
  }
}

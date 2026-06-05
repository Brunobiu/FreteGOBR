/**
 * Assertions canônicas de autorização — spec `testes` (Tarefa 2).
 *
 * Centraliza a decisão oficial de governança:
 *   "Quando um usuário não possui permissão para uma ação protegida, o
 *    sistema deve SEMPRE retornar permission_denied, mesmo que existam
 *    outros erros de validação simultaneamente."
 *
 * Validates: Requirements 16.5
 */

import { expect } from 'vitest';

/**
 * Extrai o error code de diferentes formatos de erro usados no projeto:
 *   - Error com `.code`
 *   - PostgrestError-like com `.code` ou `.message`
 *   - string direta
 *   - objeto `{ error }` ou `{ code }`
 */
export function extractErrorCode(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.code === 'string') return o.code;
    if (typeof o.error === 'string') return o.error;
    if (typeof o.message === 'string') return o.message;
  }
  return String(err);
}

/**
 * Aprova SOMENTE se o resultado/erro indicar `permission_denied`.
 * Reprova se vier qualquer outro código — inclusive erros de validação
 * que possam ter ocorrido simultaneamente (precedência de permission_denied).
 */
export function expectPermissionDenied(err: unknown): void {
  const code = extractErrorCode(err);
  expect(code, `esperava permission_denied, recebeu: ${code}`).toContain('permission_denied');
}

/**
 * Garante que uma Promise rejeita com permission_denied. Útil para RPCs
 * SECURITY DEFINER que lançam exceção.
 */
export async function expectRejectsPermissionDenied(p: Promise<unknown>): Promise<void> {
  let resolved = false;
  let caught: unknown;
  try {
    await p;
    resolved = true;
  } catch (err) {
    caught = err;
  }
  if (resolved) {
    expect.fail('esperava rejeição com permission_denied, mas resolveu');
  }
  expectPermissionDenied(caught);
}

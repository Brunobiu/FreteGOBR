/**
 * inferTitle.ts — Inferência de título de conversa a partir da primeira mensagem.
 *
 * Retorna no máximo 40 caracteres. Se o input ultrapassar, trunca com "…".
 */

const MAX_TITLE_LENGTH = 40;

export function inferTitle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'Nova conversa';
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TITLE_LENGTH - 1) + '…';
}

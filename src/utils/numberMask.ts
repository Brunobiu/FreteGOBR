/**
 * Máscara de input numérico com casas decimais fixas.
 *
 * O usuário só digita números — a vírgula é colocada automaticamente
 * conforme as casas decimais configuradas. Útil para campos como
 * "Valor do diesel" (5,99 a partir de "599") ou "Capacidade em toneladas"
 * (47,000 a partir de "47000").
 *
 * Funções puras (sem React, Supabase ou DOM).
 */

/**
 * Aplica máscara em uma string de dígitos com N casas decimais.
 * - `maskDecimal("599", 2)`   → "5,99"
 * - `maskDecimal("47000", 3)` → "47,000"
 * - `maskDecimal("25", 1)`    → "2,5"
 * - `maskDecimal("5", 2)`     → "0,05"
 * - `maskDecimal("", 2)`      → ""
 */
export function maskDecimal(raw: string, decimals: number): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits === '') return '';
  if (decimals <= 0) return digits.replace(/^0+(?=\d)/, '');

  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const decPart = padded.slice(padded.length - decimals);
  return `${intPart},${decPart}`;
}

/**
 * Extrai apenas os dígitos de uma string mascarada.
 */
export function unmaskDecimal(masked: string): string {
  return (masked ?? '').replace(/\D/g, '');
}

/**
 * Converte uma string mascarada em número.
 * - `maskedToNumber("5,99", 2)`   → 5.99
 * - `maskedToNumber("47,000", 3)` → 47
 * - `maskedToNumber("", 2)`       → NaN
 */
export function maskedToNumber(masked: string, decimals: number): number {
  const digits = unmaskDecimal(masked);
  if (digits === '') return NaN;
  return parseInt(digits, 10) / Math.pow(10, decimals);
}

/**
 * Converte um número em string mascarada com N casas decimais.
 * - `numberToMasked(5.99, 2)`  → "5,99"
 * - `numberToMasked(30, 3)`    → "30,000"
 * - `numberToMasked(null, 2)`  → ""
 */
export function numberToMasked(
  n: number | null | undefined,
  decimals: number
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toFixed(decimals).replace('.', ',');
}

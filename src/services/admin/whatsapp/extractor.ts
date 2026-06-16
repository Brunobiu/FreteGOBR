/**
 * Contact Extractor — lógica pura (sem I/O) do WhatsApp_Module (Req 17).
 *
 * Este arquivo concentra, por enquanto, apenas a construção da
 * **Dispatch_Ready_List** (Req 17.6, 17.9, 17.10): a string de Contact_Numbers
 * únicos e válidos, separados por vírgula e SEM espaços, pronta para ser colada
 * no Disparo em Massa. As partes de RPC/serviço (estatísticas, dedup entre
 * grupos com I/O, CSV) ficam nas tasks 18.1/18.2.
 *
 * A validação NÃO é reimplementada aqui: reusa `normalizeNumbers` de
 * `validation.ts`, que já normaliza (E.164), deduplica e separa válidos de
 * inválidos. Como a saída do extrator é para colar no Disparo em Massa, os
 * números são emitidos em dígitos (E.164 sem o `+`), ex.: `5511999999999`.
 *
 * Funções PURAS: não realizam I/O e não lançam exceções.
 *
 * Identifiers em inglês; comentários em pt-BR (convenção FreteGO).
 */

import { normalizeNumbers } from './validation';

/** Separador da Dispatch_Ready_List: vírgula SEM espaços (Req 17.6). */
const DISPATCH_READY_SEPARATOR = ',';

/** Código de país do Brasil; removido do prefixo E.164 para emitir dígitos. */
const BR_COUNTRY_CODE = '55';

/**
 * Deduplica e mantém apenas os Contact_Numbers válidos de uma extração,
 * em dígitos (E.164 sem o `+`), preservando a ordem da primeira ocorrência.
 *
 * Regras (Req 17.9, 17.10):
 * - Números inválidos são EXCLUÍDOS (não entram no resultado).
 * - Duplicatas (após normalização) são removidas.
 * - A operação é IDEMPOTENTE: como os valores de saída já estão normalizados,
 *   aplicar a função sobre o próprio resultado produz o mesmo resultado
 *   (`dedupValidNumbers(dedupValidNumbers(x)) === dedupValidNumbers(x)`).
 *
 * @param numbers Lista bruta de Contact_Numbers (pode conter repetidos/inválidos).
 * @returns Números válidos, únicos, em dígitos, na ordem de primeira ocorrência.
 */
export function dedupValidNumbers(numbers: readonly string[]): string[] {
  if (!numbers || numbers.length === 0) return [];

  // Reaproveita toda a lógica de normalização/dedup/validação de validation.ts.
  // Junta por quebra de linha (separador aceito por normalizeNumbers) para
  // tratar cada item como um token independente.
  const raw = numbers.join('\n');
  const { valid } = normalizeNumbers(raw);

  // `valid` vem em E.164 (`+55...`) já deduplicado; emite em dígitos puros.
  return valid.map(toDigits);
}

/**
 * Constrói a Dispatch_Ready_List: números válidos e únicos juntados por vírgula
 * SEM espaços (Req 17.6), prontos para colar no Disparo em Massa.
 *
 * Ex.: `['+5511999999999', '5511888888888', '11999999999']`
 *      → `'5511999999999,5511888888888'`
 *
 * @param numbers Lista bruta de Contact_Numbers.
 * @returns String comma-joined sem espaços (vazia se não houver válidos).
 */
export function buildDispatchReadyList(numbers: readonly string[]): string {
  return dedupValidNumbers(numbers).join(DISPATCH_READY_SEPARATOR);
}

/** Remove o prefixo `+55` do formato E.164, retornando apenas dígitos. */
function toDigits(e164: string): string {
  const withoutPlus = e164.startsWith('+') ? e164.slice(1) : e164;
  return withoutPlus.startsWith(BR_COUNTRY_CODE) ? withoutPlus : `${BR_COUNTRY_CODE}${withoutPlus}`;
}

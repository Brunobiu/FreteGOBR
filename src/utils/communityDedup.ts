/**
 * Núcleo puro de deduplicação de fretes (FreteGO) — spec frete-comunidade.
 *
 * Regra (Req 12, ajustada com o dono): um frete só é DUPLICADO de outro quando
 * TODOS os campos significativos coincidem. Se UM único campo diferir
 * (ex.: transportadora ou telefone), os fretes coexistem (não são duplicados) —
 * porque várias transportadoras anunciam o mesmo trajeto.
 *
 * A Dedup_Key é a especificação executável (paridade com o índice único
 * funcional no SQL, migration 061). A normalização textual aqui DEVE bater com
 * a normalização SQL (`lower(regexp_replace(btrim(x), '\s+', ' ', 'g'))`):
 * trim + colapso de espaços internos + caixa-baixa. NÃO remove acentos (manter
 * paridade sem depender da extensão unaccent no Postgres).
 */

export interface DedupFields {
  origin: string;
  destination: string;
  originDetail: string;
  destinationDetail: string;
  value: number;
  product: string;
  carrierName: string;
  contactPhone: string;
}

/**
 * Normalização textual canônica: trim + colapso de espaços internos +
 * caixa-baixa. Espelha `lower(regexp_replace(btrim(x), '\s+', ' ', 'g'))`.
 */
export function normalizeDedupText(s: string): string {
  return (s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Normaliza o valor para 2 casas decimais (espelha `round(value, 2)`). */
function normalizeValue(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Só dígitos do telefone (espelha `regexp_replace(phone, '\D', '', 'g')`). */
function normalizePhoneDigits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Dedup_Key determinística sobre TODOS os campos (Req 7.3, 12.6). Componentes
 * separados por `\u0001` (caractere de controle improvável no conteúdo) para
 * evitar colisão por concatenação ("ab"+"c" vs "a"+"bc").
 */
export function computeDedupKey(f: DedupFields): string {
  return [
    normalizeDedupText(f.origin),
    normalizeDedupText(f.destination),
    normalizeDedupText(f.originDetail),
    normalizeDedupText(f.destinationDetail),
    normalizeValue(f.value),
    normalizeDedupText(f.product),
    normalizeDedupText(f.carrierName),
    normalizePhoneDigits(f.contactPhone),
  ].join('\u0001');
}

/**
 * `true` sse as duas tuplas COMPLETAS coincidem após normalização. Simétrico
 * por construção (compara as chaves canônicas).
 */
export function isDuplicate(a: DedupFields, b: DedupFields): boolean {
  return computeDedupKey(a) === computeDedupKey(b);
}

/**
 * Helpers de capitalização para nomes de pessoas e empresas em pt-BR.
 *
 * Regra: primeira letra de cada palavra em maiúsculo, EXCETO conectores
 * curtos comuns em português (de, da, do, das, dos, e). Sempre o primeiro
 * token é capitalizado.
 *
 * Exemplos:
 *   "joao da silva"        -> "Joao da Silva"
 *   "MARIA DOS SANTOS"     -> "Maria dos Santos"
 *   "transportes e logística" -> "Transportes e Logística"
 */

const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Capitaliza um texto seguindo a regra de nomes em pt-BR.
 */
export function capitalizeName(value: string): string {
  if (!value) return '';
  const trimmed = value.replace(/\s+/g, ' ');
  return trimmed
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (!word) return word;
      if (index > 0 && CONNECTORS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

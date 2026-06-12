/**
 * services/cache/cacheKey.ts
 *
 * Derivação de chave estável para o Data_Cache em memória.
 *
 * `deriveKey(namespace, params)` produz uma chave determinística no formato
 * `"namespace|<json-canonico>"`. A canonicalização ordena recursivamente as
 * chaves de objetos e normaliza `undefined`, de modo que dois conjuntos de
 * parâmetros semanticamente equivalentes (mesmas propriedades e valores, em
 * qualquer ordem) gerem exatamente a mesma chave.
 *
 * Garantias (Correctness Property 11 do design):
 * - Independência de ordem: a ordem das propriedades de um objeto não afeta a
 *   chave resultante.
 * - Distinção semântica: parâmetros que diferem em qualquer valor — inclusive o
 *   tipo (ex.: `1` vs `"1"`, `null` vs `"null"`, `true` vs `"true"`) — produzem
 *   chaves diferentes.
 * - Normalização de `undefined`: uma propriedade ausente e uma propriedade com
 *   valor `undefined` são tratadas como equivalentes (`{ a: undefined }` ≡ `{}`).
 *
 * Não introduz dependências de runtime: a canonicalização é feita por um
 * serializador recursivo próprio (sem `JSON.stringify` direto, que descarta
 * `undefined`, não ordena chaves e converteria `NaN`/`Infinity` em `null`).
 *
 * Requirements: 6.1, 6.2
 */

/**
 * Serializa um valor de forma canônica e determinística.
 *
 * O formato é um JSON canônico estendido: strings são citadas (via
 * `JSON.stringify`), números/booleanos/`null` são emitidos sem aspas, objetos
 * têm suas chaves ordenadas e propriedades `undefined` removidas, e arrays
 * preservam a ordem dos elementos (a ordem em array é semanticamente
 * relevante).
 */
function canonicalize(value: unknown): string {
  // Normalização de `undefined`: no nível de propriedade ele é removido antes
  // de chegar aqui; em outras posições (ex.: elemento de array, valor direto)
  // recebe um marcador estável e distinto de `null`.
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  switch (type) {
    case 'string':
      // Aspas garantem distinção entre, p.ex., a string "1" e o número 1.
      return JSON.stringify(value as string);
    case 'number':
      // `String` preserva NaN/Infinity de forma distinta (chave é só texto).
      return `#${String(value as number)}`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return `${(value as bigint).toString()}n`;
    case 'function':
    case 'symbol':
      // Tipos não serializáveis: marcador estável por descrição (uso atípico
      // em parâmetros de cache, mantido por robustez).
      return `@${type}:${String(value as symbol)}`;
    default:
      break;
  }

  // A partir daqui, `value` é um objeto.
  if (value instanceof Date) {
    return `Date(${value.getTime()})`;
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(',')}]`;
  }

  // Objeto "plano": ordenar chaves e descartar propriedades `undefined`.
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  const keys = Object.keys(record).sort();
  for (const key of keys) {
    const propValue = record[key];
    if (propValue === undefined) {
      // Normalização de `undefined`: equivalente à ausência da propriedade.
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${canonicalize(propValue)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Deriva uma chave de cache estável a partir de um namespace e parâmetros
 * opcionais. A chave é independente da ordem das propriedades dos parâmetros e
 * distingue qualquer diferença semântica de valor ou tipo.
 *
 * @param namespace Prefixo lógico do conjunto de dados (ex.: `"fretes:active"`).
 * @param params Parâmetros que identificam a requisição (objeto, array,
 *   primitivo ou `undefined`).
 * @returns Chave no formato `"namespace|<json-canonico>"`.
 */
export function deriveKey(namespace: string, params?: unknown): string {
  return `${namespace}|${canonicalize(params)}`;
}

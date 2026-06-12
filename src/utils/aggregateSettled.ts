/**
 * Agregador puro sobre `Promise.allSettled`.
 *
 * Dado um conjunto de "blocos" independentes identificados por chave
 * (cada bloco é uma função que devolve uma `Promise`), executa todos em
 * paralelo e devolve uma estrutura que **separa** os resultados
 * bem-sucedidos (`values`) das falhas (`errors`), isoladas por bloco.
 *
 * Garantias (Correctness Properties do design):
 * - **Property 5 — falhas parciais não bloqueiam sucessos**: a função
 *   sempre resolve (nunca rejeita). Um bloco que falha vai para `errors`
 *   e não impede que os blocos bem-sucedidos sejam expostos em `values`.
 * - **Property 6 — independência da ordem de resolução**: a estrutura
 *   agregada final depende apenas de quais blocos resolveram/rejeitaram
 *   (e com quais valores), nunca da ordem temporal em que as promises
 *   se resolvem. Cada resultado é endereçado pela sua chave, então a
 *   saída é determinística para um mesmo conjunto de entradas.
 *
 * Requirements: 4.1 (paralelismo de queries independentes), 4.3 (subconjunto
 * que falha não bloqueia os sucessos), 4.4 (dados finais equivalentes ao
 * baseline), 3.6 (degradação apenas na região afetada).
 *
 * Sem React, sem Supabase, sem DOM — lógica pura e testável por PBT.
 */

/**
 * Mapa de blocos: cada chave aponta para uma função que inicia uma
 * requisição/operação assíncrona independente.
 */
export type SettledBlocks = Record<string, () => Promise<unknown>>;

/**
 * Valor resolvido de um bloco específico (desembrulhando a `Promise`).
 */
type BlockValue<T extends SettledBlocks, K extends keyof T> = Awaited<ReturnType<T[K]>>;

/**
 * Resultado agregado da execução paralela dos blocos.
 *
 * - `values`: presente apenas para os blocos que resolveram com sucesso.
 * - `errors`: presente apenas para os blocos que rejeitaram.
 *
 * Para qualquer chave, ela aparece em **exatamente um** dos dois mapas.
 */
export interface AggregatedResult<T extends SettledBlocks> {
  values: { [K in keyof T]?: BlockValue<T, K> };
  errors: { [K in keyof T]?: unknown };
}

/**
 * Executa todos os `blocks` em paralelo via `Promise.allSettled` e agrega
 * os resultados por chave, isolando falhas.
 *
 * - Nunca rejeita: falhas individuais ficam em `result.errors[chave]`.
 * - Sucessos ficam em `result.values[chave]`.
 * - A saída é independente da ordem de resolução das promises (cada
 *   resultado é indexado pela sua chave de origem).
 *
 * @example
 * const { values, errors } = await aggregateSettled({
 *   fretes: () => getActiveFretes(filters),
 *   likes: () => getLikedFreteIds(userId),
 * });
 * if (values.fretes) renderFeed(values.fretes);
 * if (errors.likes) showRegionError('likes');
 */
export async function aggregateSettled<T extends SettledBlocks>(
  blocks: T
): Promise<AggregatedResult<T>> {
  const keys = Object.keys(blocks) as Array<keyof T>;

  const settled = await Promise.allSettled(keys.map((key) => blocks[key]()));

  const values: { [K in keyof T]?: BlockValue<T, K> } = {};
  const errors: { [K in keyof T]?: unknown } = {};

  keys.forEach((key, index) => {
    const outcome = settled[index];
    if (outcome.status === 'fulfilled') {
      values[key] = outcome.value as BlockValue<T, typeof key>;
    } else {
      errors[key] = outcome.reason;
    }
  });

  return { values, errors };
}

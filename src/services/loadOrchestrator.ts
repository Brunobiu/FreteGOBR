/**
 * services/loadOrchestrator.ts
 *
 * Orquestrador puro da ordem de carregamento da inicialização do App.
 *
 * A ordem estrita é Auth_State → Shell → Primary_Content → Secondary_Data,
 * modelada por uma prioridade ordenável por estágio (Requirements 3.1–3.4 e
 * Property 4 do design). Este módulo NÃO executa side effects: ele apenas
 * decide, dado o conjunto de estágios já iniciados, quais estágios podem
 * disparar a seguir. Toda a integração com a UI/serviços consome esta função
 * pura, o que torna a invariante de ordem testável de forma determinística.
 *
 * Invariante-chave (Property 4): nunca liberar um estágio de prioridade maior
 * antes que seu predecessor obrigatório tenha sido iniciado. A única exceção
 * é a regra de degradação 3.4: quando `auth` e `shell` já iniciaram e
 * `primary` não chega a iniciar, `secondary` ainda é liberável.
 */

/** Estágios de carregamento da inicialização, em ordem de prioridade. */
export type LoadStage = 'auth' | 'shell' | 'primary' | 'secondary';

/**
 * Prioridade ordenável de cada estágio: `auth(0) < shell(1) < primary(2) <
 * secondary(3)`. Valores menores carregam primeiro.
 */
export const STAGE_PRIORITY: Record<LoadStage, number> = {
  auth: 0,
  shell: 1,
  primary: 2,
  secondary: 3,
};

/** Todos os estágios em ordem crescente de prioridade. */
const STAGES_BY_PRIORITY: readonly LoadStage[] = (Object.keys(STAGE_PRIORITY) as LoadStage[]).sort(
  (a, b) => STAGE_PRIORITY[a] - STAGE_PRIORITY[b]
);

/**
 * Decide se um estágio específico pode ser iniciado dado o conjunto já
 * iniciado. Codifica os predecessores obrigatórios de cada estágio e a regra
 * de degradação 3.4 para `secondary`.
 *
 * Predecessores obrigatórios (garantem a invariante da Property 4 para
 * qualquer conjunto de entrada):
 * - `auth`: nenhum.
 * - `shell`: requer `auth` iniciado (Req 3.1).
 * - `primary`: requer `auth` e `shell` iniciados — `primary` nunca inicia sem
 *   `auth` (Req 3.1, 3.2).
 * - `secondary`: requer `shell` iniciado — `secondary` nunca inicia sem
 *   `shell` (predecessor obrigatório). Isso cobre tanto o fluxo normal (após
 *   `primary` iniciar, Req 3.3) quanto a degradação 3.4: quando `auth` e
 *   `shell` já iniciaram e `primary` não chega a iniciar, `secondary` continua
 *   liberável porque seu único predecessor obrigatório (`shell`) está presente.
 */
function canStart(stage: LoadStage, started: ReadonlySet<LoadStage>): boolean {
  if (started.has(stage)) return false;

  switch (stage) {
    case 'auth':
      return true;
    case 'shell':
      return started.has('auth');
    case 'primary':
      return started.has('auth') && started.has('shell');
    case 'secondary':
      return started.has('shell');
    default:
      return false;
  }
}

/**
 * Retorna os estágios que podem ser iniciados a seguir, dado o conjunto de
 * estágios já iniciados. O resultado é determinístico e ordenado por
 * prioridade crescente.
 *
 * A função é pura: não muta `started` nem produz side effects.
 */
export function nextStartableStages(started: ReadonlySet<LoadStage>): LoadStage[] {
  return STAGES_BY_PRIORITY.filter((stage) => canStart(stage, started));
}

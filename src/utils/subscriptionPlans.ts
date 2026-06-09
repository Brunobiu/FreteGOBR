/**
 * Catálogo de planos de assinatura do Motorista (FreteGO) — núcleo puro.
 *
 * Módulo SEM dependências de I/O (sem `supabase`, sem React). É a fonte de
 * verdade dos planos exibidos na tela de assinatura e o alvo da Correctness
 * Property 1 (`cp1_subscription_plans.property.test.ts`).
 *
 * Apenas o Motorista paga (spec `assinaturas-pagamento`). São três planos, todos
 * cobrados em PARCELA ÚNICA no momento da contratação; a recorrência renova
 * somente ao fim do ciclo contratado.
 *
 * Valores (decisão de produto confirmada):
 *   - mensal:     R$ 39,90/mês × 1 mês  = R$ 39,90
 *   - trimestral: R$ 34,90/mês × 3 meses = R$ 104,70
 *   - semestral:  R$ 29,90/mês × 6 meses = R$ 179,40  (plano em destaque)
 */

/** Identificador estável do plano (inglês para identifier). */
export type PlanId = 'mensal' | 'trimestral' | 'semestral';

export interface Plan {
  /** Identificador estável. */
  id: PlanId;
  /** Nome user-facing (pt-BR). */
  name: string;
  /** Duração do ciclo contratado, em meses. */
  months: number;
  /** Preço por mês em reais (R$). */
  monthlyPrice: number;
  /** `true` para o plano que deve aparecer em destaque (semestral). */
  recommended: boolean;
}

/**
 * Catálogo imutável dos três planos. A ordem é a ordem de exibição na tela
 * (semestral em destaque primeiro → trimestral → mensal por último: melhor
 * preço na frente).
 */
export const PLANS: readonly Plan[] = [
  { id: 'semestral', name: 'Semestral', months: 6, monthlyPrice: 29.9, recommended: true },
  { id: 'trimestral', name: 'Trimestral', months: 3, monthlyPrice: 34.9, recommended: false },
  { id: 'mensal', name: 'Mensal', months: 1, monthlyPrice: 39.9, recommended: false },
] as const;

/**
 * Arredondamento half-away-from-zero para 2 casas decimais. Espelha
 * `Math.round(x*100)/100` (TS) e `ROUND(x, 2)` (PostgreSQL) — mesmo padrão de
 * `computeCommission`/`round2` do projeto, para paridade SQL↔TS.
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Total a pagar de um plano: `monthlyPrice * months`, arredondado a 2 casas.
 *
 * - mensal     ⇒ 39,90
 * - trimestral ⇒ 104,70
 * - semestral  ⇒ 179,40
 *
 * Função pura e total: entrada inválida (monthlyPrice/months não-finitos)
 * resolve para 0 via {@link round2}.
 */
export function computePlanTotal(plan: Plan): number {
  return round2(plan.monthlyPrice * plan.months);
}

/** Localiza um plano pelo seu identificador; `undefined` se não existir. */
export function getPlanById(id: PlanId): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** O plano recomendado (em destaque) — o semestral. */
export function getRecommendedPlan(): Plan {
  // PLANS sempre contém exatamente um plano recomendado (semestral).
  return PLANS.find((p) => p.recommended) ?? PLANS[PLANS.length - 1];
}

/**
 * Formata um valor em reais no padrão pt-BR (ex.: `R$ 39,90`). Mantido aqui
 * para reuso na tela de planos; valores não-finitos ⇒ `R$ 0,00`.
 */
export function formatPlanBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safe);
}

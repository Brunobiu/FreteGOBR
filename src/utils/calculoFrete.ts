/**
 * Cálculo financeiro estimado por frete.
 *
 * Funções puras (sem React, Supabase ou DOM). Usadas por `FreteCard` no
 * painel do motorista e por testes baseados em propriedade.
 */

export interface CalculoFreteInput {
  /** Distância da rota em quilômetros (vem de `fretes.distance_km`). */
  distanceKm: number;
  /** Consumo do cavalo em km por litro. */
  kmPerLiter: number;
  /** Preço atual do diesel em R$ por litro. */
  dieselPrice: number;
  /** Valor bruto pago pelo embarcador (em reais). */
  freteValue: number;
}

export interface CalculoFreteOutput {
  /** Litros consumidos estimados, arredondados a 2 casas. */
  litros: number;
  /** Custo de diesel em reais, arredondado a 2 casas. */
  custoDiesel: number;
  /**
   * Pedágio. Por enquanto sempre `null` — placeholder até a API de
   * pedágios ser implementada (ver `.kiro/PARA_DEPOIS.md`).
   */
  pedagio: null;
  /** Lucro líquido estimado: `freteValue - custoDiesel` (sem pedágio). */
  lucroLiquido: number;
}

/**
 * Arredonda para 2 casas decimais usando aritmética inteira (evita
 * imprecisões de ponto flutuante em casos comuns).
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Formata um número como moeda brasileira (R$ 1.234,56).
 */
export function formatCurrencyBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

/**
 * Calcula custos e lucro estimado para um frete.
 *
 * Pré-condições:
 *   - `distanceKm >= 0`
 *   - `kmPerLiter > 0`
 *   - `dieselPrice >= 0`
 *   - `freteValue >= 0`
 *
 * Comportamento:
 *   - `litros = round2(distanceKm / kmPerLiter)`
 *   - `custoDiesel = round2(litros * dieselPrice)`
 *   - `pedagio = null` (placeholder)
 *   - `lucroLiquido = round2(freteValue - custoDiesel)` — pode ser
 *     negativo se o frete não cobrir o diesel.
 */
export function calculateFreteFinanceiro(input: CalculoFreteInput): CalculoFreteOutput {
  const litros = round2(input.distanceKm / input.kmPerLiter);
  const custoDiesel = round2(litros * input.dieselPrice);
  const lucroLiquido = round2(input.freteValue - custoDiesel);
  return {
    litros,
    custoDiesel,
    pedagio: null,
    lucroLiquido,
  };
}

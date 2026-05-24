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
  /** Valor pago pelo embarcador (em reais). Pode ser por tonelada ou total. */
  freteValue: number;
  /**
   * Capacidade de carga do caminhão do motorista em toneladas.
   * Quando `freteValue` é o preço por tonelada, multiplicamos por aqui
   * para chegar ao bruto. Default `1` (preserva comportamento legado de
   * frete fechado, sem multiplicação).
   */
  cargoCapacityTon?: number;
  /**
   * Modo de pagamento do frete.
   *  - `'closed'` (padrão): `freteValue` já é o bruto total.
   *  - `'per_ton'`: bruto = `freteValue * cargoCapacityTon`.
   */
  pricingMode?: 'closed' | 'per_ton';
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
  /**
   * Valor bruto efetivamente recebido pelo motorista — depois de
   * aplicar o modo de pagamento (por tonelada ou fechado).
   */
  brutoRecebido: number;
  /** Lucro líquido estimado: `brutoRecebido - custoDiesel` (sem pedágio). */
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
 * Comportamento:
 *   - `litros = round2(distanceKm / kmPerLiter)`
 *   - `custoDiesel = round2(litros * dieselPrice)`
 *   - `brutoRecebido`:
 *       * `pricingMode === 'per_ton'`: `round2(freteValue * cargoCapacityTon)`
 *       * caso contrário: `freteValue` (fechado)
 *   - `pedagio = null` (placeholder)
 *   - `lucroLiquido = round2(brutoRecebido - custoDiesel)`
 */
export function calculateFreteFinanceiro(input: CalculoFreteInput): CalculoFreteOutput {
  const litros = round2(input.distanceKm / input.kmPerLiter);
  const custoDiesel = round2(litros * input.dieselPrice);
  const cap = input.cargoCapacityTon ?? 1;
  const brutoRecebido =
    input.pricingMode === 'per_ton' ? round2(input.freteValue * cap) : input.freteValue;
  const lucroLiquido = round2(brutoRecebido - custoDiesel);
  return {
    litros,
    custoDiesel,
    pedagio: null,
    brutoRecebido,
    lucroLiquido,
  };
}

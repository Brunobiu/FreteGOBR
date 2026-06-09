/**
 * Núcleo puro da auto-expiração de fretes (FreteGO) — spec frete-comunidade,
 * regra transversal (Req 11): vale para TODOS os fretes (embarcador real +
 * comunidade), não só comunidade.
 *
 * Regra: um frete é visível no feed enquanto `now < refDate + 5 dias`. A data
 * de referência (`Data_Referencia_Expiracao`) é o `updated_at` do frete, que
 * inicia igual ao `created_at` e é reiniciado para `NOW()` a cada edição
 * (trigger `fretes_touch_expiry` no SQL). Estes predicados são o espelho TS da
 * condição usada na `fretes_select_policy` (RLS), validados por property test.
 */

export const EXPIRY_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = EXPIRY_DAYS * DAY_MS;

/**
 * Data de referência da expiração: o `updated_at` do frete. Existe como função
 * nomeada para deixar explícita a decisão de design (e facilitar mudança futura).
 */
export function expiryReferenceDate(frete: { updatedAt: Date }): Date {
  return frete.updatedAt;
}

/**
 * Visível sse `now < refDate + 5 dias` (Req 11.1/11.5). Datas inválidas
 * (NaN) ⇒ não visível (fail-safe: não mostra frete com data corrompida).
 */
export function isVisibleByExpiry(refDate: Date, now: Date = new Date()): boolean {
  const ref = refDate?.getTime?.();
  const t = now?.getTime?.();
  if (ref == null || t == null || Number.isNaN(ref) || Number.isNaN(t)) return false;
  return t < ref + WINDOW_MS;
}

/**
 * Dias inteiros restantes até a expiração (>= 0), para exibição na lista admin
 * (Req 3.3). Já expirado ⇒ 0. Datas inválidas ⇒ 0.
 */
export function daysUntilExpiry(refDate: Date, now: Date = new Date()): number {
  const ref = refDate?.getTime?.();
  const t = now?.getTime?.();
  if (ref == null || t == null || Number.isNaN(ref) || Number.isNaN(t)) return 0;
  const remainingMs = ref + WINDOW_MS - t;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}

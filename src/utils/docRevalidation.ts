/**
 * Núcleo puro da revalidação periódica de documentos do motorista (FreteGO).
 *
 * Regra de negócio (confirmada com o usuário):
 *   Cada GRUPO de documentos do motorista — Tração, Carroceria, Complemento,
 *   Referências e Contrato — vale por 30 dias corridos a partir da data de
 *   confirmação/aprovação (`confirmed_at`). Cada grupo conta sozinho: um pode
 *   vencer hoje e outro só amanhã.
 *
 *   Vencido o prazo, o motorista é avisado (notificação + modal central) e
 *   deve confirmar que continua com os mesmos documentos. Um único botão
 *   ("Sim, continua tudo igual") reseta TODOS os grupos para +30 dias — não é
 *   preciso reenviar documento.
 *
 * Este módulo é SEM I/O (sem `supabase`, sem React) e é o espelho TypeScript
 * da lógica SQL em `get_my_doc_revalidation` / `motorista_can_interact`
 * (migration 073). É o alvo primário de property-based testing.
 */

/** Grupos sujeitos à revalidação periódica (perfil/CNH NÃO entra — raramente muda). */
export type RevalidationGroup =
  | 'tracao'
  | 'carroceria'
  | 'complemento'
  | 'referencias'
  | 'contrato';

/** Ordem canônica dos grupos (usada em UI e iteração determinística). */
export const REVALIDATION_GROUPS: readonly RevalidationGroup[] = [
  'tracao',
  'carroceria',
  'complemento',
  'referencias',
  'contrato',
] as const;

/** Rótulos pt-BR para exibição no modal/notificação. */
export const REVALIDATION_GROUP_LABELS: Record<RevalidationGroup, string> = {
  tracao: 'Tração',
  carroceria: 'Carroceria',
  complemento: 'Complemento',
  referencias: 'Referências',
  contrato: 'Contrato',
};

/** Validade de cada grupo, em dias corridos. */
export const REVALIDATION_DAYS = 30;

/** Milissegundos em um dia (24h). */
const DAY_MS = 86_400_000;

/** Janela de validade em milissegundos. */
const WINDOW_MS = REVALIDATION_DAYS * DAY_MS;

/**
 * Mapa de confirmação por grupo. `null` significa "nunca confirmado" e é
 * tratado como vencido (precisa confirmar). Aceita `Date` ou string ISO.
 */
export type GroupConfirmations = Record<RevalidationGroup, Date | string | null>;

function toTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Um grupo está vencido quando:
 *   - nunca foi confirmado (`confirmedAt == null`/inválido), OU
 *   - `now - confirmedAt > 30 dias`.
 *
 * Exatamente no instante dos 30 dias (`now - confirmedAt === WINDOW_MS`) o
 * grupo ainda está válido; vence a partir do milissegundo seguinte. Função
 * total: nunca lança.
 */
export function isGroupExpired(confirmedAt: Date | string | null, now: Date): boolean {
  const t = toTime(confirmedAt);
  if (t == null) return true;
  return now.getTime() - t > WINDOW_MS;
}

/**
 * Dias restantes até o vencimento de um grupo:
 * `max(0, ceil((confirmedAt + 30d - now) / 86400000))`.
 * `null`/inválido ou já vencido ⇒ `0`.
 */
export function groupDaysLeft(confirmedAt: Date | string | null, now: Date): number {
  const t = toTime(confirmedAt);
  if (t == null) return 0;
  const expiresAt = t + WINDOW_MS;
  const diff = expiresAt - now.getTime();
  return Math.max(0, Math.ceil(diff / DAY_MS));
}

/**
 * Lista (na ordem canônica) os grupos vencidos dado o mapa de confirmações.
 * Total: sempre retorna um array (possivelmente vazio).
 */
export function computeExpiredGroups(
  confirmations: GroupConfirmations,
  now: Date
): RevalidationGroup[] {
  return REVALIDATION_GROUPS.filter((g) => isGroupExpired(confirmations[g], now));
}

/**
 * O motorista precisa revalidar? `true` sse pelo menos um grupo está vencido.
 */
export function needsRevalidation(confirmations: GroupConfirmations, now: Date): boolean {
  return REVALIDATION_GROUPS.some((g) => isGroupExpired(confirmations[g], now));
}

/**
 * Billing_Notifier — lógica pura de seleção (FreteGO, spec assinaturas-pagamento).
 *
 * Espelho em TypeScript puro da função SQL `run_billing_notifications()`
 * (migration 059). O cliente NUNCA é a fonte de verdade: o cron diário no
 * Postgres é a autoridade. Estes predicados são a especificação executável
 * (paridade SQL↔TS) e existem para serem testados por property-based tests,
 * sem I/O nem dependência de banco.
 *
 * Regras (design.md §6 "Billing_Notifier"):
 *   - Aviso de trial vencendo: SOMENTE motoristas com `is_subscribed=false`,
 *     `subscription_status='trial'`, `trial_ends_at` na janela [now+1d, now+2d].
 *     Anti-disparo-em-massa: ninguém fora da janela é selecionado.
 *   - Suspensão por grace esgotado: assinaturas `status='past_due'` cujo
 *     `grace_ends_at` já passou (`< now`).
 *
 * Janela de trial em milissegundos a partir de `now`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Entrada mínima de um usuário para o aviso de trial vencendo. */
export interface TrialExpiringInput {
  userType: 'motorista' | 'embarcador' | 'admin';
  isSubscribed: boolean;
  subscriptionStatus: 'trial' | 'active' | 'past_due' | 'canceled' | 'blocked';
  /** `users.trial_ends_at` — `null` quando nunca teve trial. */
  trialEndsAt: Date | null;
}

/** Entrada mínima de uma assinatura para a reconciliação de suspensão. */
export interface SuspensionCandidateInput {
  /** `subscriptions.status` (detalhe, inclui 'suspended'). */
  status: 'active' | 'past_due' | 'suspended' | 'canceled';
  /** `subscriptions.grace_ends_at` — `null` quando não está em grace. */
  graceEndsAt: Date | null;
}

/**
 * `true` quando o usuário deve receber `plan_trial_expiring` nesta execução.
 *
 * Janela fechada [now+1d, now+2d] — idêntica ao WHERE da SQL
 * (`trial_ends_at >= now + 1 day AND trial_ends_at <= now + 2 days`).
 * A idempotência (no máx. 1 não-lida por user+type) é garantida pelo índice
 * único parcial no banco, não aqui.
 */
export function shouldNotifyTrialExpiring(
  input: TrialExpiringInput,
  now: Date = new Date()
): boolean {
  if (input.userType !== 'motorista') return false;
  if (input.isSubscribed) return false;
  if (input.subscriptionStatus !== 'trial') return false;
  if (input.trialEndsAt === null) return false;

  const t = input.trialEndsAt.getTime();
  if (Number.isNaN(t)) return false;

  const lower = now.getTime() + DAY_MS; // now + 1 dia
  const upper = now.getTime() + 2 * DAY_MS; // now + 2 dias
  return t >= lower && t <= upper;
}

/**
 * `true` quando a assinatura deve ser suspensa nesta execução: estava em
 * `past_due` e o grace de 5 dias já expirou (`grace_ends_at < now`).
 * `subscription_suspend` é idempotente no banco; aqui apenas selecionamos.
 */
export function shouldSuspendForGrace(
  input: SuspensionCandidateInput,
  now: Date = new Date()
): boolean {
  if (input.status !== 'past_due') return false;
  if (input.graceEndsAt === null) return false;
  const g = input.graceEndsAt.getTime();
  if (Number.isNaN(g)) return false;
  return g < now.getTime();
}

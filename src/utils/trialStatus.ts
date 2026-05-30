/**
 * Núcleo puro do trial de motoristas (FreteGO).
 *
 * Módulo SEM dependências de I/O (sem `supabase`, sem React). Espelha em
 * TypeScript a lógica SQL de `is_motorista_trial_blocked` e é o alvo primário
 * de property-based testing. Todas as funções são puras e totais.
 *
 * Regra-mãe de bloqueio (fonte de verdade derivada, nunca o rótulo):
 *   Um motorista está BLOQUEADO quando
 *     userType === 'motorista' E trialEndsAt <= now E isSubscribed === false.
 *   Embarcadores e admins NUNCA são bloqueados.
 */

export type UserTypeLike = 'motorista' | 'embarcador' | 'admin';

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'blocked';

/** Domínio fechado de `subscription_status` (rótulo informativo). */
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trial',
  'active',
  'past_due',
  'canceled',
  'blocked',
] as const;

export interface TrialComputationInput {
  userType: UserTypeLike;
  trialEndsAt: Date | null;
  isSubscribed: boolean;
  subscriptionStatus: SubscriptionStatus;
  /** Default `new Date()`; injetável para testes determinísticos. */
  now?: Date;
}

export interface TrialState {
  /** Inteiro >= 0. */
  daysLeft: number;
  /** `true` => motorista bloqueado. */
  isExpired: boolean;
  isSubscribed: boolean;
  status: SubscriptionStatus;
}

export type BadgeTier = 'hidden' | 'green' | 'yellow' | 'red' | 'red-pulse';

/** Milissegundos em um dia (24h). */
const DAY_MS = 86_400_000;

/** Duração do trial concedido a um motorista, em dias corridos. */
const TRIAL_DAYS = 30;

/**
 * Dias restantes do trial: `max(0, ceil((trialEndsAt - now) / 86400000))`.
 *
 * - `trialEndsAt == null` ⇒ `0`.
 * - `trialEndsAt <= now` ⇒ `0`.
 * - Frações de dia são arredondadas para cima (`ceil`), de modo que enquanto
 *   `trialEndsAt > now` o resultado é sempre >= 1.
 *
 * (Requirements 2.1, 2.2, 2.3)
 */
export function computeDaysLeft(trialEndsAt: Date | null, now: Date): number {
  if (trialEndsAt == null) return 0;
  const diffMs = trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / DAY_MS));
}

/**
 * Estado completo de trial do usuário.
 *
 * - Embarcador/Admin ⇒ `{ daysLeft: 0, isExpired: false, ... }` (isenção total,
 *   Requirements 1.4, 3.3, 7.1, 7.2).
 * - Motorista ⇒ `daysLeft` via {@link computeDaysLeft};
 *   `isExpired = trialEndsAt != null && trialEndsAt <= now && !isSubscribed`
 *   (Requirements 2.4, 5.1).
 */
export function computeTrialState(input: TrialComputationInput): TrialState {
  const { userType, trialEndsAt, isSubscribed, subscriptionStatus } = input;
  const now = input.now ?? new Date();

  if (userType !== 'motorista') {
    return { daysLeft: 0, isExpired: false, isSubscribed, status: subscriptionStatus };
  }

  const daysLeft = computeDaysLeft(trialEndsAt, now);
  const isExpired = trialEndsAt != null && trialEndsAt.getTime() <= now.getTime() && !isSubscribed;

  return { daysLeft, isExpired, isSubscribed, status: subscriptionStatus };
}

/**
 * Tier de cor do `TrialBadge` no header.
 *
 * - Não-motorista ⇒ `'hidden'` (Requirements 4.2, 7.4).
 * - Assinante ⇒ `'hidden'` (Requirement 4.3).
 * - `daysLeft === 0` ⇒ `'hidden'` (Requirement 4.8; estado tratado pela tela
 *   de bloqueio).
 * - `daysLeft > 10` ⇒ `'green'` (Requirement 4.4).
 * - `5 <= daysLeft <= 10` ⇒ `'yellow'` (Requirement 4.5).
 * - `1 < daysLeft < 5` ⇒ `'red'` (Requirement 4.6).
 * - `daysLeft === 1` ⇒ `'red-pulse'` (Requirement 4.7).
 *
 * Função total: cobre todo `daysLeft` inteiro >= 0.
 */
export function selectBadgeTier(args: {
  userType: UserTypeLike;
  isSubscribed: boolean;
  daysLeft: number;
}): BadgeTier {
  const { userType, isSubscribed, daysLeft } = args;

  if (userType !== 'motorista') return 'hidden';
  if (isSubscribed) return 'hidden';
  if (daysLeft === 0) return 'hidden';
  if (daysLeft > 10) return 'green';
  if (daysLeft >= 5) return 'yellow';
  if (daysLeft > 1) return 'red';
  return 'red-pulse'; // daysLeft === 1
}

/**
 * Instante de expiração do trial concedido a um motorista:
 * `createdAt + 30 dias` (Requirement 1.1).
 */
export function computeTrialEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_DAYS * DAY_MS);
}

/* ===========================================================================
 * Predicados puros de autorização (paridade SQL↔TS)
 *
 * Espelham, em TypeScript puro e total, a autoridade do servidor:
 *   - `canAccessFrete`     ⇄ `fretes_select_policy` (RLS de SELECT em `fretes`)
 *   - `canAcceptNewFrete`  ⇄ guard de trial em `toggle_frete_like`
 *
 * O cliente NUNCA é a fonte de verdade; estes predicados são a especificação
 * executável usada por property-based testing (Properties 5, 6, 13) para
 * garantir que UX e servidor concordam.
 * ======================================================================== */

/**
 * Estado de trial do chamador para fins de autorização. É exatamente o
 * {@link TrialComputationInput} acrescido da identidade (`id`), permitindo
 * comparar o chamador com `embarcador_id` do frete e, ao mesmo tempo, derivar
 * o bloqueio via {@link computeTrialState} (paridade com
 * `is_motorista_trial_blocked`).
 */
export interface AuthzCaller extends TrialComputationInput {
  /** `auth.uid()` do chamador. */
  id: string;
}

/**
 * Frete observado pela política de autorização. Modela de forma pura/testável
 * os predicados da `fretes_select_policy` sem qualquer I/O:
 *
 * - `embarcadorId`: dono do frete (`fretes.embarcador_id`).
 * - `status`: `fretes.status` (`'ativo' | 'encerrado' | 'cancelado'`).
 * - `hasOwnConversation`: continuidade — `true` quando existe uma
 *   `conversations` ligando este frete ao chamador como motorista
 *   (`EXISTS (... c.frete_id = frete.id AND c.motorista_id = auth.uid())`).
 */
export interface FreteAuthzInput {
  embarcadorId: string;
  status: string;
  hasOwnConversation: boolean;
}

/**
 * Predicado de bloqueio de motorista — espelho puro de
 * `is_motorista_trial_blocked(uuid)`.
 *
 * `true` se e somente se o usuário é motorista, possui `trialEndsAt <= now`,
 * `trialEndsAt != null` e `isSubscribed === false`. Embarcadores, admins,
 * assinantes e `trialEndsAt` nulo ⇒ `false`.
 *
 * É exatamente `computeTrialState(input).isExpired`; exposto como função
 * nomeada para refletir a função SQL homônima (Requirement 5.1, 9.x).
 */
export function isMotoristaBlocked(input: TrialComputationInput): boolean {
  return computeTrialState(input).isExpired;
}

/**
 * Espelho puro de `fretes_select_policy` (RLS de SELECT em `fretes`).
 *
 * O chamador PODE acessar um frete quando qualquer uma das condições vale
 * (políticas permissivas combinam-se por OR):
 *
 * 1. É o dono do frete: `frete.embarcadorId === caller.id`.
 * 2. É admin: `caller.userType === 'admin'`.
 * 3. Continuidade: existe conversa própria ligando o frete ao chamador
 *    (`frete.hasOwnConversation === true`) — independe de bloqueio/papel
 *    (Requirements 6.1, 6.2, 9.4).
 * 4. Feed: frete `'ativo'` E o chamador NÃO é motorista bloqueado
 *    (Requirements 5.6, 9.1).
 *
 * Total: retorna sempre um booleano, sem lançar.
 */
export function canAccessFrete(frete: FreteAuthzInput, caller: AuthzCaller): boolean {
  // 1. Frete próprio (embarcador dono).
  if (frete.embarcadorId === caller.id) return true;
  // 2. Admin enxerga tudo.
  if (caller.userType === 'admin') return true;
  // 3. Continuidade: conversa própria vinculada ao frete.
  if (frete.hasOwnConversation) return true;
  // 4. Feed de fretes ativos, negado a motorista bloqueado.
  if (frete.status === 'ativo' && !isMotoristaBlocked(caller)) return true;
  return false;
}

/**
 * Espelho puro do guard de trial em `toggle_frete_like` (novo aceite).
 *
 * Retorna `false` quando o chamador é um motorista bloqueado; `true` caso
 * contrário (embarcador, admin ou motorista não bloqueado). A negação do
 * novo aceite vale mesmo que o motorista possua fretes em andamento
 * (Requirements 5.6, 6.3, 9.2).
 */
export function canAcceptNewFrete(caller: AuthzCaller): boolean {
  return !isMotoristaBlocked(caller);
}

/* ===========================================================================
 * Anti-fraude — normalização e disponibilidade de identificador (paridade
 * SQL↔TS com `is_identifier_available`)
 * ======================================================================== */

/** Tipos de identificador suportados pelo anti-fraude de cadastro. */
export type IdentifierType = 'phone' | 'cpf' | 'email';

/**
 * Normaliza um identificador para sua forma canônica, espelhando EXATAMENTE
 * a normalização SQL de `is_identifier_available`:
 *
 * - `phone`: remove tudo que não é dígito; se o resultado tem 12 ou 13 dígitos
 *   e começa com o DDI `55`, remove o `55` inicial.
 * - `cpf`: remove tudo que não é dígito.
 * - `email`: `trim` + `lowercase`.
 *
 * Total: `value` nulo/indefinido ⇒ `''`.
 */
export function normalizeIdentifier(type: IdentifierType, value: string): string {
  if (value == null) return '';
  switch (type) {
    case 'phone': {
      let digits = value.replace(/\D/g, '');
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        digits = digits.slice(2);
      }
      return digits;
    }
    case 'cpf':
      return value.replace(/\D/g, '');
    case 'email':
      return value.trim().toLowerCase();
  }
}

/**
 * Espelho puro de `is_identifier_available(type, value)`: retorna `true`
 * (disponível) quando o valor normalizado NÃO consta na coleção `existing`
 * de identificadores já cadastrados (semântica "NOT EXISTS").
 *
 * `existing` DEVE conter identificadores já normalizados (mesma forma
 * canônica produzida por {@link normalizeIdentifier}).
 *
 * Paridade com a guarda SQL `AND v_norm <> ''` aplicada a `cpf`/`email`: um
 * valor normalizado vazio nunca colide (sempre disponível) para esses tipos.
 * `phone` não possui essa guarda na função SQL e segue a verificação direta
 * de pertencimento.
 *
 * Função booleana e SEM efeito colateral (Requirement 8.7): não cria conta
 * nem muta estado.
 */
export function computeIdentifierAvailable(
  type: IdentifierType,
  value: string,
  existing: Iterable<string>
): boolean {
  const norm = normalizeIdentifier(type, value);
  if ((type === 'cpf' || type === 'email') && norm === '') {
    return true;
  }
  const set = existing instanceof Set ? (existing as Set<string>) : new Set(existing);
  return !set.has(norm);
}

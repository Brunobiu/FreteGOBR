import { useAuth } from '../hooks/useAuth';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { selectBadgeTier, type BadgeTier } from '../utils/trialStatus';

/**
 * TrialBadge — contador visual de dias restantes do trial no AppHeader (FreteGO).
 *
 * Pílula compacta exibida no cluster da direita do header. Consome o estado de
 * trial via `useTrialStatus()` (daysLeft/isSubscribed) e deriva o tier de cor
 * com a função pura `selectBadgeTier`. O `userType` vem de `useAuth()` (a mesma
 * fonte primária do hook), pois `useTrialStatus` não o expõe.
 *
 * Auto-ocultação (tier `'hidden'` ⇒ `null`): cobre não-motoristas, assinantes,
 * usuários sem autenticação e `daysLeft === 0` (estado tratado pela tela de
 * bloqueio). Assim o AppHeader não precisa de lógica condicional adicional.
 *
 * (Requirements 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9)
 */

/** Classes Tailwind por tier visível: cor base + destaque pulsante no `red-pulse`. */
const TIER_CLASSES: Record<Exclude<BadgeTier, 'hidden'>, string> = {
  green: 'bg-green-100 text-green-700 border-green-200',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  red: 'bg-red-100 text-red-700 border-red-200',
  'red-pulse': 'bg-red-100 text-red-700 border-red-200 animate-pulse',
};

export function TrialBadge() {
  const { user } = useAuth();
  const { daysLeft, isSubscribed } = useTrialStatus();

  // userType vem do useAuth (mesma fonte do hook). Sem usuário ⇒ oculto (Req 4.2).
  const userType = user?.userType;
  const tier: BadgeTier = userType
    ? selectBadgeTier({ userType, isSubscribed, daysLeft })
    : 'hidden';

  // Tiers ocultos não renderizam nada (não-motorista/assinante/expirado/sem auth).
  if (tier === 'hidden') return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium md:text-xs ${TIER_CLASSES[tier]}`}
    >
      Teste grátis: {daysLeft} dias
    </span>
  );
}

export default TrialBadge;

import { useAuth } from '../hooks/useAuth';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { selectBadgeTier, type BadgeTier } from '../utils/trialStatus';

/**
 * TrialBadge — selo de status de assinatura no AppHeader (FreteGO).
 *
 * Pílula compacta no cluster da direita do header. Consome `useTrialStatus()`
 * (daysLeft/isSubscribed/status) e deriva o tier de cor com `selectBadgeTier`.
 * O `userType` vem de `useAuth()`.
 *
 * Exibição (spec assinaturas-pagamento Req 9):
 *  - Trial: "FREE · {N} dias restantes" (verde/amarelo/vermelho conforme dias).
 *  - Assinante pago: selo "PRO" verde da marca.
 *  - Não-motorista / sem auth / expirado: oculto.
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

  const userType = user?.userType;

  // Assinante pago (motorista): selo "PRO" da marca, sem contador de dias.
  if (userType === 'motorista' && isSubscribed) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-brand-green/30 bg-brand-green/10 px-2.5 py-1 text-[11px] font-semibold text-brand-green md:text-xs"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
        PRO
      </span>
    );
  }

  const tier: BadgeTier = userType
    ? selectBadgeTier({ userType, isSubscribed, daysLeft })
    : 'hidden';

  // Tiers ocultos não renderizam nada (não-motorista/assinante/expirado/sem auth).
  if (tier === 'hidden') return null;

  // Texto do contador: singular/plural.
  const diasLabel = daysLeft === 1 ? '1 dia restante' : `${daysLeft} dias restantes`;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium md:text-xs ${TIER_CLASSES[tier]}`}
    >
      FREE · {diasLabel}
    </span>
  );
}

export default TrialBadge;

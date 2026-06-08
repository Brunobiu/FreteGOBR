import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { toggleFreteLike } from '../services/likes';

/** Aviso pt-BR exibido quando um motorista suspenso tenta interagir. */
export const SUSPENDED_INTERACTION_MESSAGE =
  'Sua assinatura está suspensa. Reative seu plano para interagir com os fretes.';

interface LikeButtonProps {
  freteId: string;
  /** Estado inicial (filled ou outlined). Vem do hidrato global. */
  initialLiked?: boolean;
  /** Total inicial de curtidas — opcional. */
  initialCount?: number;
  /** Mostra contador ao lado. Padrão: false. */
  showCount?: boolean;
  /** Tamanho do ícone. */
  size?: 'sm' | 'md' | 'lg';
  /** Callback chamado após toggle bem sucedido (passa novo estado). */
  onToggled?: (liked: boolean, total: number) => void;
  /**
   * Callback chamado quando a interação é bloqueada por assinatura suspensa.
   * Recebe a mensagem pt-BR a exibir. Quando ausente, o botão redireciona o
   * motorista para a página de planos (CTA padrão).
   */
  onBlocked?: (message: string) => void;
}

const SIZE_MAP = {
  sm: { btn: 'w-7 h-7', icon: 'w-4 h-4', text: 'text-[11px]' },
  md: { btn: 'w-9 h-9', icon: 'w-5 h-5', text: 'text-xs' },
  lg: { btn: 'w-11 h-11', icon: 'w-6 h-6', text: 'text-sm' },
};

/**
 * Botão de curtir (coração) — padrão Instagram. Toggle, otimista,
 * com contador opcional. Visível apenas para motoristas logados;
 * pra outros usuários, redireciona pro login no clique.
 */
export default function LikeButton({
  freteId,
  initialLiked = false,
  initialCount = 0,
  showCount = false,
  size = 'md',
  onToggled,
  onBlocked,
}: LikeButtonProps) {
  const { user, isAuthenticated } = useAuth();
  const { status } = useTrialStatus();
  const navigate = useNavigate();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  // Sincroniza quando o hidrato global muda (ex: após carregar likes do user).
  useEffect(() => {
    setLiked(initialLiked);
  }, [initialLiked]);
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const isMotorista = isAuthenticated && user?.userType === 'motorista';
  // Suspenso/cancelado vê o feed, mas NÃO interage (espelho de
  // `motorista_can_interact` no servidor — o RPC também negaria).
  // 'blocked' é o `subscription_status` cru de quem foi suspenso (migration 058).
  const isBlocked = status === 'blocked' || status === 'canceled';
  const sizes = SIZE_MAP[size];

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!isMotorista) {
      // Embarcador/admin não curtem — silencioso.
      return;
    }
    if (isBlocked) {
      // Interação bloqueada: avisa (pt-BR) ou leva para reativar o plano.
      if (onBlocked) onBlocked(SUSPENDED_INTERACTION_MESSAGE);
      else navigate('/motorista/plano');
      return;
    }

    // Otimista
    const prevLiked = liked;
    const prevCount = count;
    setLiked(!prevLiked);
    setCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    setBusy(true);

    try {
      const res = await toggleFreteLike(freteId);
      setLiked(res.liked);
      setCount(res.total);
      onToggled?.(res.liked, res.total);
    } catch (err) {
      // Reverte em caso de erro
      setLiked(prevLiked);
      setCount(prevCount);
      console.error('Erro ao curtir:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={liked ? 'Descurtir' : 'Curtir'}
      aria-label={liked ? 'Descurtir frete' : 'Curtir frete'}
      className={`inline-flex items-center gap-1 ${sizes.btn} justify-center rounded-full transition-all ${
        liked
          ? 'text-red-500 bg-red-50 hover:bg-red-100'
          : 'text-gray-400 bg-white hover:text-red-500 hover:bg-red-50'
      } border border-gray-200 hover:border-red-200 shadow-sm disabled:opacity-50`}
    >
      <svg
        className={`${sizes.icon} transition-transform ${busy ? 'scale-90' : ''}`}
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={liked ? 0 : 2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
        />
      </svg>
      {showCount && count > 0 && (
        <span className={`${sizes.text} font-medium ${liked ? 'text-red-600' : 'text-gray-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

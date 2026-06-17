/**
 * WelcomeSplash — tela de abertura do app, exibida quando o usuário entra.
 *
 * Toca a animação Lottie (`/public/splash-animation.json`) em tela cheia,
 * uma única vez por sessão do navegador / abertura do app (sessionStorage),
 * e some sozinha com um fade ao terminar. O usuário pode pular tocando.
 *
 * A animação roda logo após a splash nativa do Capacitor (a tela verde),
 * funcionando como a "intro" dentro do app.
 *
 * Acessibilidade: respeita `prefers-reduced-motion` encurtando o tempo e
 * pulando a animação.
 */

import { useEffect, useRef, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';

const SESSION_KEY = 'fretego_welcome_seen';

/** Caminho do JSON da animação (servido de /public). */
const ANIMATION_PATH = '/splash-animation.json';

/** Teto de segurança: se o `complete` do Lottie não disparar, encerra mesmo assim. */
const MAX_DURATION_MS = 9000;

interface WelcomeSplashProps {
  /** Chamado quando a splash termina e deve ser removida da árvore. */
  onDone: () => void;
}

export default function WelcomeSplash({ onDone }: WelcomeSplashProps) {
  const [leaving, setLeaving] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // Encerra (fade-out + onDone) — protegido contra chamadas duplas.
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setLeaving(true);
      window.setTimeout(() => {
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          /* sessionStorage indisponível — segue mesmo assim */
        }
        onDone();
      }, 500);
    };

    // Acessibilidade: com movimento reduzido, não toca a animação.
    if (reduce) {
      const t = window.setTimeout(finish, 800);
      return () => window.clearTimeout(t);
    }

    // Teto de segurança independente do player.
    const safety = window.setTimeout(finish, MAX_DURATION_MS);

    let anim: AnimationItem | null = null;
    if (containerRef.current) {
      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        path: ANIMATION_PATH,
        rendererSettings: {
          // Preenche a tela mantendo proporção (corta sobras).
          preserveAspectRatio: 'xMidYMid slice',
        },
      });
      anim.setSpeed(1.6); // ~8s → ~5s
      anim.addEventListener('complete', finish);
      // Se o JSON falhar ao carregar, não trava a abertura.
      anim.addEventListener('data_failed', finish);
      animRef.current = anim;
    }

    return () => {
      window.clearTimeout(safety);
      if (anim) {
        anim.removeEventListener('complete', finish);
        anim.removeEventListener('data_failed', finish);
        anim.destroy();
      }
      animRef.current = null;
    };
  }, [onDone]);

  function skip() {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
    onDone();
  }

  return (
    <div
      onClick={skip}
      role="presentation"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-brand-navyDeep transition-opacity duration-500 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Container da animação Lottie (preenche a tela). */}
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      <span className="absolute bottom-6 z-10 text-[11px] sm:text-xs text-white/60">
        Toque para pular
      </span>
    </div>
  );
}

/** Indica se a splash já foi vista nesta sessão do navegador / abertura do app. */
// eslint-disable-next-line react-refresh/only-export-components
export function hasSeenWelcome(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

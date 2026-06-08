/**
 * WelcomeSplash — tela de abertura ("mini propaganda") exibida por alguns
 * segundos antes da Landing aparecer.
 *
 * - Fundo no gradiente da marca (marinho → verde da logo).
 * - Logo central + saudação "Seja bem-vindo ao FreteGO".
 * - Some sozinha após `durationMs` com um fade suave.
 * - Só aparece uma vez por sessão do navegador (sessionStorage), pra não
 *   irritar quem navega entre páginas. O usuário também pode pular clicando.
 *
 * Acessibilidade: respeita `prefers-reduced-motion` encurtando o tempo.
 */

import { useEffect, useState } from 'react';

const SESSION_KEY = 'fretego_welcome_seen';

interface WelcomeSplashProps {
  /** Tempo total visível antes de iniciar o fade-out (ms). */
  durationMs?: number;
  /** Chamado quando a splash termina e deve ser removida da árvore. */
  onDone: () => void;
}

export default function WelcomeSplash({ durationMs = 4000, onDone }: WelcomeSplashProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const total = reduce ? 1200 : durationMs;

    const startFade = window.setTimeout(() => setLeaving(true), total);
    // 500ms a mais para o fade-out concluir antes de desmontar.
    const finish = window.setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, '1');
      onDone();
    }, total + 500);

    return () => {
      window.clearTimeout(startFade);
      window.clearTimeout(finish);
    };
  }, [durationMs, onDone]);

  function skip() {
    sessionStorage.setItem(SESSION_KEY, '1');
    onDone();
  }

  return (
    <div
      onClick={skip}
      role="presentation"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-brand-navyDeep via-brand-navy to-brand-green transition-opacity duration-500 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Brilho radial sutil atrás da logo */}
      <div
        className="absolute h-72 w-72 rounded-full bg-brand-lime/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center px-6 text-center">
        <img
          src="/logo.png"
          alt="FreteGO"
          className="h-14 sm:h-16 w-auto object-contain select-none brightness-0 invert welcome-pop"
          draggable={false}
        />

        <p className="mt-6 text-lg sm:text-2xl font-semibold text-white welcome-rise">
          Seja bem-vindo ao FreteGO
        </p>
        <p className="mt-2 text-sm sm:text-base text-white/70 welcome-rise-delayed">
          Fretes que cabem na sua rota.
        </p>

        {/* Barra de progresso fina que enche enquanto a splash está visível */}
        <div className="mt-8 h-1 w-40 sm:w-52 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-brand-lime welcome-progress"
            style={{ animationDuration: `${durationMs}ms` }}
          />
        </div>
      </div>

      <span className="absolute bottom-6 text-xs text-white/50">Toque para pular</span>
    </div>
  );
}

/** Indica se a splash já foi vista nesta sessão do navegador. */
export function hasSeenWelcome(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

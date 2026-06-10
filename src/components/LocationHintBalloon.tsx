/**
 * LocationHintBalloon
 *
 * Balao flutuante mostrado para o motorista quando ele NAO tem
 * localizacao efetiva (sem override manual + sem GPS success). Aparece
 * proximo ao topo-direita da tela, com uma seta apontando para o pill
 * de localizacao no AppHeader (canto superior direito).
 *
 * Comportamento:
 *  - Auto-some apos `autoHideMs` (default 10s).
 *  - Botao "X" para o motorista fechar manualmente.
 *  - **NAO** persiste o dismiss: a cada refresh o balao volta a
 *    aparecer enquanto a localizacao continuar indisponivel. O sistema
 *    so funciona bem com GPS ativo, entao a UI insiste — mas sem
 *    travar a interacao.
 *  - Pointer-events apenas no proprio cartao: o resto do overlay
 *    e `pointer-events: none` para nao bloquear cliques no header.
 *
 * Usado em `HomePage` no caminho do motorista. NAO renderizar para
 * embarcador ou visitante — eles nao precisam de GPS.
 */

import { useEffect, useState } from 'react';

interface LocationHintBalloonProps {
  /** Quando `true`, monta o balao com fade-in. */
  visible: boolean;
  /** Callback quando o motorista clica no X (ou auto-hide). */
  onDismiss: () => void;
  /** Tempo em ms antes do auto-hide. Default 10000 (10s). */
  autoHideMs?: number;
}

export default function LocationHintBalloon({
  visible,
  onDismiss,
  autoHideMs = 10000,
}: LocationHintBalloonProps) {
  // Pequeno fade-in/out controlado por estado interno para casar com a
  // remocao do DOM. `mounted` segue `visible` com leve atraso de saida.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    // Proximo frame para disparar a transicao de opacity.
    const raf = requestAnimationFrame(() => setShown(true));
    const t = window.setTimeout(() => {
      onDismiss();
    }, autoHideMs);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [visible, autoHideMs, onDismiss]);

  if (!visible) return null;

  return (
    <div
      // Overlay nao-bloqueante: so o cartao captura clique.
      className="fixed inset-x-0 top-0 z-[60] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 relative">
        {/* Cartao posicionado no canto superior direito, abaixo do header */}
        <div
          className={`pointer-events-auto absolute right-3 sm:right-4 top-16 sm:top-[72px] w-[calc(100%-1.5rem)] sm:w-80 max-w-sm
            bg-blue-600 text-white rounded-xl shadow-2xl border border-blue-500
            transition-all duration-300 ease-out
            ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
        >
          {/* Setinha apontando para o PILL DE LOCALIZAÇÃO no header (fica à
              esquerda do sininho). Por isso o offset maior à direita. */}
          <span
            aria-hidden="true"
            className="absolute -top-2 right-16 sm:right-24 w-4 h-4 bg-blue-600 border-l border-t border-blue-500 rotate-45"
          />

          <div className="relative px-3 py-2.5 sm:px-4 sm:py-3 flex items-start gap-2.5">
            <svg
              className="w-5 h-5 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>

            <div className="flex-1 min-w-0">
              <p className="text-[12px] sm:text-[13px] font-semibold leading-snug">
                Para acharmos os melhores fretes pra você
              </p>
              <p className="text-[11px] sm:text-xs text-blue-100 mt-0.5 leading-snug">
                Ative a localização do seu celular. Sem GPS, a gente não consegue calcular distância
                nem ordenar por proximidade.
              </p>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              aria-label="Fechar aviso de localização"
              className="shrink-0 -mr-1 -mt-1 p-1 rounded-full text-blue-100 hover:text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

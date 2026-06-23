/**
 * FretesAoVivoSection — bloco "Veja fretes em tempo real" da landing pública.
 *
 * Fica entre a seção de Vantagens e a de Funcionalidades. Mostra:
 *  - um título com selo "Ao vivo · tempo real" (verde);
 *  - um mapa do Brasil (só pra observar) com os fretes ativos como pinos vivos;
 *  - a lista "Últimos fretes lançados" num carrossel (3 por vez) + um botão
 *    "Ver mais" que leva à página dedicada (/fretes-ao-vivo) com a lista cheia.
 *
 * Dados/realtime vêm do hook usePublicFretes; o card é o FreteLiveCard
 * (compartilhados com a página dedicada). O mapa é carregado sob demanda.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePublicFretes } from '../../hooks/usePublicFretes';
import FreteLiveCard from './FreteLiveCard';

const LandingFretesMap = lazy(() => import('./LandingFretesMap'));

/** Máximo de fretes no carrossel da landing (a página dedicada mostra mais). */
const MAX_FRETES = 20;

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export default function FretesAoVivoSection() {
  const { fretes, error } = usePublicFretes(60);

  // Carrossel: trilho rolável + setas que aparecem só quando há pra onde ir.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  // Avança/volta uma "página" (a largura visível = 3 cards no desktop). O
  // scroll-snap encaixa nas bordas dos cards, então pagina de 3 em 3.
  const page = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };

  // Recalcula a visibilidade das setas quando os cards mudam (carregaram ou
  // chegou frete novo) e quando a janela redimensiona.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows, fretes]);

  const latest = fretes ? fretes.slice(0, MAX_FRETES) : [];

  return (
    <section id="fretes-ao-vivo" className="scroll-mt-20 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        {/* Cabeçalho */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
            <span className="live-badge-dot is-green" />
            Ao vivo · tempo real
          </span>
          <h2 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
            Veja fretes em tempo real
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
            Acompanhe os fretes sendo publicados agora no Brasil inteiro. Quando um embarcador
            lança uma carga, ela aparece aqui na hora.
          </p>
        </div>

        {/* Mapa (só pra observar) */}
        <div className="relative mx-auto mt-10 h-72 max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-[#e0eaf5] shadow-sm sm:mt-12 sm:h-[440px]">
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-gray-200" />}>
            <LandingFretesMap fretes={fretes ?? []} />
          </Suspense>

          {/* Selo "tempo real" brilhante no canto */}
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-800 shadow-md backdrop-blur-sm">
            <span className="live-badge-dot is-green" />
            Tempo real
          </div>

          {/* Mensagem quando ainda não há fretes ativos */}
          {fretes !== null && fretes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-4">
              <span className="rounded-full bg-white/90 px-4 py-2 text-center text-sm font-medium text-gray-600 shadow">
                {error ? 'Não foi possível carregar o mapa agora.' : 'Aguardando novos fretes…'}
              </span>
            </div>
          )}
        </div>

        {/* Últimos fretes lançados — carrossel (3 por vez) + "Ver mais" */}
        <div className="mx-auto mt-10 max-w-4xl sm:mt-12">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-900 sm:text-xl">Últimos fretes lançados</h3>
            <Link
              to="/fretes-ao-vivo"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-green transition-colors hover:text-brand-greenDark"
            >
              Ver mais
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {fretes === null ? (
            // Esqueleto de carregamento (linha de cards)
            <div className="mt-4 flex gap-3 overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={`skel-${i}`}
                  className="h-[92px] w-[80%] shrink-0 animate-pulse rounded-xl border border-gray-200 bg-gray-100 sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]"
                />
              ))}
            </div>
          ) : latest.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              {error
                ? 'Não foi possível carregar os fretes agora. Tente novamente em instantes.'
                : 'Assim que um embarcador publicar um frete, ele aparece aqui na hora.'}
            </p>
          ) : (
            <div className="relative mt-4">
              {/* Trilho rolável: arrasta no touch (celular) e usa as setas no desktop */}
              <div
                ref={trackRef}
                className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1"
              >
                {latest.map((f) => (
                  <div
                    key={f.id}
                    className="w-[80%] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]"
                  >
                    <FreteLiveCard frete={f} />
                  </div>
                ))}
              </div>

              {/* Seta esquerda — só aparece quando dá pra voltar */}
              {canPrev && (
                <button
                  type="button"
                  aria-label="Fretes anteriores"
                  onClick={() => page(-1)}
                  className="absolute left-1.5 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-brand-green text-white shadow-lg ring-2 ring-white/70 transition-all hover:scale-105 hover:bg-brand-greenDark sm:h-10 sm:w-10"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}

              {/* Seta direita — só aparece quando há mais pra frente */}
              {canNext && (
                <button
                  type="button"
                  aria-label="Próximos fretes"
                  onClick={() => page(1)}
                  className="absolute right-1.5 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-brand-green text-white shadow-lg ring-2 ring-white/70 transition-all hover:scale-105 hover:bg-brand-greenDark sm:h-10 sm:w-10"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

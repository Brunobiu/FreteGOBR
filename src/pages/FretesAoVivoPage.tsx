/**
 * FretesAoVivoPage — página pública dedicada "Fretes em tempo real"
 * (rota /fretes-ao-vivo, aberta pelo "Ver mais" da landing).
 *
 * Estrutura:
 *  - Mapa do Brasil no topo (full-width), SÓ pra observar (sem texto por cima,
 *    sem clique) — os fretes ativos aparecem como pinos verdes pulsantes.
 *  - Título "Veja os fretes em tempo real" + selo verde "Ao vivo".
 *  - "Últimos fretes lançados": grade completa (até 50, mais recentes primeiro),
 *    sem carrossel. Responsiva.
 *
 * Reaproveita o hook usePublicFretes (dados + realtime) e o FreteLiveCard.
 */

import { lazy, Suspense } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import PublicLayout from '../components/public/PublicLayout';
import { usePublicFretes } from '../hooks/usePublicFretes';
import FreteLiveCard from '../components/public/FreteLiveCard';

const LandingFretesMap = lazy(() => import('../components/public/LandingFretesMap'));

/** Máximo de fretes na grade da página. */
const PAGE_MAX = 50;

export default function FretesAoVivoPage() {
  useDocumentTitle('Fretes em tempo real');
  // Busca um pouco mais que 50 pra encher bem o mapa; a grade corta em 50.
  const { fretes, error } = usePublicFretes(80);
  const list = fretes ? fretes.slice(0, PAGE_MAX) : [];

  return (
    <PublicLayout>
      {/* Mapa no topo — só pra observar, sem nada escrito por cima */}
      <section className="relative h-80 w-full overflow-hidden bg-[#e0eaf5] sm:h-[520px]">
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-gray-200" />}>
          <LandingFretesMap fretes={fretes ?? []} />
        </Suspense>
      </section>

      {/* Conteúdo */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
              <span className="live-badge-dot is-green" />
              Ao vivo · tempo real
            </span>
            <h1 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              Veja os fretes em tempo real
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
              Os fretes vão aparecendo no mapa e na lista conforme são publicados — ao vivo, no
              Brasil inteiro.
            </p>
          </div>

          {/* Últimos fretes lançados — grade completa (até 50) */}
          <div className="mt-10 sm:mt-12">
            <h2 className="text-lg font-bold text-gray-900 sm:text-xl">Últimos fretes lançados</h2>

            {fretes === null ? (
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <li
                    key={`skel-${i}`}
                    className="h-[92px] animate-pulse rounded-xl border border-gray-200 bg-gray-100"
                  />
                ))}
              </ul>
            ) : list.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                {error
                  ? 'Não foi possível carregar os fretes agora. Tente novamente em instantes.'
                  : 'Assim que um embarcador publicar um frete, ele aparece aqui na hora.'}
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((f) => (
                  <li key={f.id}>
                    <FreteLiveCard frete={f} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

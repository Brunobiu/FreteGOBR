/**
 * FreteTicker — faixa de fretes que passa em loop no rodapé do hero (efeito
 * "marquee", direita → esquerda). Conteúdo ilustrativo (FRETE_TICKER em
 * landingContent): rota, carga, caminhão e valor, variando. Decorativo —
 * marcado como aria-hidden (a lista real fica em /fretes); a animação pausa
 * no hover e respeita prefers-reduced-motion (ver index.css).
 */

import { FRETE_TICKER } from '../../data/landingContent';

export default function FreteTicker() {
  // Lista duplicada: ao deslocar -50% (frete-marquee) o loop fecha sem emenda.
  const items = [...FRETE_TICKER, ...FRETE_TICKER];

  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden border-t border-white/10 bg-gradient-to-t from-black/55 via-black/25 to-transparent py-2.5 [mask-image:linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)]"
    >
      <div className="frete-marquee-track flex w-max items-center gap-2.5 px-2">
        {items.map((f, i) => (
          <span
            key={`${f.rota}-${i}`}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-xs text-white/90 backdrop-blur-sm"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-lime" />
            <span className="font-semibold text-white">{f.rota}</span>
            <span className="text-white/40">·</span>
            <span>{f.carga}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/70">{f.caminhao}</span>
            <span className="text-white/40">·</span>
            <span className="font-semibold text-brand-lime">{f.valor}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

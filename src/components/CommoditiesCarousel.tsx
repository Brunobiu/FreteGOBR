import { useEffect, useRef, useState } from 'react';
import { listActiveCommodities, type CommodityCategory } from '../services/commodities';

interface CommoditiesCarouselProps {
  /** Slug atualmente filtrado (controle externo, opcional). */
  selectedSlug?: string | null;
  /** Disparado quando o usuario clica em uma categoria. */
  onSelect?: (commodity: CommodityCategory) => void;
  /** Titulo opcional acima do carrossel. */
  title?: string;
}

/**
 * Carrossel horizontal de categorias de commodities (Soja, Milho, Acucar...).
 *
 * Estilo de menu de categorias do iFood/marketplaces: tira horizontal scrollavel,
 * cada item eh um card quadrado arredondado com icone + nome abaixo. Funciona
 * com swipe touch nativo (overflow-x-auto + scroll-snap) e roda do mouse.
 *
 * Sem auto-slide; o usuario eh quem controla. Reflete dinamicamente as
 * categorias gerenciadas no painel admin.
 *
 * Comportamento de selecao (Migration 050 / filtro do motorista):
 *  - Ao clicar em uma categoria, o item recebe destaque (anel verde + sombra
 *    + leve scale) e o carrossel desliza suavemente pra trazer o selecionado
 *    pro inicio da viewport — assim o motorista nao "perde" o item escolhido
 *    quando ele estava la no fim da lista.
 *  - Clicar de novo no mesmo item desmarca (gerenciado pelo pai via
 *    `selectedSlug`).
 */
export default function CommoditiesCarousel({
  selectedSlug,
  onSelect,
  title,
}: CommoditiesCarouselProps) {
  const [items, setItems] = useState<CommodityCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Refs para auto-scroll: o container e cada botao indexado pelo slug.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Garante que a "puxadinha" de atenção rode só uma vez.
  const nudgedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listActiveCommodities()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Quando `selectedSlug` muda, traz o item escolhido pro inicio da viewport
  // do carrossel com scroll suave. Se nao tem selecao, volta pro inicio.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (!selectedSlug) {
      container.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }

    const target = itemRefs.current.get(selectedSlug);
    if (!target) return;

    // Calcula posicao do item dentro do container e desloca pra que ele
    // fique encostado na esquerda (com pequeno padding).
    const containerLeft = container.getBoundingClientRect().left;
    const targetLeft = target.getBoundingClientRect().left;
    const delta = targetLeft - containerLeft - 8; // 8px de respiro

    container.scrollBy({ left: delta, behavior: 'smooth' });
  }, [selectedSlug, items]);

  // Animação de atenção ao carregar a página: assim que as categorias
  // aparecem, a tira "puxa" pra esquerda devagar, volta devagar e depois
  // quica ~3x diminuindo (como bolinha batendo no chão). Roda 1x.
  // Usa Web Animations API (confiável; não depende de classe CSS).
  useEffect(() => {
    if (loading || items.length === 0 || nudgedRef.current) return;
    const el = scrollRef.current;
    if (!el || typeof el.animate !== 'function') return;
    nudgedRef.current = true;
    const anim = el.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(-28px)', offset: 0.22 }, // puxa devagar
        { transform: 'translateX(0)', offset: 0.46 }, // volta devagar
        { transform: 'translateX(-14px)', offset: 0.6 }, // quica 1
        { transform: 'translateX(0)', offset: 0.72 },
        { transform: 'translateX(-7px)', offset: 0.82 }, // quica 2 (menor)
        { transform: 'translateX(0)', offset: 0.9 },
        { transform: 'translateX(-3px)', offset: 0.96 }, // quica 3 (menor ainda)
        { transform: 'translateX(0)', offset: 1 },
      ],
      { duration: 1700, delay: 350, easing: 'ease-out' }
    );
    return () => anim.cancel();
  }, [loading, items.length]);

  // Skeleton enquanto carrega
  if (loading) {
    return (
      <div className="mb-3">
        {title && <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">{title}</h2>}
        <div className="flex gap-2 overflow-x-hidden py-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-[36px] w-[56px] shrink-0 rounded-[16px] bg-gray-200 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Nada cadastrado: nao renderiza nada para nao poluir
  if (items.length === 0) return null;

  return (
    <div className="mb-0.5 overflow-x-clip">
      {title && <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">{title}</h2>}

      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto py-1 sm:-mx-4 sm:px-4 pr-8 sm:pr-12 snap-x scrollbar-hide scroll-smooth"
        role="listbox"
        aria-label="Categorias de commodities"
      >
        {items.map((c) => {
          const isSelected = selectedSlug === c.slug;
          return (
            <button
              key={c.id}
              type="button"
              ref={(el) => {
                if (el) itemRefs.current.set(c.slug, el);
                else itemRefs.current.delete(c.slug);
              }}
              onClick={() => onSelect?.(c)}
              role="option"
              aria-selected={isSelected}
              title={isSelected ? `${c.name} (selecionado, clique para limpar)` : c.name}
              className={`relative shrink-0 snap-start h-[36px] w-[56px] overflow-hidden rounded-[16px] focus:outline-none transition-all duration-200
                ${
                  isSelected
                    ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-gray-100 scale-105 shadow-md'
                    : 'shadow-sm hover:shadow-md'
                }`}
            >
              {/* Fundo: imagem da categoria (ou gradiente determinístico). */}
              {c.iconUrl ? (
                <img
                  src={c.iconUrl}
                  alt={c.name}
                  className="absolute inset-0 h-full w-full object-cover select-none"
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              ) : (
                <div className={`absolute inset-0 ${commodityGradient(c.name)}`} />
              )}

              {/* Nome no CENTRO da imagem (sem desfoque) — só uma sombra forte
                  pra garantir legibilidade sobre qualquer imagem. */}
              <span className="absolute inset-0 flex items-center justify-center px-1.5">
                <span className="line-clamp-2 text-center text-[9px] font-bold leading-[1.1] text-white [text-shadow:0_1px_2px_rgba(0,0,0,1),0_0_4px_rgba(0,0,0,0.85)]">
                  {c.name}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Aviso visivel + acessivel quando ha selecao. Posicionado fora da
          tira pra nao quebrar o scroll-snap. */}
      {selectedSlug && (
        <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-green-700">
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Mostrando apenas{' '}
            <strong className="font-semibold">
              {items.find((i) => i.slug === selectedSlug)?.name ?? '—'}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => {
              const found = items.find((i) => i.slug === selectedSlug);
              if (found) onSelect?.(found); // toggle off pelo pai
            }}
            className="ml-auto px-2 py-0.5 text-[10px] text-green-700 hover:text-green-800 hover:underline"
          >
            limpar filtro
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Gradiente determinístico (a partir do nome) usado como FUNDO do card quando
 * a categoria não tem imagem configurada. Garante contraste com o nome branco.
 */
function commodityGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const gradients = [
    'bg-gradient-to-br from-amber-400 to-amber-700',
    'bg-gradient-to-br from-green-400 to-green-700',
    'bg-gradient-to-br from-yellow-400 to-yellow-700',
    'bg-gradient-to-br from-orange-400 to-orange-700',
    'bg-gradient-to-br from-lime-400 to-lime-700',
    'bg-gradient-to-br from-emerald-400 to-emerald-700',
    'bg-gradient-to-br from-stone-400 to-stone-700',
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

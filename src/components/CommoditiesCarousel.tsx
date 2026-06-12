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

  // Skeleton enquanto carrega
  if (loading) {
    return (
      <div className="mb-3">
        {title && <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">{title}</h2>}
        <div className="flex gap-2 overflow-x-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-12 h-12 sm:w-11 sm:h-11 rounded-xl bg-gray-200 animate-pulse" />
              <div className="w-10 h-2 rounded bg-gray-200 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Nada cadastrado: nao renderiza nada para nao poluir
  if (items.length === 0) return null;

  return (
    <div className="mb-3">
      {title && <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">{title}</h2>}

      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 sm:-mx-4 sm:px-4 pr-8 sm:pr-12 snap-x scrollbar-hide scroll-smooth"
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
              className={`flex flex-col items-center gap-0.5 shrink-0 snap-start group focus:outline-none transition-transform ${
                isSelected ? 'scale-105' : ''
              }`}
              title={isSelected ? `${c.name} (selecionado, clique para limpar)` : c.name}
            >
              <div
                className={`w-12 h-12 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center overflow-hidden transition-all
                  ${
                    isSelected
                      ? 'ring-2 ring-green-500 ring-offset-1 ring-offset-gray-100 border border-green-600 shadow-md shadow-green-500/30 bg-green-50'
                      : 'border border-gray-200 bg-white shadow-sm group-hover:border-gray-300 group-hover:shadow-md'
                  }`}
              >
                {c.iconUrl ? (
                  <img
                    src={c.iconUrl}
                    alt={c.name}
                    className="w-full h-full object-cover select-none"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      // se a imagem falhar, esconde e o fallback inicial aparece
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <CommodityFallbackIcon name={c.name} />
                )}
              </div>
              <span
                className={`text-[10px] sm:text-[9px] font-medium text-center w-12 sm:w-11 truncate leading-tight transition-colors
                  ${isSelected ? 'text-green-700 font-semibold' : 'text-gray-700'}`}
              >
                {c.name}
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
 * Fallback quando a categoria nao tem icone configurado: bolinha colorida
 * deterministica com a inicial do nome.
 */
function CommodityFallbackIcon({ name }: { name: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  // Hash simples para escolher uma das paletas
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const palettes = [
    'bg-amber-100 text-amber-800',
    'bg-green-100 text-green-800',
    'bg-yellow-100 text-yellow-800',
    'bg-orange-100 text-orange-800',
    'bg-lime-100 text-lime-800',
    'bg-emerald-100 text-emerald-800',
    'bg-stone-100 text-stone-800',
  ];
  const palette = palettes[Math.abs(hash) % palettes.length];

  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-base ${palette}`}
    >
      {initial}
    </div>
  );
}

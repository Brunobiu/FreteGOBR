import { useEffect, useState } from 'react';
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
 */
export default function CommoditiesCarousel({
  selectedSlug,
  onSelect,
  title,
}: CommoditiesCarouselProps) {
  const [items, setItems] = useState<CommodityCategory[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Skeleton enquanto carrega
  if (loading) {
    return (
      <div className="mb-3">
        {title && <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">{title}</h2>}
        <div className="flex gap-3 overflow-x-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
              <div className="w-16 h-16 sm:w-14 sm:h-14 rounded-2xl bg-gray-200 animate-pulse" />
              <div className="w-12 h-2.5 rounded bg-gray-200 animate-pulse" />
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
        className="flex gap-3 sm:gap-2 overflow-x-auto pb-1 sm:-mx-4 sm:px-4 pr-8 sm:pr-12 snap-x scrollbar-hide"
        role="listbox"
        aria-label="Categorias de commodities"
      >
        {items.map((c) => {
          const isSelected = selectedSlug === c.slug;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect?.(c)}
              role="option"
              aria-selected={isSelected}
              className="flex flex-col items-center gap-1 sm:gap-0.5 shrink-0 snap-start group focus:outline-none"
              title={c.name}
            >
              <div
                className={`w-16 h-16 sm:w-14 sm:h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center overflow-hidden transition-all
                  ${
                    isSelected
                      ? 'ring-2 ring-green-500 border border-green-500'
                      : 'border border-gray-200 group-hover:border-gray-300 group-hover:shadow-md'
                  }`}
              >
                {c.iconUrl ? (
                  <img
                    src={c.iconUrl}
                    alt={c.name}
                    className="w-full h-full object-cover select-none"
                    draggable={false}
                    loading="lazy"
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
                className={`text-[11px] sm:text-[10px] font-medium text-center w-16 sm:w-14 truncate
                  ${isSelected ? 'text-green-700' : 'text-gray-700'}`}
              >
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
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

/**
 * Skeletons de região para o feed de fretes (Req 2.3, 9.1).
 *
 * Substituem a tela cheia `WelcomeLoading` por placeholders restritos à
 * região do Primary_Content/Secondary_Data. O Shell (header, carrosséis,
 * toolbar, filtros) permanece visível e interativo enquanto apenas a grade
 * de fretes exibe o skeleton.
 *
 * As dimensões replicam aproximadamente o `FreteCard` real (mesmo container,
 * padding, bordas e alturas das linhas internas) para evitar layout shift
 * quando o conteúdo real substitui o placeholder.
 *
 * Animação via Tailwind `animate-pulse` — sem dependências novas.
 */

/** Número de cards por página no feed (`itemsPerPage` da HomePage). */
const DEFAULT_SKELETON_COUNT = 9;

interface FreteCardSkeletonProps {
  /** Exibe o bloco de cálculo financeiro (feed do motorista, desktop). */
  showCalcBlock?: boolean;
}

/**
 * Placeholder de um único card de frete. Replica a estrutura visual do
 * `FreteCard`: cabeçalho (rota + badge de status), linha de produto/data e
 * rodapé (valor + botão), preservando alturas para não deslocar o layout.
 */
export function FreteCardSkeleton({ showCalcBlock = false }: FreteCardSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse bg-white border border-gray-300 rounded-md p-3 shadow-sm"
    >
      {/* Cabeçalho: rota (origem → destino) + badge de status */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="h-4 rounded bg-gray-200 flex-1" />
        <div className="h-4 w-12 rounded-full bg-gray-200 shrink-0" />
      </div>

      {/* Linha do produto + "Postado em" */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="h-3 rounded bg-gray-200 w-1/2" />
        <div className="h-3 rounded bg-gray-200 w-20 shrink-0" />
      </div>

      {/* Rodapé: valor à esquerda + botão "Ver detalhes" à direita */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="h-4 rounded bg-gray-200 w-24" />
        <div className="h-6 rounded bg-gray-200 w-24 shrink-0" />
      </div>

      {/* Bloco de cálculo financeiro (apenas no feed do motorista, desktop) */}
      {showCalcBlock && (
        <div className="hidden md:block mt-2 p-2 bg-blue-50/60 border border-blue-100 rounded space-y-1.5">
          <div className="h-3 rounded bg-gray-200 w-full" />
          <div className="h-3 rounded bg-gray-200 w-full" />
          <div className="h-3 rounded bg-gray-200 w-3/4" />
          <div className="h-3.5 rounded bg-gray-200 w-1/2 mt-1" />
        </div>
      )}
    </div>
  );
}

interface FreteListSkeletonProps {
  /**
   * Quantidade de cards-placeholder a renderizar. Default 9, igual ao
   * `itemsPerPage` da HomePage, replicando uma página cheia do feed.
   */
  count?: number;
  /** Repassa a exibição do bloco de cálculo aos cards (feed do motorista). */
  showCalcBlock?: boolean;
}

/**
 * Skeleton da grade de fretes. Replica o grid responsivo do feed
 * (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`) e o número de cards por
 * página, mantendo as dimensões para evitar deslocamento de layout (Req 9.1).
 *
 * Anuncia o carregamento via `aria-busy`/`role="status"` com texto em pt-BR
 * acessível a leitores de tela, sem bloquear o restante da interface.
 */
export default function FreteListSkeleton({
  count = DEFAULT_SKELETON_COUNT,
  showCalcBlock = false,
}: FreteListSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando fretes…</span>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {Array.from({ length: count }).map((_, i) => (
          <FreteCardSkeleton key={i} showCalcBlock={showCalcBlock} />
        ))}
      </div>
    </div>
  );
}

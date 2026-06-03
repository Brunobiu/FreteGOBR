import type { ReactNode } from 'react';

/**
 * MapaToolbar — barra sticky no topo do feed do motorista, abaixo do
 * `AppHeader`. Após a feature `motorista-mapa-fullscreen`, esta barra
 * passa a renderizar APENAS o slot do diesel centralizado:
 *
 *  - O seletor de raio migrou para a linha "Fretes Disponíveis"
 *    (componente `RadiusSelector`, junto com o botão de filtro).
 *  - O botão "Ver mapa" foi substituído pelo slot "Mapa" do
 *    `MotoristaBottomNav`, que abre a rota dedicada `/motorista/mapa`.
 *
 * Mantida a posição sticky `top-14 sm:top-16` (alinhada à altura do
 * AppHeader) para que o input de diesel permaneça visível ao rolar
 * a lista de fretes.
 *
 * Sem a "listrazinha fininha" `border-b border-gray-200/60` que existia
 * antes — o componente fica visualmente limpo, encostando no
 * AppHeader sem divisão.
 *
 * O componente segue exposto na mesma posição (`HomePage` consumidor)
 * e ainda recebe props legadas que não são mais usadas, para evitar
 * impacto em outros consumidores enquanto a transição não acaba.
 */
interface MapaToolbarProps {
  /** Slot do diesel (ou outro conteúdo). */
  middleSlot?: ReactNode;
  /** Props legadas (mantidas pra retrocompatibilidade — não usadas). */
  fretes?: unknown;
  motoristaPoint?: unknown;
  radiusKm?: unknown;
  onRadiusChange?: unknown;
  onFreteClick?: unknown;
  geolocationStatus?: unknown;
  onRequestLocation?: unknown;
}

export default function MapaToolbar({ middleSlot }: MapaToolbarProps) {
  if (!middleSlot) return null;
  return (
    <div className="sticky top-14 sm:top-16 z-30 bg-gray-100 -mx-3 sm:-mx-4 px-3 sm:px-4 py-0.5 mb-1 flex items-center justify-center w-auto">
      {middleSlot}
    </div>
  );
}

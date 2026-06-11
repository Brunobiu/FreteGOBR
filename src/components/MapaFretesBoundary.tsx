import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Boundary de erro escopado APENAS pro mapa Leaflet.
 *
 * O Leaflet ocasionalmente crasha em iOS Safari (ex.:
 * "undefined is not an object (evaluating 'this._map.layerPointToLatLng')")
 * quando handlers tentam usar o mapa antes dele terminar de montar/montou
 * em layout zero. Sem este boundary, o crash derruba toda a HomePage.
 */
export default class MapaFretesBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Logamos no console para debug, mas não engasgamos a UI inteira.

    console.warn('[MapaFretesBoundary] Mapa crashou e foi escondido:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mb-3">
          <div className="w-full rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-[11px] text-yellow-900">
            Mapa indisponível neste dispositivo. Os fretes continuam listados abaixo.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

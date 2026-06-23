/**
 * LandingFretesMap — mapa do Brasil SÓ PARA OBSERVAR (landing pública).
 *
 * Mostra os fretes ativos como pinos "vivos" (bolinha verde pulsante) sobre o
 * mapa. É totalmente NÃO interativo: sem arrastar, sem zoom, sem clique — o
 * container inteiro fica com `pointer-events: none`, então o scroll da página
 * passa direto por cima (importante no celular) e o visitante só observa.
 *
 * Carregado sob demanda (React.lazy) pelo FretesAoVivoSection pra não jogar o
 * peso do Leaflet no bundle inicial da landing.
 */

import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import type { PublicFrete } from '../../services/publicFretes';

// Caixa que enquadra o Brasil inteiro (S, O) → (N, L). O fitBounds ajusta o
// zoom ao tamanho do container, então funciona bem no celular e no desktop.
const BRAZIL_BOUNDS: L.LatLngBoundsExpression = [
  [6.5, -74.8],
  [-34.5, -33.5],
];

// Pino "vivo" — reaproveita a classe .frete-live-dot do index.css.
const liveIcon = L.divIcon({
  className: 'frete-live-marker',
  html: '<span class="frete-live-dot"></span>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

type LandingFretesMapProps = {
  fretes: PublicFrete[];
};

export default function LandingFretesMap({ fretes }: LandingFretesMapProps) {
  return (
    <MapContainer
      bounds={BRAZIL_BOUNDS}
      boundsOptions={{ padding: [8, 8] }}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      // Puramente visual: nada de interação, o scroll da página passa por cima.
      style={{ height: '100%', width: '100%', pointerEvents: 'none', background: '#e0eaf5' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {fretes.map((f) => (
        <Marker
          key={f.id}
          position={[f.point.latitude, f.point.longitude]}
          icon={liveIcon}
          interactive={false}
          keyboard={false}
        />
      ))}
    </MapContainer>
  );
}

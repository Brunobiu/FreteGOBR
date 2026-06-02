/**
 * FreteMiniMap
 *
 * Mini-mapa mostrado no topo do `FreteModal` (logo abaixo do cabecalho do
 * embarcador) com a rota ORIGEM -> DESTINO do frete selecionado. Reutiliza
 * o `MapContainer` + `TileLayer` do react-leaflet ja em uso em `MapaFretes`.
 *
 * Comportamento:
 *  - Tenta puxar a geometria real da rota (pelas estradas) via OSRM
 *    (`getRouteGeometry`). Se OSRM responder, plota a polyline da rota.
 *  - Se OSRM falhar ou demorar, cai num fallback de linha reta entre os 2
 *    pontos. Usuario nunca fica olhando "carregando" eterno.
 *  - Pin verde na origem, pin vermelho no destino.
 *  - O mapa enquadra a rota automaticamente via `fitBounds`.
 *
 * Modo COMPACTO (default):
 *  - Nao permite zoom/drag (`scrollWheelZoom: false`, `dragging: false`):
 *    evita conflito com o scroll do bottom sheet do modal no mobile.
 *  - Cliclavel: tocar em qualquer ponto do mapa expande para tela cheia.
 *  - Mostra um icone de "expandir" no canto superior direito para deixar
 *    a affordance evidente.
 *
 * Modo EXPANDIDO (tela cheia):
 *  - `position: fixed` cobrindo toda a viewport, `z-index` acima do modal.
 *  - Totalmente interativo: zoom (scroll/pinch), drag, double-click.
 *  - Botao X no canto superior direito + tecla ESC para voltar.
 *  - `body` recebe `overflow: hidden` enquanto expandido para nao rolar
 *    o conteudo atras.
 *
 * Implementacao: o `MapContainer` e remontado quando alterna o modo
 * (key derivada de `expanded`) porque o react-leaflet nao reage a mudancas
 * runtime das props de interatividade (`scrollWheelZoom`/`dragging`/etc.).
 * `FitToRoute` cuida do reenquadramento em ambos os modos.
 *
 * Acessibilidade:
 *  - Modo compacto: `role="button"` + `aria-label` claro.
 *  - Modo expandido: `role="dialog"` + `aria-label` + ESC fecha.
 */

import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Frete } from '../services/fretes';
import { getRouteGeometry } from '../services/geolocation';
import type { GeographicPoint } from '../types';

// Icones SVG inline (verde/vermelho) para origem e destino.
function createPinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 22],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
           fill="${color}" stroke="white" stroke-width="2"
           style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.5" fill="white"/>
      </svg>`,
  });
}

const ORIGIN_ICON = createPinIcon('#16a34a'); // verde-600
const DESTINATION_ICON = createPinIcon('#dc2626'); // vermelho-600

/**
 * Helper que reenquadra o mapa para abrigar a rota inteira sempre que a
 * lista de pontos muda. Precisa ser filho de `MapContainer` para acessar
 * a instancia via `useMap()`.
 */
function FitToRoute({ points }: { points: GeographicPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], animate: false });
  }, [map, points]);
  return null;
}

interface FreteMiniMapProps {
  frete: Frete;
  /** Altura do mapa compacto em px. Default 160. */
  height?: number;
  className?: string;
}

export default function FreteMiniMap({ frete, height = 160, className }: FreteMiniMapProps) {
  // Origem/destino preferem o `pinned` (coordenada exata) e caem em
  // `originLocation`/`destinationLocation` (geocode da cidade) como fallback.
  const origin: GeographicPoint = {
    latitude: frete.originPinnedLat ?? frete.originLocation.latitude,
    longitude: frete.originPinnedLng ?? frete.originLocation.longitude,
  };
  const destination: GeographicPoint = {
    latitude: frete.destinationPinnedLat ?? frete.destinationLocation.latitude,
    longitude: frete.destinationPinnedLng ?? frete.destinationLocation.longitude,
  };

  const validCoords =
    Number.isFinite(origin.latitude) &&
    Number.isFinite(origin.longitude) &&
    Number.isFinite(destination.latitude) &&
    Number.isFinite(destination.longitude) &&
    !(origin.latitude === 0 && origin.longitude === 0) &&
    !(destination.latitude === 0 && destination.longitude === 0);

  // Geometria da rota (pelas estradas via OSRM). Comeca como `null` e e
  // preenchida quando o fetch resolve.
  const [routeGeometry, setRouteGeometry] = useState<GeographicPoint[] | null>(null);

  // Modo expandido (tela cheia). False = mini-mapa compacto e nao-interativo.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!validCoords) {
      setRouteGeometry(null);
      return;
    }
    let cancelled = false;
    setRouteGeometry(null);
    getRouteGeometry(origin, destination)
      .then((geom) => {
        if (!cancelled && geom && geom.length > 1) setRouteGeometry(geom);
      })
      .catch(() => {
        if (!cancelled) setRouteGeometry(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.latitude, origin.longitude, destination.latitude, destination.longitude]);

  // Trava o scroll do body enquanto expandido + ESC fecha.
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  if (!validCoords) return null;

  // Pontos efetivos da polyline: rota OSRM quando disponivel; reta como fallback.
  const polylinePoints: GeographicPoint[] = routeGeometry ?? [origin, destination];

  // Centro inicial — `FitToRoute` reajusta em seguida.
  const center: [number, number] = [
    (origin.latitude + destination.latitude) / 2,
    (origin.longitude + destination.longitude) / 2,
  ];

  // Conteudo de mapa compartilhado entre os dois modos. So as `props` de
  // interatividade do MapContainer mudam.
  const mapChildren = (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[origin.latitude, origin.longitude]} icon={ORIGIN_ICON} />
      <Marker position={[destination.latitude, destination.longitude]} icon={DESTINATION_ICON} />
      <Polyline
        positions={polylinePoints.map((p) => [p.latitude, p.longitude] as [number, number])}
        pathOptions={{
          color: routeGeometry ? '#2563eb' : '#9ca3af',
          weight: expanded ? 4 : 3,
          opacity: 0.9,
          dashArray: routeGeometry ? undefined : '6 6',
        }}
      />
      <FitToRoute points={polylinePoints} />
    </>
  );

  return (
    <>
      {/* ============ Modo COMPACTO (clicavel) ============ */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expandir rota de ${frete.origin} para ${frete.destination}`}
        className={`relative block w-full rounded-lg overflow-hidden border border-gray-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className ?? ''}`}
        style={{ height }}
      >
        {/* `pointer-events-none` no mapa garante que o clique caia no <button>
            e nao seja interceptado pelo Leaflet, mesmo com dragging desligado. */}
        <div className="absolute inset-0 pointer-events-none">
          <MapContainer
            key="mini"
            center={center}
            zoom={5}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
            dragging={false}
            doubleClickZoom={false}
            zoomControl={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
            attributionControl={false}
          >
            {mapChildren}
          </MapContainer>
        </div>
        {/* Affordance de "expandir" no canto superior direito. */}
        <span
          aria-hidden="true"
          className="absolute top-2 right-2 bg-white/90 backdrop-blur rounded-md p-1 shadow border border-gray-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-700"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </span>
      </button>

      {/* ============ Modo EXPANDIDO (tela cheia, interativo) ============ */}
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Rota de ${frete.origin} para ${frete.destination}`}
          className="fixed inset-0 z-[10000] bg-black"
        >
          <MapContainer
            key="full"
            center={center}
            zoom={5}
            style={{ height: '100vh', width: '100vw' }}
            scrollWheelZoom
            dragging
            doubleClickZoom
            zoomControl
            touchZoom
            boxZoom
            keyboard
            attributionControl
          >
            {mapChildren}
          </MapContainer>

          {/* Botao X para voltar. Acima dos controles do Leaflet (z-index alto). */}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Fechar mapa"
            className="absolute top-3 right-3 z-[10001] bg-white rounded-full shadow-lg p-2 border border-gray-200 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-800"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Cabecalho discreto com origem -> destino. */}
          <div className="absolute top-3 left-3 z-[10001] bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 border border-gray-200 max-w-[calc(100%-72px)]">
            <p className="text-xs font-semibold text-gray-800 truncate">
              {frete.origin} → {frete.destination}
            </p>
            {frete.distanceKm ? (
              <p className="text-[10px] text-gray-500 mt-0.5">
                {frete.distanceKm.toLocaleString('pt-BR')} km pela rota
              </p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

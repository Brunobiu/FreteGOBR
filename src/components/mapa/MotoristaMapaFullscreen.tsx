/**
 * MotoristaMapaFullscreen — mapa Leaflet em tela cheia para o motorista.
 *
 * Cobre as tasks 7-11 da spec `motorista-mapa-fullscreen`:
 *  - Render Leaflet com tile OSM, motorista (bolinha verde), círculo
 *    do raio em volta, e pinos dos fretes ativos dentro do raio.
 *  - Filtro por raio (50/100/200/500 km) compartilhado com o feed
 *    via `localStorage[RADIUS_STORAGE_KEY]`.
 *  - Click no pino → `getRouteGeometry` (OSRM) + Polyline azul
 *    sólida (ou tracejada enquanto carrega/em fallback). Card
 *    flutuante com valor + distâncias + botão "Ver detalhes".
 *  - Fade dos demais pinos pra 30% quando há frete selecionado.
 *  - Plugin `leaflet-rotate` carregado dinâmico, com fallback
 *    gracioso se o import falhar.
 */

import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { getActiveFretes, type Frete } from '../../services/fretes';
import { getRouteGeometry } from '../../services/geolocation';
import {
  RADIUS_DEFAULT_KM,
  RADIUS_OPTIONS_KM,
  RADIUS_STORAGE_KEY,
  filterFretesByRadius,
  haversineDistanceKm,
  readStoredRadius,
  writeStoredRadius,
  type RadiusOption,
} from '../../utils/geoDistance';
import { useEffectiveLocation } from '../../hooks/useEffectiveLocation';
import { supabase } from '../../services/supabase';
import type { GeographicPoint } from '../../types';
import FreteModal from '../FreteModal';
import { makePinIcon, makeMotoristaIcon } from './pinHelpers';

const BR_CENTER: [number, number] = [-14.235, -51.9253];
const BR_ZOOM_FALLBACK = 4;
const MOTORISTA_ZOOM = 8;
const FIT_PADDING: [number, number] = [40, 40];
const FALLBACK_HELP_LABEL = 'Ative a localização';

export type RouteState = 'idle' | 'loading' | 'osrm' | 'fallback';
export type RotateAvailability = 'pending' | 'available' | 'unavailable';

export interface MotoristaMapaFullscreenProps {
  className?: string;
}

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const formatKm = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Helper interno: enquadra o círculo do raio na viewport sempre que
 * `point` ou `radiusKm` muda. Usa `setTimeout(0)` defensivo (mesmo
 * padrão do `MapaFretes`) pra evitar race com o ciclo de montagem.
 */
function FitToCircle({ point, radiusKm }: { point: GeographicPoint | null; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point || !map) return;
    const t = window.setTimeout(() => {
      try {
        if (!map.getContainer || typeof map.getContainer !== 'function') return;
        const container = map.getContainer();
        if (!container || !container.isConnected) return;
        const circle = L.circle([point.latitude, point.longitude], {
          radius: radiusKm * 1000,
        });
        map.fitBounds(circle.getBounds(), { padding: FIT_PADDING });
      } catch {
        // race silenciosa — se o mapa ainda não terminou de montar,
        // o próximo ciclo do effect cobre.
      }
    }, 100);
    return () => window.clearTimeout(t);
  }, [point, radiusKm, map]);
  return null;
}

/**
 * Helper interno: enquadra a rota traçada (positions) na viewport.
 */
function FitRoute({ positions }: { positions: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length === 0 || !map) return;
    const bounds = L.latLngBounds(positions);
    try {
      map.fitBounds(bounds, { padding: FIT_PADDING });
    } catch {
      // ignore
    }
  }, [positions, map]);
  return null;
}

/**
 * Helper interno: detecta clique no mapa fora de pino e dispara
 * `onClickOutside` pra limpar a seleção.
 */
function MapClickListener({ onClickOutside }: { onClickOutside: () => void }) {
  useMapEvents({
    click: () => onClickOutside(),
  });
  return null;
}

/**
 * Helper interno: invalida o tamanho do mapa quando o container
 * muda (ex.: bottom sheet abrindo). Reuso do padrão do MapaFretes.
 */
function MapInvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {
        // ignore
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

export default function MotoristaMapaFullscreen({ className = '' }: MotoristaMapaFullscreenProps) {
  const effectiveLoc = useEffectiveLocation();
  const point = effectiveLoc.point;
  const geoStatus = effectiveLoc.geoStatus;

  // Raio compartilhado com o feed via localStorage.
  const [radiusKm, setRadiusKm] = useState<RadiusOption>(() => {
    if (typeof window === 'undefined') return RADIUS_DEFAULT_KM;
    return readStoredRadius(window.localStorage.getItem(RADIUS_STORAGE_KEY));
  });

  const [fretes, setFretes] = useState<Frete[]>([]);
  const [, setFretesError] = useState<string | null>(null);

  // Seleção de pino + rota OSRM.
  const [selectedRouteFrete, setSelectedRouteFrete] = useState<Frete | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<GeographicPoint[] | null>(null);
  const [routeState, setRouteState] = useState<RouteState>('idle');

  // Plugin de rotação (carregamento dinâmico).
  const [rotateAvailability, setRotateAvailability] = useState<RotateAvailability>('pending');

  // Banner efêmero "nenhum frete no raio".
  const [noFretesBannerVisible, setNoFretesBannerVisible] = useState(false);

  // Detalhe do frete selecionado (FreteModal).
  const [detailFrete, setDetailFrete] = useState<Frete | null>(null);

  // Refs.
  const osrmAbortRef = useRef<{ cancelled: boolean } | null>(null);

  // Carrega o plugin leaflet-rotate dinamicamente (uma vez no mount).
  useEffect(() => {
    let cancelled = false;
    import('leaflet-rotate')
      .then(() => {
        if (!cancelled) setRotateAvailability('available');
      })
      .catch((err) => {
        if (cancelled) return;

        console.warn(
          '[MotoristaMapaFullscreen] leaflet-rotate indisponível — rotação desabilitada',
          err
        );
        setRotateAvailability('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pede GPS no mount se ainda não tem localização.
  useEffect(() => {
    if (geoStatus === 'idle') {
      effectiveLoc.requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoStatus]);

  // Carrega fretes ativos + realtime channel (silent refetch).
  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (silent = false) => {
      try {
        if (!silent) setFretesError(null);
        const data = await getActiveFretes({});
        if (!cancelled) setFretes(data);
      } catch (err) {
        if (!cancelled && !silent) {
          setFretesError(err instanceof Error ? err.message : 'Erro ao carregar fretes');
        }
      }
    };

    load(false);

    const scheduleSilentRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => load(true), 500);
    };

    const channel = supabase
      .channel('fretes-mapa-fullscreen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fretes' }, () =>
        scheduleSilentRefetch()
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  // Fretes filtrados pelo raio (memoizado).
  const visibleFretes = useMemo(
    () => (point ? filterFretesByRadius(fretes, point, radiusKm) : []),
    [fretes, point, radiusKm]
  );

  // Banner efêmero quando não há fretes no raio.
  useEffect(() => {
    if (!point) {
      setNoFretesBannerVisible(false);
      return;
    }
    if (visibleFretes.length === 0 && fretes.length > 0) {
      setNoFretesBannerVisible(true);
      const t = window.setTimeout(() => setNoFretesBannerVisible(false), 6000);
      return () => window.clearTimeout(t);
    }
    setNoFretesBannerVisible(false);
  }, [visibleFretes.length, fretes.length, point]);

  // Click no pino → traça rota.
  const onPinClick = useCallback((frete: Frete) => {
    // Cancela request anterior (se ainda em vôo).
    if (osrmAbortRef.current) osrmAbortRef.current.cancelled = true;
    const abortFlag = { cancelled: false };
    osrmAbortRef.current = abortFlag;

    setSelectedRouteFrete(frete);
    setRouteGeometry(null);
    setRouteState('loading');

    const dest = frete.destinationLocation;
    const validDest =
      Number.isFinite(dest.latitude) &&
      Number.isFinite(dest.longitude) &&
      !(dest.latitude === 0 && dest.longitude === 0);

    if (!validDest) {
      setRouteState('fallback');
      return;
    }

    (async () => {
      const geom = await getRouteGeometry(frete.originLocation, dest);
      if (abortFlag.cancelled) return;
      if (geom && geom.length > 0) {
        setRouteGeometry(geom);
        setRouteState('osrm');
      } else {
        setRouteState('fallback');
      }
    })();
  }, []);

  const clearSelection = useCallback(() => {
    if (osrmAbortRef.current) osrmAbortRef.current.cancelled = true;
    osrmAbortRef.current = null;
    setSelectedRouteFrete(null);
    setRouteGeometry(null);
    setRouteState('idle');
  }, []);

  const handleRadiusChange = useCallback((next: RadiusOption) => {
    setRadiusKm(next);
    writeStoredRadius(next);
  }, []);

  // Enquanto o plugin de rotação está em vôo, mostra esqueleto.
  if (rotateAvailability === 'pending') {
    return (
      <div
        className={`relative w-full h-full bg-gray-100 animate-pulse flex items-center justify-center text-gray-400 text-xs ${className}`}
      >
        Carregando mapa...
      </div>
    );
  }

  const center: [number, number] = point ? [point.latitude, point.longitude] : BR_CENTER;
  const zoom = point ? MOTORISTA_ZOOM : BR_ZOOM_FALLBACK;

  // Props condicionais do plugin de rotação.
  const rotateProps =
    rotateAvailability === 'available' ? { rotate: true, touchRotate: true, bearing: 0 } : {};

  // Posições da Polyline (fallback reta enquanto loading; OSRM
  // quando carregada).
  const routePositions: [number, number][] | null = (() => {
    if (!selectedRouteFrete) return null;
    const dest = selectedRouteFrete.destinationLocation;
    const validDest =
      Number.isFinite(dest.latitude) &&
      Number.isFinite(dest.longitude) &&
      !(dest.latitude === 0 && dest.longitude === 0);
    if (!validDest) return null;
    if (routeGeometry && routeState === 'osrm') {
      return routeGeometry.map((p) => [p.latitude, p.longitude]);
    }
    return [
      [selectedRouteFrete.originLocation.latitude, selectedRouteFrete.originLocation.longitude],
      [dest.latitude, dest.longitude],
    ];
  })();

  const useDashed = routeState === 'loading' || routeState === 'fallback';

  // Status visual de localização.
  const showOverlayLocalizando = !point && (geoStatus === 'idle' || geoStatus === 'loading');
  const showBannerSemGps =
    !point && (geoStatus === 'denied' || geoStatus === 'error' || geoStatus === 'insecure');

  return (
    <div className={`relative w-full h-full ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
        {...(rotateProps as Record<string, unknown>)}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapInvalidateOnMount />

        {point && (
          <>
            <Circle
              center={[point.latitude, point.longitude]}
              radius={radiusKm * 1000}
              pathOptions={{
                color: '#16a34a',
                weight: 2,
                fillColor: '#16a34a',
                fillOpacity: 0.08,
              }}
            />
            <Marker position={[point.latitude, point.longitude]} icon={makeMotoristaIcon()} />
            <FitToCircle point={point} radiusKm={radiusKm} />
          </>
        )}

        <MapClickListener onClickOutside={clearSelection} />

        {visibleFretes.map((f) => {
          const isSelected = selectedRouteFrete?.id === f.id;
          const opacity = !selectedRouteFrete || isSelected ? (1 as const) : (0.3 as const);
          return (
            <Marker
              key={f.id}
              position={[f.originLocation.latitude, f.originLocation.longitude]}
              icon={makePinIcon(f.status === 'ativo' ? 'frete-ativo' : 'frete-encerrado', opacity)}
              eventHandlers={{
                click: (e) => {
                  // O click do marker propaga pro mapa por padrão.
                  // Stop pra não disparar o clearSelection do
                  // MapClickListener.
                  L.DomEvent.stopPropagation(e.originalEvent);
                  onPinClick(f);
                },
              }}
            />
          );
        })}

        {selectedRouteFrete && routePositions && (
          <>
            <Polyline
              positions={routePositions}
              pathOptions={{
                color: '#2563eb',
                weight: 4,
                opacity: 0.85,
                ...(useDashed ? { dashArray: '8 4' } : {}),
              }}
            />
            <Marker
              position={[
                selectedRouteFrete.destinationLocation.latitude,
                selectedRouteFrete.destinationLocation.longitude,
              ]}
              icon={makePinIcon('destino')}
            />
            <FitRoute positions={routePositions} />
          </>
        )}
      </MapContainer>

      {/* Seletor de raio — canto superior direito */}
      <div className="absolute top-2 right-2 z-[400] flex flex-wrap gap-1 max-w-[calc(100%-1rem)] bg-white/90 backdrop-blur p-1 rounded-lg shadow-md">
        {RADIUS_OPTIONS_KM.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => handleRadiusChange(r)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md min-h-[32px] transition-colors ${
              r === radiusKm
                ? 'bg-green-600 text-white shadow-sm'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {r} km
          </button>
        ))}
      </div>

      {/* Indicação de localização — canto inferior esquerdo */}
      {point && (
        <div
          className="absolute left-2 z-[400] px-2 py-1 bg-white/90 backdrop-blur rounded-md shadow-sm text-[11px] text-gray-700"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
        >
          📍 {effectiveLoc.source === 'override' ? `Local: ${effectiveLoc.address ?? '—'}` : 'GPS'}
        </div>
      )}

      {/* Overlay "Localizando..." (status idle/loading sem ponto) */}
      {showOverlayLocalizando && (
        <div className="absolute inset-0 z-[300] bg-white/60 flex items-center justify-center text-gray-600 text-xs pointer-events-none">
          Localizando...
        </div>
      )}

      {/* Banner sem GPS — instruções pra ativar */}
      {showBannerSemGps && (
        <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none p-3">
          <div className="pointer-events-auto bg-yellow-50 border border-yellow-300 rounded-lg shadow-lg px-3 py-2 max-w-sm w-full text-center">
            <p className="text-xs text-yellow-900 mb-2">{FALLBACK_HELP_LABEL}</p>
            <p className="text-[10px] text-yellow-800 mb-2">
              {geoStatus === 'insecure'
                ? 'Localização requer HTTPS.'
                : geoStatus === 'denied'
                  ? 'Permissão bloqueada pelo navegador. Habilite no cadeado da barra de endereço e recarregue.'
                  : 'Localização indisponível.'}
            </p>
            <button
              type="button"
              onClick={() => effectiveLoc.requestLocation()}
              className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold rounded"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {/* Banner efêmero "Nenhum frete no raio" */}
      {noFretesBannerVisible && (
        <div
          className="absolute left-2 right-2 z-[400] flex justify-center pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4rem)' }}
        >
          <div className="pointer-events-auto bg-yellow-50 border border-yellow-200 rounded-md shadow-md px-3 py-1.5 text-[11px] text-yellow-900 max-w-md text-center">
            Nenhum frete dentro do raio atual. Aumente o raio para ver mais ofertas.
          </div>
        </div>
      )}

      {/* Card flutuante do frete selecionado */}
      {selectedRouteFrete && (
        <FreteSelectedCard
          frete={selectedRouteFrete}
          motoristaPoint={point}
          routeState={routeState}
          onClose={clearSelection}
          onOpenDetail={() => setDetailFrete(selectedRouteFrete)}
        />
      )}

      {/* Modal de detalhes do frete */}
      <FreteModal frete={detailFrete} isOpen={!!detailFrete} onClose={() => setDetailFrete(null)} />
    </div>
  );
}

interface FreteSelectedCardProps {
  frete: Frete;
  motoristaPoint: GeographicPoint | null;
  routeState: RouteState;
  onClose: () => void;
  onOpenDetail: () => void;
}

function FreteSelectedCard({
  frete,
  motoristaPoint,
  routeState,
  onClose,
  onOpenDetail,
}: FreteSelectedCardProps): ReactNode {
  const distMotoristaOrigem =
    motoristaPoint && Number.isFinite(frete.originLocation.latitude)
      ? haversineDistanceKm(motoristaPoint, frete.originLocation)
      : null;

  return (
    <div
      className="absolute left-2 right-2 z-[400] flex justify-center pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
      <div className="pointer-events-auto bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-2 max-w-md w-full text-[11px]">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-800 truncate">
            {frete.origin} → {frete.destination}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Limpar seleção"
            className="text-gray-400 hover:text-gray-700 leading-none -mt-0.5 px-1"
          >
            ✕
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-green-700 font-bold">{formatBRL(frete.value)}</span>
            {frete.distanceKm && (
              <span className="text-gray-600">{frete.distanceKm.toLocaleString('pt-BR')} km</span>
            )}
            {distMotoristaOrigem !== null && (
              <span className="text-gray-500">{formatKm(distMotoristaOrigem)} km de você</span>
            )}
            {routeState === 'loading' && (
              <span className="text-blue-600 text-[10px] animate-pulse">traçando rota...</span>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenDetail}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded"
          >
            Ver detalhes
          </button>
        </div>
      </div>
    </div>
  );
}

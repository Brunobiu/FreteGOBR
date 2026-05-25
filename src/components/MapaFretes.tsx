import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Frete } from '../services/fretes';
import type { GeographicPoint } from '../types';
import type { GeolocationStatus } from '../hooks/useGeolocation';
import { getRouteGeometry } from '../services/geolocation';
import { RADIUS_OPTIONS_KM, haversineDistanceKm, type RadiusOption } from '../utils/geoDistance';

interface MapaFretesProps {
  fretes: Frete[];
  motoristaPoint: GeographicPoint | null;
  radiusKm: RadiusOption;
  onRadiusChange: (next: RadiusOption) => void;
  onFreteClick: (frete: Frete) => void;
  geolocationStatus: GeolocationStatus;
  onRequestLocation: () => void;
}

const BR_CENTER: [number, number] = [-14.235, -51.9253];

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const formatKm = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function pinIcon(status: 'ativo' | 'encerrado' | string): L.DivIcon {
  const color = status === 'ativo' ? '#16a34a' : '#9ca3af';
  return L.divIcon({
    className: 'mapafretes-pin',
    iconSize: [18, 22],
    iconAnchor: [9, 22],
    popupAnchor: [0, -20],
    html: `<svg width="18" height="22" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">
      <path fill="${color}" stroke="#ffffff" stroke-width="1.5"
            d="M11 0a11 11 0 0 0-11 11c0 7.5 11 17 11 17s11-9.5 11-17A11 11 0 0 0 11 0z"/>
      <circle cx="11" cy="11" r="4" fill="#ffffff"/>
    </svg>`,
  });
}

/**
 * Pin laranja para marcar o destino quando uma rota é traçada.
 */
function destIcon(): L.DivIcon {
  return L.divIcon({
    className: 'mapafretes-pin-dest',
    iconSize: [18, 22],
    iconAnchor: [9, 22],
    html: `<svg width="18" height="22" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">
      <path fill="#ea580c" stroke="#ffffff" stroke-width="1.5"
            d="M11 0a11 11 0 0 0-11 11c0 7.5 11 17 11 17s11-9.5 11-17A11 11 0 0 0 11 0z"/>
      <circle cx="11" cy="11" r="4" fill="#ffffff"/>
    </svg>`,
  });
}

function MapAutoCenter({ point, radiusKm }: { point: GeographicPoint | null; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    const circle = L.circle([point.latitude, point.longitude], {
      radius: radiusKm * 1000,
    });
    map.fitBounds(circle.getBounds(), { padding: [30, 30] });
  }, [point, radiusKm, map]);
  return null;
}

/**
 * Avisa o Leaflet quando o tamanho do container muda (expandir/recolher
 * o mapa) — sem isso, os tiles ficam só no espaço antigo e o resto do
 * mapa fica cinza.
 */
function MapInvalidateOnResize({ trigger }: { trigger: boolean }) {
  const map = useMap();
  useEffect(() => {
    // Espera a animação CSS terminar antes de invalidar o tamanho
    const t = window.setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => window.clearTimeout(t);
  }, [trigger, map]);
  return null;
}

/**
 * Centraliza o mapa na rota selecionada (ou volta ao padrão).
 */
function FitRoute({ routeBounds }: { routeBounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!routeBounds) return;
    map.fitBounds(routeBounds, { padding: [40, 40] });
  }, [routeBounds, map]);
  return null;
}

export default function MapaFretes({
  fretes,
  motoristaPoint,
  radiusKm,
  onRadiusChange,
  onFreteClick,
  geolocationStatus,
  onRequestLocation,
}: MapaFretesProps) {
  const [expanded, setExpanded] = useState(false);
  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false);
  // Frete cuja rota está traçada no mapa (clique no pin)
  const [selectedRouteFrete, setSelectedRouteFrete] = useState<Frete | null>(null);
  // Geometria real da rota (pelas ruas, via OSRM). Quando null, cai no
  // fallback de linha reta entre origem e destino.
  const [routeGeometry, setRouteGeometry] = useState<GeographicPoint[] | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Carrega a geometria real da rota ao selecionar um frete.
  useEffect(() => {
    if (!selectedRouteFrete) {
      setRouteGeometry(null);
      return;
    }
    const f = selectedRouteFrete;
    if (
      !Number.isFinite(f.destinationLocation.latitude) ||
      !Number.isFinite(f.destinationLocation.longitude) ||
      (f.destinationLocation.latitude === 0 && f.destinationLocation.longitude === 0)
    ) {
      setRouteGeometry(null);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    setRouteGeometry(null);
    (async () => {
      const geom = await getRouteGeometry(f.originLocation, f.destinationLocation);
      if (!cancelled) {
        setRouteGeometry(geom);
        setRouteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRouteFrete]);

  // Mapa fininho — quase metade da altura anterior
  const heightClass = expanded ? 'h-[60vh]' : 'h-[90px] md:h-[110px]';
  const showBanner =
    geolocationStatus === 'denied' ||
    geolocationStatus === 'error' ||
    geolocationStatus === 'insecure';
  const showOverlay = geolocationStatus === 'idle' || geolocationStatus === 'loading';
  const [showHelp, setShowHelp] = useState(false);

  // Detecta browser para instruções específicas no help
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isChrome = userAgent.includes('chrome') && !userAgent.includes('edg');
  const isFirefox = userAgent.includes('firefox');
  const isSafari = userAgent.includes('safari') && !userAgent.includes('chrome');
  const isAndroid = userAgent.includes('android');
  const isiOS = /iphone|ipad|ipod/.test(userAgent);

  const validFretes = fretes.filter(
    (f) =>
      Number.isFinite(f.originLocation.latitude) &&
      Number.isFinite(f.originLocation.longitude) &&
      !(f.originLocation.latitude === 0 && f.originLocation.longitude === 0)
  );

  const center: [number, number] = motoristaPoint
    ? [motoristaPoint.latitude, motoristaPoint.longitude]
    : BR_CENTER;
  const zoom = motoristaPoint ? 8 : 4;

  return (
    <div className="mb-3">
      <div
        className={`relative w-full rounded-md overflow-hidden border border-gray-200 ${heightClass}`}
        style={{ zIndex: 0 }}
      >
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          className="z-0"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapAutoCenter point={motoristaPoint} radiusKm={radiusKm} />

          {validFretes.map((f) => (
            <Marker
              key={f.id}
              position={[f.originLocation.latitude, f.originLocation.longitude]}
              icon={pinIcon(f.status)}
              eventHandlers={{
                // Click traça a rota e abre popup. Não usamos mouseover/mouseout
                // porque touch (iOS Safari) dispara esses eventos de forma errática
                // e provoca crash do Leaflet (layerPointToLatLng undefined).
                click: (e) => {
                  setSelectedRouteFrete(f);
                  try {
                    e.target.openPopup();
                  } catch {
                    // ignora se o mapa ainda não está pronto
                  }
                },
              }}
            >
              <Popup>
                <div className="min-w-[160px]">
                  <p className="font-semibold text-gray-800 mb-1 text-xs">
                    {f.origin} → {f.destination}
                  </p>
                  <p className="text-green-700 font-bold text-xs mb-1">{formatBRL(f.value)}</p>
                  {motoristaPoint && (
                    <p className="text-gray-600 text-[10px]">
                      {formatKm(haversineDistanceKm(motoristaPoint, f.originLocation))} km de você
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Rota traçada quando o motorista clica em um pin */}
          {selectedRouteFrete &&
            Number.isFinite(selectedRouteFrete.destinationLocation.latitude) &&
            Number.isFinite(selectedRouteFrete.destinationLocation.longitude) &&
            !(
              selectedRouteFrete.destinationLocation.latitude === 0 &&
              selectedRouteFrete.destinationLocation.longitude === 0
            ) &&
            (() => {
              // Usa rota pelas ruas se já carregada; senão, fallback linha reta
              const positions: [number, number][] = routeGeometry
                ? routeGeometry.map((p) => [p.latitude, p.longitude])
                : [
                    [
                      selectedRouteFrete.originLocation.latitude,
                      selectedRouteFrete.originLocation.longitude,
                    ],
                    [
                      selectedRouteFrete.destinationLocation.latitude,
                      selectedRouteFrete.destinationLocation.longitude,
                    ],
                  ];
              const useDashed = !routeGeometry; // tracejado enquanto não tem rota real
              return (
                <>
                  <Polyline
                    positions={positions}
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
                    icon={destIcon()}
                  />
                  <FitRoute routeBounds={positions as L.LatLngBoundsExpression} />
                </>
              );
            })()}

          <MapInvalidateOnResize trigger={expanded} />
        </MapContainer>

        {/* Botão de raio (canto superior esquerdo) */}
        <div className="absolute top-1 left-1 z-[400]">
          <button
            type="button"
            onClick={() => setRadiusMenuOpen((v) => !v)}
            className="px-2 py-1 bg-white/95 border border-gray-300 rounded text-[11px] font-medium hover:bg-white shadow-sm"
          >
            Raio: {radiusKm} km {radiusMenuOpen ? '▴' : '▾'}
          </button>
          {radiusMenuOpen && (
            <div className="mt-1 flex flex-col bg-white border border-gray-300 rounded shadow-md overflow-hidden">
              {RADIUS_OPTIONS_KM.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onRadiusChange(r);
                    setRadiusMenuOpen(false);
                  }}
                  className={`px-3 py-1 text-[11px] text-left whitespace-nowrap ${
                    r === radiusKm ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botão expandir/recolher (canto superior direito) */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Recolher mapa' : 'Expandir mapa'}
          className="absolute top-1 right-1 z-[400] px-2 py-1 bg-white/95 border border-gray-300 rounded text-[11px] hover:bg-white shadow-sm"
        >
          {expanded ? '⤡ recolher' : '⤢ expandir'}
        </button>

        {/* Card de informação da rota selecionada */}
        {selectedRouteFrete &&
          (() => {
            const f = selectedRouteFrete;
            const dist =
              motoristaPoint && Number.isFinite(f.originLocation.latitude)
                ? haversineDistanceKm(motoristaPoint, f.originLocation)
                : null;
            return (
              <div className="absolute bottom-2 left-2 right-2 z-[400] flex justify-center pointer-events-none">
                <div className="pointer-events-auto bg-white border border-gray-300 rounded-md shadow-lg px-3 py-2 max-w-md w-full text-[11px]">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-gray-800 truncate">
                      {f.origin} → {f.destination}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedRouteFrete(null)}
                      aria-label="Limpar rota"
                      className="text-gray-400 hover:text-gray-700 leading-none -mt-0.5"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="text-green-700 font-bold">{formatBRL(f.value)}</span>
                      {f.distanceKm && (
                        <span className="text-gray-600">
                          {f.distanceKm.toLocaleString('pt-BR')} km
                        </span>
                      )}
                      {dist !== null && (
                        <span className="text-gray-500">{formatKm(dist)} km de você</span>
                      )}
                      {routeLoading && (
                        <span className="text-blue-600 text-[10px] animate-pulse">
                          traçando rota...
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onFreteClick(f)}
                      className="px-2 py-1 bg-blue-600 text-white text-[11px] font-medium rounded hover:bg-blue-700"
                    >
                      Ver detalhes
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* Overlay enquanto carrega */}
        {showOverlay && (
          <div className="absolute inset-0 z-[300] bg-white/60 flex items-center justify-center text-gray-600 text-[11px]">
            Localizando...
          </div>
        )}

        {/* Banner pequeno e centralizado */}
        {showBanner && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none p-2">
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border border-yellow-300 rounded-md text-[11px] shadow-md max-w-[95%]">
              <span className="text-yellow-900 truncate">
                {geolocationStatus === 'insecure'
                  ? 'Localização requer HTTPS'
                  : geolocationStatus === 'denied'
                    ? 'Localização bloqueada'
                    : 'Localização indisponível'}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (geolocationStatus === 'insecure' || geolocationStatus === 'denied') {
                    setShowHelp(true);
                  } else {
                    onRequestLocation();
                  }
                }}
                className="px-2 py-0.5 bg-yellow-600 text-white text-[11px] rounded hover:bg-yellow-700 whitespace-nowrap"
              >
                {geolocationStatus === 'insecure' || geolocationStatus === 'denied'
                  ? 'Como ativar'
                  : 'Tentar'}
              </button>
            </div>
          </div>
        )}

        {/* Modal de ajuda */}
        {showHelp && (
          <div
            className="fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center p-3"
            onClick={() => setShowHelp(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-800">Como ativar a localização</h3>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="text-gray-400 hover:text-gray-700 text-lg leading-none"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              {geolocationStatus === 'insecure' ? (
                <div className="space-y-2 text-xs text-gray-700">
                  <p>
                    Você está acessando o app via{' '}
                    <strong>{typeof window !== 'undefined' ? window.location.host : 'IP'}</strong>,
                    que não é uma origem segura. Navegadores só permitem geolocalização em HTTPS ou
                    em <code>localhost</code>.
                  </p>
                  <p className="font-medium text-gray-800 mt-2">Soluções:</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>Acesse pelo computador em http://localhost:5173</li>
                    <li>Publique o app em domínio com HTTPS (Vercel, Netlify, etc.)</li>
                    <li>No app nativo (futuro iOS/Android), o GPS funciona normalmente.</li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 text-xs text-gray-700">
                  <p>
                    A permissão foi <strong>bloqueada</strong> para este site. Para reabilitar:
                  </p>
                  {isAndroid && (
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Toque no <strong>cadeado 🔒</strong> à esquerda do endereço.
                      </li>
                      <li>
                        Toque em <strong>Permissões</strong> ou{' '}
                        <strong>Configurações do site</strong>.
                      </li>
                      <li>
                        Mude <strong>Localização</strong> para <strong>Permitir</strong>.
                      </li>
                      <li>Recarregue a página.</li>
                    </ol>
                  )}
                  {isiOS && (
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        <strong>Ajustes</strong> → <strong>Safari</strong> →{' '}
                        <strong>Localização</strong> → <strong>Permitir</strong>.
                      </li>
                      <li>
                        <strong>Ajustes</strong> → <strong>Privacidade</strong> →{' '}
                        <strong>Serviços de Localização</strong> → ative para o Safari.
                      </li>
                      <li>Recarregue a página.</li>
                    </ol>
                  )}
                  {!isAndroid && !isiOS && isChrome && (
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Clique no <strong>cadeado 🔒</strong> à esquerda do endereço.
                      </li>
                      <li>
                        Em <strong>Localização</strong>, escolha <strong>Permitir</strong>.
                      </li>
                      <li>Recarregue a página (F5).</li>
                    </ol>
                  )}
                  {!isAndroid && !isiOS && isFirefox && (
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Clique no <strong>cadeado 🔒</strong> à esquerda do endereço.
                      </li>
                      <li>
                        Ao lado de <strong>Acessar sua localização</strong>, clique em X.
                      </li>
                      <li>Recarregue a página.</li>
                    </ol>
                  )}
                  {!isAndroid && !isiOS && isSafari && (
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Menu <strong>Safari</strong> → <strong>Preferências</strong> →{' '}
                        <strong>Sites</strong>.
                      </li>
                      <li>
                        Selecione <strong>Localização</strong> e mude este site para{' '}
                        <strong>Permitir</strong>.
                      </li>
                      <li>Recarregue a página.</li>
                    </ol>
                  )}
                  {!isAndroid && !isiOS && !isChrome && !isFirefox && !isSafari && (
                    <p>
                      Procure pelo cadeado 🔒 na barra de endereço e habilite a localização para
                      este site. Depois, recarregue a página.
                    </p>
                  )}
                  <p className="text-[10px] text-gray-500 mt-2">
                    No app nativo (futuro), o sistema vai abrir as configurações do aparelho
                    automaticamente.
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-800 text-xs font-medium rounded hover:bg-gray-300"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHelp(false);
                    onRequestLocation();
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
                >
                  Tentar agora
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, lazy, Suspense } from 'react';
import { RADIUS_OPTIONS_KM, type RadiusOption } from '../utils/geoDistance';
import type { Frete } from '../services/fretes';
import type { GeographicPoint } from '../types';
import type { GeolocationStatus } from '../hooks/useGeolocation';
import MapaFretesBoundary from './MapaFretesBoundary';

// Lazy: leaflet só carrega quando o motorista decide abrir o mapa
const MapaFretes = lazy(() => import('./MapaFretes'));

interface MapaToolbarProps {
  fretes: Frete[];
  motoristaPoint: GeographicPoint | null;
  radiusKm: RadiusOption;
  onRadiusChange: (next: RadiusOption) => void;
  onFreteClick: (frete: Frete) => void;
  geolocationStatus: GeolocationStatus;
  onRequestLocation: () => void;
  /** Conteudo extra renderizado entre o seletor de Raio e o botao "Ver no mapa". */
  middleSlot?: React.ReactNode;
}

/**
 * Toolbar compacta no lugar do mapa inline. Mostra:
 *   - Seletor de raio (mesmo dropdown do mapa)
 *   - Slot opcional no meio (ex: input do Diesel)
 *   - Botão "Ver no mapa" — abre o mapa em modal full-screen
 *
 * Vantagem em mobile: o mapa não rouba espaço vertical da listagem.
 * O motorista abre só quando quer visualizar geograficamente.
 */
export default function MapaToolbar({
  fretes,
  motoristaPoint,
  radiusKm,
  onRadiusChange,
  onFreteClick,
  geolocationStatus,
  onRequestLocation,
  middleSlot,
}: MapaToolbarProps) {
  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 w-full">
        {/* Diesel (slot do meio passa a ser primeiro) */}
        {middleSlot && <div className="flex-shrink-0">{middleSlot}</div>}

        {/* Seletor de raio */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setRadiusMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm whitespace-nowrap"
          >
            <svg
              className="w-3.5 h-3.5 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>{radiusKm} km</span>
            <span className="text-gray-400">{radiusMenuOpen ? '▴' : '▾'}</span>
          </button>

          {radiusMenuOpen && (
            <div className="absolute top-full mt-1 left-0 z-30 flex flex-col bg-white border border-gray-300 rounded-lg shadow-md overflow-hidden min-w-[80px]">
              {RADIUS_OPTIONS_KM.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onRadiusChange(r);
                    setRadiusMenuOpen(false);
                  }}
                  className={`px-3 py-1.5 text-xs text-left whitespace-nowrap ${
                    r === radiusKm ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botão Ver no mapa - empurrado para a direita */}
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold shadow-sm whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
          Ver mapa
        </button>
      </div>

      {/* Modal full-screen com o mapa */}
      {mapOpen && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-stretch sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-3xl sm:rounded-xl overflow-hidden flex flex-col h-full sm:h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
              <h2 className="text-sm font-semibold text-gray-800">Fretes no mapa</h2>
              <button
                type="button"
                onClick={() => setMapOpen(false)}
                className="p-1 text-gray-500 hover:text-gray-800 rounded-md hover:bg-gray-100"
                aria-label="Fechar mapa"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              <MapaFretesBoundary>
                <Suspense
                  fallback={
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                      Carregando mapa...
                    </div>
                  }
                >
                  <div style={{ height: '100%' }}>
                    <MapaFretes
                      fretes={fretes}
                      motoristaPoint={motoristaPoint}
                      radiusKm={radiusKm}
                      onRadiusChange={onRadiusChange}
                      onFreteClick={(f) => {
                        setMapOpen(false);
                        onFreteClick(f);
                      }}
                      geolocationStatus={geolocationStatus}
                      onRequestLocation={onRequestLocation}
                      fullHeight
                    />
                  </div>
                </Suspense>
              </MapaFretesBoundary>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

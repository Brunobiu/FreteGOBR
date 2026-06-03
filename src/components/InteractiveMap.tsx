import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Frete } from '../services/fretes';
import { vehicleTypesCsvLabel } from '../data/vehicleTypes';

// Fix default marker icons broken by webpack/vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom blue icon for fretes
const freteIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface FreteMarkerProps {
  frete: Frete;
  onFreteClick: (frete: Frete) => void;
}

function FreteMarker({ frete, onFreteClick }: FreteMarkerProps) {
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <Marker
      position={[frete.originLocation.latitude, frete.originLocation.longitude]}
      icon={freteIcon}
    >
      <Popup>
        <div className="min-w-[200px]">
          <p className="font-semibold text-gray-900 mb-1">
            {frete.origin} → {frete.destination}
          </p>
          <p className="text-sm text-gray-600 mb-1">
            {frete.cargoType} • {vehicleTypesCsvLabel(frete.vehicleType)}
          </p>
          <p className="text-sm font-bold text-green-600 mb-2">{formatCurrency(frete.value)}</p>
          <button
            onClick={() => onFreteClick(frete)}
            className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
          >
            Ver detalhes
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

// Component to handle real-time frete updates
function MapUpdater({ fretes }: { fretes: Frete[] }) {
  const map = useMap();
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (fretes.length > prevCountRef.current && fretes.length > 0) {
      // New fretes added - fit bounds to show all markers
      const bounds = fretes
        .filter((f) => f.originLocation.latitude && f.originLocation.longitude)
        .map((f) => [f.originLocation.latitude, f.originLocation.longitude] as [number, number]);

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
      }
    }
    prevCountRef.current = fretes.length;
  }, [fretes, map]);

  return null;
}

interface InteractiveMapProps {
  fretes: Frete[];
  onFreteClick: (frete: Frete) => void;
  height?: string;
}

export default function InteractiveMap({
  fretes,
  onFreteClick,
  height = '500px',
}: InteractiveMapProps) {
  // Center on Brazil
  const brazilCenter: [number, number] = [-14.235, -51.9253];

  const validFretes = fretes.filter(
    (f) =>
      f.originLocation.latitude !== 0 &&
      f.originLocation.longitude !== 0 &&
      !isNaN(f.originLocation.latitude) &&
      !isNaN(f.originLocation.longitude)
  );

  return (
    <div style={{ height }} className="rounded-lg overflow-hidden border border-gray-800">
      <MapContainer
        center={brazilCenter}
        zoom={4}
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapUpdater fretes={validFretes} />
        {validFretes.map((frete) => (
          <FreteMarker key={frete.id} frete={frete} onFreteClick={onFreteClick} />
        ))}
      </MapContainer>
    </div>
  );
}

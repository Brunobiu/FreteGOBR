import { useState } from 'react';
import { useGeolocation } from '../hooks/useGeolocation';
import { findNearbyFretes } from '../services/fretes';
import { geocodeAddress } from '../services/geolocation';
import type { Frete } from '../services/fretes';

interface TripSuggestionProps {
  onFreteSelect: (frete: Frete) => void;
}

export default function TripSuggestion({ onFreteSelect }: TripSuggestionProps) {
  const { point, address, status, error, requestLocation, setManualLocation } = useGeolocation();
  const [nearbyFretes, setNearbyFretes] = useState<(Frete & { distanceKm: number })[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [radiusKm, setRadiusKm] = useState(100);

  const searchNearby = async (lat: number, lng: number) => {
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await findNearbyFretes(lat, lng, radiusKm);
      setNearbyFretes(results);
      if (results.length === 0) {
        setSearchError(`Nenhum frete encontrado em um raio de ${radiusKm}km.`);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro ao buscar fretes próximos');
    } finally {
      setIsSearching(false);
    }
  };

  // Quando localização é obtida, busca automaticamente
  const handleSuggest = async () => {
    if (point) {
      await searchNearby(point.latitude, point.longitude);
    } else {
      await requestLocation();
    }
  };

  const handleManualSearch = async () => {
    if (!manualAddress.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await geocodeAddress(manualAddress);
      if (results.length === 0) {
        setSearchError('Endereço não encontrado. Tente ser mais específico.');
        setIsSearching(false);
        return;
      }
      const { point: p, displayName } = results[0];
      setManualLocation(p, displayName);
      await searchNearby(p.latitude, p.longitude);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro ao buscar endereço');
      setIsSearching(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-blue-600/20 rounded-full flex items-center justify-center">
          <svg
            className="w-5 h-5 text-blue-400"
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
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Sugestão de Viagem</h3>
          <p className="text-sm text-gray-500">Encontre fretes próximos à sua localização</p>
        </div>
      </div>

      {/* Localização atual */}
      {point && address && (
        <div className="mb-4 p-3 bg-green-900/20 border border-green-700/50 rounded-lg flex items-center space-x-2">
          <svg
            className="w-4 h-4 text-green-400 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm text-green-300">{address}</span>
        </div>
      )}

      {/* Erro de permissão */}
      {(status === 'denied' || status === 'error') && (
        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <p className="text-sm text-yellow-300 mb-2">{error}</p>
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Informar localização manualmente
          </button>
        </div>
      )}

      {/* Entrada manual */}
      {(showManual || status === 'denied') && (
        <div className="mb-4 flex space-x-2">
          <input
            type="text"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
            placeholder="Ex: Goiânia, GO"
            className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleManualSearch}
            disabled={isSearching || !manualAddress.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Buscar
          </button>
        </div>
      )}

      {/* Raio de busca */}
      <div className="mb-4 flex items-center space-x-3">
        <label className="text-sm text-gray-600 whitespace-nowrap">Raio:</label>
        <select
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={50}>50 km</option>
          <option value={100}>100 km</option>
          <option value={200}>200 km</option>
          <option value={500}>500 km</option>
        </select>
        <button
          onClick={handleSuggest}
          disabled={isSearching || status === 'loading'}
          className="flex-1 flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSearching || status === 'loading' ? (
            <>
              <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Buscando...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              Me sugerir uma viagem
            </>
          )}
        </button>
      </div>

      {/* Erro de busca */}
      {searchError && <p className="text-sm text-red-400 mb-4">{searchError}</p>}

      {/* Resultados */}
      {nearbyFretes.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {nearbyFretes.length} frete{nearbyFretes.length !== 1 ? 's' : ''} encontrado
            {nearbyFretes.length !== 1 ? 's' : ''} próximo{nearbyFretes.length !== 1 ? 's' : ''}
          </p>
          {nearbyFretes.slice(0, 5).map((frete) => (
            <div
              key={frete.id}
              onClick={() => onFreteSelect(frete)}
              className="p-4 bg-white border border-gray-200 rounded-lg cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {frete.origin} → {frete.destination}
                  </p>
                  <p className="text-xs text-gray-500">
                    {frete.cargoType} • {frete.vehicleType}
                  </p>
                </div>
                <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-full whitespace-nowrap">
                  {frete.distanceKm.toFixed(0)} km
                </span>
              </div>
              <p className="text-sm font-bold text-green-400">{formatCurrency(frete.value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

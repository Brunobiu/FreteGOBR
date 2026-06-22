/**
 * MarketplaceLocationGate — localização obrigatória e forçada (Req 4).
 *
 * Ao montar, tenta obter a posição do dispositivo (Capacitor nativo + web via
 * useGeolocation). Quando resolve, informa o ponto + rótulo ao pai e mostra a
 * cidade. Se a permissão for negada/indisponível, orienta o usuário a ativar e
 * oferece "Tentar de novo" — sem localização, o pai mantém o "Publicar"
 * desabilitado.
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 */

import { useEffect } from 'react';
import type { GeographicPoint } from '../../types';
import { useGeolocation } from '../../hooks/useGeolocation';

interface Props {
  onResolved: (point: GeographicPoint, label: string) => void;
}

export default function MarketplaceLocationGate({ onResolved }: Props) {
  const { point, address, status, error, requestLocation } = useGeolocation();

  // Solicita a localização ao abrir.
  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  // Reporta ao pai quando a localização é obtida.
  useEffect(() => {
    if (status === 'success' && point) {
      onResolved(point, address ?? '');
    }
  }, [status, point, address, onResolved]);

  if (status === 'success' && point) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
        <svg className="w-4 h-4 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
        </svg>
        <span className="text-sm text-green-800 truncate">{address || 'Localização obtida'}</span>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
        <svg className="w-4 h-4 text-gray-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span className="text-sm text-gray-600">Obtendo sua localização...</span>
      </div>
    );
  }

  // denied | insecure | error → orienta e oferece tentar de novo.
  return (
    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
      <p className="text-sm text-amber-800">
        {error || 'Não foi possível obter sua localização.'}
      </p>
      <p className="mt-0.5 text-xs text-amber-700">
        A localização é obrigatória para publicar. Ative-a e tente novamente.
      </p>
      <button
        type="button"
        onClick={() => void requestLocation()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5"
      >
        Ativar localização
      </button>
    </div>
  );
}

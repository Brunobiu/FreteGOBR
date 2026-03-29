/**
 * Hook useGeolocation
 * Solicita localização do browser, com fallback para entrada manual
 */

import { useState, useCallback } from 'react';
import type { GeographicPoint } from '../types';
import { reverseGeocode } from '../services/geolocation';

export type GeolocationStatus = 'idle' | 'loading' | 'success' | 'denied' | 'error';

export interface GeolocationState {
  point: GeographicPoint | null;
  address: string | null;
  status: GeolocationStatus;
  error: string | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    point: null,
    address: null,
    status: 'idle',
    error: null,
  });

  /**
   * Solicita localização via browser Geolocation API
   */
  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: 'Geolocalização não suportada neste navegador',
      }));
      return;
    }

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point: GeographicPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        try {
          const address = await reverseGeocode(point);
          setState({ point, address, status: 'success', error: null });
        } catch {
          // Localização obtida mas endereço falhou — ainda é útil
          setState({ point, address: null, status: 'success', error: null });
        }
      },
      (err) => {
        const isDenied = err.code === GeolocationPositionError.PERMISSION_DENIED;
        setState({
          point: null,
          address: null,
          status: isDenied ? 'denied' : 'error',
          error: isDenied
            ? 'Permissão de localização negada. Informe sua localização manualmente.'
            : 'Não foi possível obter sua localização.',
        });
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  /**
   * Define localização manualmente (fallback)
   */
  const setManualLocation = useCallback((point: GeographicPoint, address?: string) => {
    setState({
      point,
      address: address ?? null,
      status: 'success',
      error: null,
    });
  }, []);

  /**
   * Limpa a localização atual
   */
  const clearLocation = useCallback(() => {
    setState({ point: null, address: null, status: 'idle', error: null });
  }, []);

  return {
    ...state,
    requestLocation,
    setManualLocation,
    clearLocation,
  };
}

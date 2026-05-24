/**
 * Hook useGeolocation
 * Solicita localização do browser, com fallback para entrada manual.
 *
 * Detecta:
 *   - contexto inseguro (HTTP em IP que não é localhost) → status 'error'
 *     com mensagem específica.
 *   - Permissions API: quando disponível, lê o estado da permissão antes
 *     de chamar getCurrentPosition. Se já estiver `denied`, evita chamar
 *     o getCurrentPosition (que falharia silenciosamente) e ajusta o
 *     status para 'denied' direto, mostrando a mensagem orientativa.
 */

import { useState, useCallback } from 'react';
import type { GeographicPoint } from '../types';
import { reverseGeocode } from '../services/geolocation';

export type GeolocationStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'denied'
  | 'error'
  | 'insecure';

export interface GeolocationState {
  point: GeographicPoint | null;
  address: string | null;
  status: GeolocationStatus;
  error: string | null;
}

function isSecureContextOk(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  // Fallback: localhost também é considerado seguro mesmo em HTTP
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    point: null,
    address: null,
    status: 'idle',
    error: null,
  });

  /**
   * Solicita localização via browser Geolocation API.
   * Em contexto inseguro (HTTP em IP de rede), retorna 'insecure'.
   * Em permissão já negada (Permissions API), retorna 'denied' direto
   * sem disparar getCurrentPosition (que ficaria silencioso).
   */
  const requestLocation = useCallback(async () => {
    if (!isSecureContextOk()) {
      setState({
        point: null,
        address: null,
        status: 'insecure',
        error:
          'Acesso à localização requer HTTPS. Use o endereço http://localhost:5173 ou publique o app em HTTPS.',
      });
      return;
    }

    if (!navigator.geolocation) {
      setState({
        point: null,
        address: null,
        status: 'error',
        error: 'Geolocalização não suportada neste navegador.',
      });
      return;
    }

    // Tenta consultar Permissions API antes de chamar getCurrentPosition.
    // Se a permissão já está bloqueada, evita o "clique-sem-feedback".
    try {
      const perm = await navigator.permissions?.query?.({
        name: 'geolocation' as PermissionName,
      });
      if (perm?.state === 'denied') {
        setState({
          point: null,
          address: null,
          status: 'denied',
          error:
            'Permissão de localização bloqueada. Habilite nas configurações do navegador (clique no cadeado da barra de endereço).',
        });
        return;
      }
    } catch {
      // Permissions API indisponível — segue com getCurrentPosition normalmente.
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
            ? 'Permissão de localização negada. Habilite nas configurações do navegador.'
            : 'Não foi possível obter sua localização. Verifique se o GPS está ativo.',
        });
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
    );
  }, []);

  const setManualLocation = useCallback((point: GeographicPoint, address?: string) => {
    setState({
      point,
      address: address ?? null,
      status: 'success',
      error: null,
    });
  }, []);

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

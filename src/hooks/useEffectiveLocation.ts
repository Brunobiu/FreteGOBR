/**
 * Hook useEffectiveLocation
 *
 * Combina a localizacao do GPS (via `useGeolocation`) com a
 * localizacao manual armazenada pelo usuario (override).
 *
 * Prioridade:
 *   1. Override manual (se houver) — usuario explicitou onde quer
 *      ver fretes
 *   2. GPS — quando o user nao customizou
 *
 * Reage a mudancas de override em tempo real via evento global
 * `fretego-location-override-changed`.
 */

import { useEffect, useState } from 'react';
import { useGeolocation } from './useGeolocation';
import type { GeographicPoint } from '../types';
import {
  LOCATION_OVERRIDE_EVENT,
  readLocationOverride,
  type LocationOverride,
} from '../utils/locationOverride';

export type EffectiveLocationSource = 'gps' | 'override' | 'none';

export interface EffectiveLocationState {
  /** Ponto efetivo — GPS ou override. `null` quando nenhum esta disponivel. */
  point: GeographicPoint | null;
  /** Endereco legivel pra exibir. */
  address: string | null;
  /** Origem da localizacao: GPS, override manual, ou nada. */
  source: EffectiveLocationSource;
  /** Override bruto (so quando source === 'override'). */
  override: LocationOverride | null;
  /** Status do hook GPS subjacente — pra UI controlar banner de permissao. */
  geoStatus: ReturnType<typeof useGeolocation>['status'];
  /** Erro do GPS — quando aplicavel. */
  geoError: string | null;
  requestLocation: () => void;
  clearLocation: () => void;
}

export function useEffectiveLocation(): EffectiveLocationState {
  const geo = useGeolocation();
  const [override, setOverride] = useState<LocationOverride | null>(() =>
    typeof window === 'undefined' ? null : readLocationOverride()
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      setOverride(readLocationOverride());
    };
    window.addEventListener(LOCATION_OVERRIDE_EVENT, sync);
    // Tambem sincroniza em mudancas de aba (storage event)
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LOCATION_OVERRIDE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (override) {
    return {
      point: override.point,
      address: override.label,
      source: 'override',
      override,
      geoStatus: geo.status,
      geoError: geo.error,
      requestLocation: geo.requestLocation,
      clearLocation: geo.clearLocation,
    };
  }

  if (geo.status === 'success' && geo.point) {
    return {
      point: geo.point,
      address: geo.address,
      source: 'gps',
      override: null,
      geoStatus: geo.status,
      geoError: geo.error,
      requestLocation: geo.requestLocation,
      clearLocation: geo.clearLocation,
    };
  }

  return {
    point: null,
    address: null,
    source: 'none',
    override: null,
    geoStatus: geo.status,
    geoError: geo.error,
    requestLocation: geo.requestLocation,
    clearLocation: geo.clearLocation,
  };
}

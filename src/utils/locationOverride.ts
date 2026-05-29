/**
 * utils/locationOverride.ts
 *
 * Persistencia da localizacao escolhida manualmente pelo motorista.
 *
 * Quando definida, sobrepoe o GPS:
 *   - O hook `useGeolocation` retorna esse ponto como `point`
 *   - O label do GPS no AppHeader vira `Manual: Cidade, UF`
 *   - O filtro de raio na HomePage usa esse ponto como centro
 *
 * Quando limpa, volta ao GPS normal.
 *
 * Disparamos um custom event `fretego-location-override-changed`
 * para que componentes em outras partes da arvore reajam sem
 * polling.
 */

import type { GeographicPoint } from '../types';

export const LOCATION_OVERRIDE_KEY = 'fretego-location-override';
export const LOCATION_OVERRIDE_EVENT = 'fretego-location-override-changed';

export interface LocationOverride {
  point: GeographicPoint;
  /** Endereco/cidade legivel para exibir no header. Ex: "Anapolis, Goias". */
  label: string;
  /** Quando foi definida — pra TTL futuro se quisermos. */
  setAt: string;
}

function isValidOverride(o: unknown): o is LocationOverride {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  if (typeof r.label !== 'string' || r.label.length === 0) return false;
  if (typeof r.setAt !== 'string') return false;
  const p = r.point as Record<string, unknown> | undefined;
  if (!p) return false;
  return (
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180
  );
}

/**
 * Le a localizacao manual armazenada. Retorna null se nao houver
 * ou se o JSON estiver corrompido.
 */
export function readLocationOverride(): LocationOverride | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCATION_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidOverride(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Grava a localizacao manual. Dispara evento global para que
 * outros componentes recarreguem.
 */
export function writeLocationOverride(override: LocationOverride): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCATION_OVERRIDE_KEY, JSON.stringify(override));
    window.dispatchEvent(new CustomEvent(LOCATION_OVERRIDE_EVENT));
  } catch {
    // localStorage indisponivel (Safari privado, quota): silencioso.
  }
}

/**
 * Remove a localizacao manual e dispara evento.
 */
export function clearLocationOverride(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCATION_OVERRIDE_KEY);
    window.dispatchEvent(new CustomEvent(LOCATION_OVERRIDE_EVENT));
  } catch {
    // ignore
  }
}

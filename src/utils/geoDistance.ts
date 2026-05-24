/**
 * Utilitários puros para cálculo de distância e filtragem de fretes
 * por raio.
 *
 * - `haversineDistanceKm` re-exporta `calculateDistance` do
 *   `services/geolocation.ts` para padronizar o ponto de uso pelos
 *   consumidores novos sem duplicar a lógica de Haversine.
 * - `filterFretesByRadius` é função pura genérica testável por PBT.
 * - `readStoredRadius` / `writeStoredRadius` encapsulam o
 *   localStorage com guards (lixo, indisponibilidade, valor fora
 *   das opções válidas).
 *
 * Sem React, sem Supabase, sem DOM (exceto guard `typeof window`
 * em `writeStoredRadius`).
 */

import type { GeographicPoint } from '../types';
import { calculateDistance } from '../services/geolocation';

/**
 * Opções fixas de raio (em km) oferecidas ao motorista.
 */
export const RADIUS_OPTIONS_KM = [50, 100, 200, 500] as const;
export type RadiusOption = (typeof RADIUS_OPTIONS_KM)[number];

/**
 * Raio padrão (km) quando o motorista não tem preferência salva.
 */
export const RADIUS_DEFAULT_KM: RadiusOption = 100;

/**
 * Chave do localStorage usada para persistir a preferência de raio
 * por dispositivo.
 */
export const RADIUS_STORAGE_KEY = 'fretego-motorista-radius';

/**
 * Calcula a distância em km entre dois pontos via Haversine.
 *
 * Re-export de `calculateDistance` para padronizar o ponto de uso
 * dos consumidores novos sem duplicar a lógica do service.
 */
export const haversineDistanceKm: (p1: GeographicPoint, p2: GeographicPoint) => number =
  calculateDistance;

/**
 * Verifica se um `GeographicPoint` tem coordenadas válidas
 * (finitas e não ambas zero).
 */
function hasValidLocation(p: GeographicPoint): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

/**
 * Filtra fretes por proximidade ao motorista.
 *
 * - Quando `motoristaPoint === null` (geolocalização inativa),
 *   retorna a lista original sem alteração — fallback explícito.
 * - Quando `motoristaPoint` está presente, retorna apenas fretes
 *   cuja origem é (i) válida (lat/lng finitos e não-zero) e
 *   (ii) está dentro do raio em km.
 *
 * Função pura: mesmo input produz mesmo output, sem efeitos.
 */
export function filterFretesByRadius<T extends { originLocation: GeographicPoint }>(
  fretes: T[],
  motoristaPoint: GeographicPoint | null,
  radiusKm: number
): T[] {
  if (motoristaPoint === null) return fretes;
  return fretes.filter((f) => {
    if (!hasValidLocation(f.originLocation)) return false;
    return haversineDistanceKm(motoristaPoint, f.originLocation) <= radiusKm;
  });
}

/**
 * Hidrata o raio a partir de uma string vinda do localStorage.
 *
 * Para qualquer entrada — string válida, inválida, lixo ou null —
 * sempre retorna um membro válido de `RADIUS_OPTIONS_KM`.
 */
export function readStoredRadius(raw: string | null): RadiusOption {
  if (raw === null) return RADIUS_DEFAULT_KM;
  const n = Number(raw);
  if (!Number.isFinite(n)) return RADIUS_DEFAULT_KM;
  if ((RADIUS_OPTIONS_KM as readonly number[]).includes(n)) {
    return n as RadiusOption;
  }
  return RADIUS_DEFAULT_KM;
}

/**
 * Persiste a preferência de raio. Engole erros (Safari privado,
 * quota cheia, indisponível). Seguro em SSR via guard.
 */
export function writeStoredRadius(value: RadiusOption): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RADIUS_STORAGE_KEY, String(value));
  } catch {
    // localStorage indisponível — silencioso
  }
}

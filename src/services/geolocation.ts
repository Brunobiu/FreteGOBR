/**
 * Geolocation Service
 * Geocoding via Nominatim (OpenStreetMap) - gratuito, sem API key
 */

import type { GeographicPoint } from '../types';

export interface GeocodingResult {
  address: string;
  point: GeographicPoint;
  displayName: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/**
 * Converte endereço em coordenadas geográficas
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult[]> {
  const query = encodeURIComponent(`${address}, Brasil`);
  const url = `${NOMINATIM_BASE}/search?q=${query}&format=json&limit=5&countrycodes=br`;

  const response = await fetch(url, {
    headers: { 'Accept-Language': 'pt-BR' },
  });

  if (!response.ok) {
    throw new Error('Erro ao buscar endereço');
  }

  const data = await response.json();

  return data.map((item: { display_name: string; lat: string; lon: string }) => ({
    address: item.display_name,
    displayName: item.display_name.split(',').slice(0, 2).join(',').trim(),
    point: {
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
    },
  }));
}

/**
 * Converte coordenadas em endereço legível
 */
export async function reverseGeocode(point: GeographicPoint): Promise<string> {
  const url = `${NOMINATIM_BASE}/reverse?lat=${point.latitude}&lon=${point.longitude}&format=json`;

  const response = await fetch(url, {
    headers: { 'Accept-Language': 'pt-BR' },
  });

  if (!response.ok) {
    throw new Error('Erro ao converter coordenadas');
  }

  const data = await response.json();
  const addr = data.address;

  // Monta string legível: "Cidade, Estado"
  const city = addr.city || addr.town || addr.village || addr.municipality || '';
  const state = addr.state || '';
  return city && state ? `${city}, ${state}` : data.display_name;
}

/**
 * Calcula distância em km entre dois pontos (fórmula de Haversine)
 */
export function calculateDistance(point1: GeographicPoint, point2: GeographicPoint): number {
  const R = 6371; // Raio da Terra em km
  const dLat = toRad(point2.latitude - point1.latitude);
  const dLon = toRad(point2.longitude - point1.longitude);
  const lat1 = toRad(point1.latitude);
  const lat2 = toRad(point2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calcula a distância de rota real (por estrada) entre dois pontos usando
 * OSRM (Open Source Routing Machine) — gratuito, sem API key.
 *
 * Tem timeout de 8 segundos. Em caso de falha (timeout, rede, OSRM
 * indisponível), retorna `null` — quem chama deve fazer fallback
 * (ex.: Haversine).
 *
 * @returns distância em km, arredondada, ou null em caso de falha.
 */
export async function calculateRouteDistance(
  origin: GeographicPoint,
  destination: GeographicPoint
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${origin.longitude},${origin.latitude};` +
      `${destination.longitude},${destination.latitude}` +
      `?overview=false`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    if (typeof meters !== 'number') return null;

    return Math.round(meters / 1000);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Busca a geometria da rota (lista de pontos lat/lng) entre dois locais
 * usando OSRM público (router.project-osrm.org). Retorna `null` em caso
 * de falha ou rota não encontrada.
 *
 * Usado pelo `MapaFretes` para desenhar uma polilinha pela estrada
 * (em vez de uma reta entre origem e destino).
 *
 * `overview=full` devolve a geometria completa; `geometries=geojson`
 * devolve coordenadas em [lng, lat] (padrão GeoJSON).
 */
export async function getRouteGeometry(
  origin: GeographicPoint,
  destination: GeographicPoint
): Promise<GeographicPoint[] | null> {
  // Validação de coordenadas
  if (
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(destination.latitude) ||
    !Number.isFinite(destination.longitude)
  ) {
    return null;
  }

  const coords =
    `${origin.longitude},${origin.latitude};` +
    `${destination.longitude},${destination.latitude}`;
  // overview=simplified: bem mais rápido que `full`. Suficiente para
  // exibir uma rota seguindo as estradas no mapa.
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson`;

  // Timeout de 8s para não deixar o usuário pendurado se o OSRM travar.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn('[getRouteGeometry] OSRM HTTP', res.status);
      return null;
    }

    const data = await res.json();

    if (data?.code && data.code !== 'Ok') {
      console.warn('[getRouteGeometry] OSRM code', data.code, data.message);
      return null;
    }

    const geomCoords = data?.routes?.[0]?.geometry?.coordinates as
      | [number, number][]
      | undefined;

    if (!Array.isArray(geomCoords) || geomCoords.length === 0) {
      console.warn('[getRouteGeometry] OSRM sem geometria');
      return null;
    }

    return geomCoords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  } catch (err) {
    clearTimeout(timer);
    console.warn('[getRouteGeometry] erro de rede ou timeout', err);
    return null;
  }
}

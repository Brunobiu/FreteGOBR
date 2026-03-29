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

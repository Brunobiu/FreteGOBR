/**
 * Parser tolerante de coordenadas geográficas (latitude, longitude).
 *
 * Aceita várias fontes comuns do dia a dia:
 *
 *   - Pares simples: "-17.13, -49.97" ou "-17.13 -49.97"
 *   - Com graus: "-17.13°, -49.97°"
 *   - URL completa do Google Maps:
 *       "https://www.google.com/maps/place/.../@-17.1304,-49.9712,17z"
 *   - URL curta (q ou ll):
 *       "https://maps.google.com/?q=-17.1304,-49.9712"
 *   - Parâmetro "ll": "ll=-17.1304,-49.9712"
 *
 * Retorna `null` se não conseguir extrair um par válido (lat ∈ [-90, 90],
 * lng ∈ [-180, 180]).
 *
 * Pure function — sem React, sem fetch, sem DOM.
 */

export interface CoordPair {
  latitude: number;
  longitude: number;
}

const LAT_LNG_REGEX = /(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/;
const GMAPS_AT_REGEX = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
const GMAPS_QUERY_REGEX = /[?&](?:q|ll|destination|center)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function parseCoordInput(input: string): CoordPair | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Tenta padrões específicos de URL do Google Maps primeiro.
  const at = trimmed.match(GMAPS_AT_REGEX);
  if (at) {
    const lat = parseFloat(at[1]);
    const lng = parseFloat(at[2]);
    if (isValidLatLng(lat, lng)) return { latitude: lat, longitude: lng };
  }

  const q = trimmed.match(GMAPS_QUERY_REGEX);
  if (q) {
    const lat = parseFloat(q[1]);
    const lng = parseFloat(q[2]);
    if (isValidLatLng(lat, lng)) return { latitude: lat, longitude: lng };
  }

  // Fallback genérico: primeiro par "lat, lng" no texto.
  const fallback = trimmed.match(LAT_LNG_REGEX);
  if (fallback) {
    const lat = parseFloat(fallback[1]);
    const lng = parseFloat(fallback[2]);
    if (isValidLatLng(lat, lng)) return { latitude: lat, longitude: lng };
  }

  return null;
}

/**
 * Formata um par de coordenadas como string "lat, lng" com 6 casas
 * decimais (precisão de ~10cm).
 */
export function formatCoord(coord: CoordPair): string {
  return `${coord.latitude.toFixed(6)}, ${coord.longitude.toFixed(6)}`;
}

/**
 * Gera URL universal do Google Maps que abre direto no pin. Funciona
 * em mobile (abre o app) e desktop (abre no browser).
 */
export function googleMapsUrl(coord: CoordPair): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord.latitude},${coord.longitude}`;
}

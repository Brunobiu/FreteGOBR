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
    `${origin.longitude},${origin.latitude};` + `${destination.longitude},${destination.latitude}`;
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

    const geomCoords = data?.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;

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

/**
 * Reverse geocode "leve" que devolve apenas a cidade (com UF quando
 * disponivel), ex: "Uberlandia/MG". Retorna string vazia se nao conseguir
 * identificar a cidade.
 */
async function reverseGeocodeCity(point: GeographicPoint, signal?: AbortSignal): Promise<string> {
  const url =
    `${NOMINATIM_BASE}/reverse?lat=${point.latitude}&lon=${point.longitude}` +
    `&format=json&zoom=10&addressdetails=1`;

  const response = await fetch(url, {
    headers: { 'Accept-Language': 'pt-BR' },
    signal,
  });
  if (!response.ok) return '';

  const data = await response.json();
  const addr = data?.address ?? {};
  const city: string =
    addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
  if (!city) return '';

  // UF a partir do codigo ISO (ex: "BR-MG" -> "MG"); fallback: vazio.
  const iso: string = addr['ISO3166-2-lvl4'] || '';
  const uf = iso.includes('-') ? iso.split('-')[1] : '';
  return uf ? `${city}/${uf}` : city;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lista (ordenada) das cidades pelas quais a rota passa, entre a origem e o
 * destino. Amostra a geometria da rota (vinda do OSRM) por distancia e faz
 * reverse-geocode dos pontos intermediarios, deduplicando cidades
 * consecutivas iguais.
 *
 * Nominatim pede no maximo ~1 requisicao/segundo, entao as chamadas sao
 * sequenciais com um pequeno intervalo. O numero de pontos consultados e
 * proporcional a distancia (aprox. 1 a cada 40 km), limitado por `maxStops`
 * (default adaptativo entre 4 e 16). `onProgress` e chamado com a lista
 * parcial a cada cidade nova encontrada (permite atualizar a UI ao vivo).
 * Falhas individuais sao ignoradas; o que deu certo e retornado.
 */
export async function getRouteCities(
  geometry: GeographicPoint[],
  options?: {
    maxStops?: number;
    signal?: AbortSignal;
    onProgress?: (cities: string[]) => void;
  }
): Promise<string[]> {
  if (!Array.isArray(geometry) || geometry.length < 2) return [];
  const signal = options?.signal;

  // Distancia acumulada ao longo da geometria.
  const cum: number[] = [0];
  for (let i = 1; i < geometry.length; i++) {
    cum[i] = cum[i - 1] + calculateDistance(geometry[i - 1], geometry[i]);
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [];

  // Quantos pontos amostrar: ~1 a cada 40 km, entre 4 e 16 (ou o que o
  // chamador pedir). Mais pontos = mais cidades, mas mais lento (1 req/s).
  const adaptive = Math.round(total / 40);
  const maxStops = Math.max(4, Math.min(options?.maxStops ?? adaptive, 16));

  // Pontos-alvo em fracoes intermediarias (exclui origem e destino).
  const targets: GeographicPoint[] = [];
  for (let k = 1; k <= maxStops; k++) {
    const targetDist = (k / (maxStops + 1)) * total;
    let idx = 0;
    while (idx < cum.length - 1 && cum[idx] < targetDist) idx++;
    targets.push(geometry[idx]);
  }

  const cities: string[] = [];
  for (const pt of targets) {
    if (signal?.aborted) break;
    try {
      const label = await reverseGeocodeCity(pt, signal);
      if (label && cities[cities.length - 1] !== label) {
        cities.push(label);
        options?.onProgress?.([...cities]);
      }
    } catch {
      // ignora falhas pontuais (rede, abort, parsing)
    }
    if (signal?.aborted) break;
    await sleep(1100); // respeita o limite ~1 req/s do Nominatim
  }
  return cities;
}

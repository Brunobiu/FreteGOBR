/**
 * cp-fitbounds.property.test.ts
 *
 * Property F: o bounds calculado a partir de
 * `circleBoundsGeo(point, radiusKm)` enquadra todos os pontos sobre
 * o circulo, com tolerancia de 5%.
 *
 * Geometria pura — nao importa Leaflet. Verificamos que o
 * `LatLngBounds` matemático (norte/sul/leste/oeste) calculado via
 * graus de aproximacao geografica e suficiente pra `fitBounds`
 * conter todos os pontos a `radiusKm` km do centro.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

const KM_PER_DEG_LAT = 111;

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface Point {
  lat: number;
  lng: number;
}

/**
 * Calcula bounds geograficos para um circulo de raio em km a partir
 * do ponto central. Usa aproximacao plana — boa o suficiente para
 * latitudes < 60 graus.
 */
function circleBoundsGeo(point: Point, radiusKm: number): Bounds {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  // Defensiva: cosLat pode ser muito pequeno perto dos polos. Como
  // o domain de teste limita a [-60, 60], aqui sempre > 0.5.
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.max(cosLat, 1e-6));
  return {
    north: point.lat + dLat,
    south: point.lat - dLat,
    east: point.lng + dLng,
    west: point.lng - dLng,
  };
}

/**
 * Calcula um ponto a `radiusKm` na direcao `bearingRad` a partir
 * do centro. Aproximacao geografica plana (mesma da circleBoundsGeo).
 */
function destinationPoint(center: Point, bearingRad: number, radiusKm: number): Point {
  const dLat = (radiusKm / KM_PER_DEG_LAT) * Math.cos(bearingRad);
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const dLng = (radiusKm / (KM_PER_DEG_LAT * Math.max(cosLat, 1e-6))) * Math.sin(bearingRad);
  return {
    lat: center.lat + dLat,
    lng: center.lng + dLng,
  };
}

describe('motorista-mapa: circleBoundsGeo (Property F)', () => {
  const radiusOptions = fc.constantFrom(50, 100, 200, 500);
  // Limita lat para [-60, 60] (longe dos polos onde a longitude
  // diverge). Range pratico cobre Brasil inteiro com folga.
  const latArb = fc.float({
    min: Math.fround(-60),
    max: Math.fround(60),
    noNaN: true,
  });
  const lngArb = fc.float({
    min: Math.fround(-180),
    max: Math.fround(180),
    noNaN: true,
  });

  it('todos os pontos sobre o circulo caem dentro do bounds (16 amostras por orientacao)', () => {
    fc.assert(
      fc.property(latArb, lngArb, radiusOptions, (lat, lng, radiusKm) => {
        const center = { lat, lng };
        const bounds = circleBoundsGeo(center, radiusKm);
        // Tolerancia 5% — overshoot aceitavel, undershoot nao.
        const tolKm = radiusKm * 0.05;

        for (let i = 0; i < 16; i++) {
          const bearing = (2 * Math.PI * i) / 16;
          const p = destinationPoint(center, bearing, radiusKm);

          // Cada ponto sobre o circulo deve estar dentro do bounds
          // (com tolerancia de 5% em km — convertida pra graus).
          const tolDeg = tolKm / KM_PER_DEG_LAT;

          expect(p.lat).toBeLessThanOrEqual(bounds.north + tolDeg);
          expect(p.lat).toBeGreaterThanOrEqual(bounds.south - tolDeg);
          // Para longitude, a tolerancia em graus depende da latitude.
          const cosLat = Math.cos((center.lat * Math.PI) / 180);
          const tolLngDeg = tolKm / (KM_PER_DEG_LAT * Math.max(cosLat, 1e-6));
          expect(p.lng).toBeLessThanOrEqual(bounds.east + tolLngDeg);
          expect(p.lng).toBeGreaterThanOrEqual(bounds.west - tolLngDeg);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('north > south e east > west para qualquer raio positivo', () => {
    fc.assert(
      fc.property(latArb, lngArb, radiusOptions, (lat, lng, radiusKm) => {
        const bounds = circleBoundsGeo({ lat, lng }, radiusKm);
        expect(bounds.north).toBeGreaterThan(bounds.south);
        expect(bounds.east).toBeGreaterThan(bounds.west);
      }),
      { numRuns: 200 }
    );
  });
});

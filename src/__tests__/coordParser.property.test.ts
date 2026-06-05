/**
 * Property-Based Tests — Parser de coordenadas (Tarefa 8).
 *
 * Property 2 (round-trip): para todo par válido (lat, lng),
 * parseCoordInput(formatCoord(pair)) ≈ pair (até 6 casas).
 * Entradas malformadas ⇒ null (sem lançar).
 *
 * Validates: Requirements 5.1, 5.3, 5.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCoordInput, formatCoord, googleMapsUrl } from '../utils/coordParser';

const latArb = () => fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const lngArb = () => fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

describe('Property 2 — round-trip coordenada', () => {
  it('parseCoordInput(formatCoord(pair)) ≈ pair', () => {
    fc.assert(
      fc.property(latArb(), lngArb(), (lat, lng) => {
        const formatted = formatCoord({ latitude: lat, longitude: lng });
        const parsed = parseCoordInput(formatted);
        expect(parsed).not.toBeNull();
        expect(Math.abs(parsed!.latitude - Number(lat.toFixed(6)))).toBeLessThan(1e-6);
        expect(Math.abs(parsed!.longitude - Number(lng.toFixed(6)))).toBeLessThan(1e-6);
      }),
      { numRuns: 400 }
    );
  });

  it('extrai coordenada de URL do Google Maps (@lat,lng)', () => {
    fc.assert(
      fc.property(latArb(), lngArb(), (lat, lng) => {
        const url = `https://www.google.com/maps/place/X/@${lat.toFixed(4)},${lng.toFixed(4)},17z`;
        const parsed = parseCoordInput(url);
        expect(parsed).not.toBeNull();
        expect(Math.abs(parsed!.latitude - Number(lat.toFixed(4)))).toBeLessThan(1e-3);
      }),
      { numRuns: 200 }
    );
  });
});

describe('parseCoordInput — entradas inválidas ⇒ null (sem lançar)', () => {
  it('string vazia, lixo e fora de faixa retornam null', () => {
    expect(parseCoordInput('')).toBeNull();
    expect(parseCoordInput('   ')).toBeNull();
    expect(parseCoordInput('sem coordenada aqui')).toBeNull();
    expect(parseCoordInput('999, 999')).toBeNull(); // fora de faixa
  });

  it('nunca lança para qualquer string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (s) => {
        expect(() => parseCoordInput(s)).not.toThrow();
      }),
      { numRuns: 300 }
    );
  });
});

describe('googleMapsUrl', () => {
  it('gera URL contendo as coordenadas', () => {
    fc.assert(
      fc.property(latArb(), lngArb(), (lat, lng) => {
        const url = googleMapsUrl({ latitude: lat, longitude: lng });
        expect(url).toContain(`${lat},${lng}`);
        expect(url.startsWith('https://')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

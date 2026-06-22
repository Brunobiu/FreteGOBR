// Feature: marketplace, Property 1
/**
 * CP-1: Photo_Collage determinística
 *
 * Para qualquer quantidade de fotos `n`, `computeCollageLayout(n)`:
 *  - exibe exatamente `min(n, 4)` quadros;
 *  - `overlayCount === max(0, n - 4)`;
 *  - todo `tile.photoIndex` ∈ `[0, n)`, distinto e crescente a partir de 0;
 *  - apenas o último quadro pode ter `overlayCount > 0`;
 *  - `variant` coerente com `min(n, 4)`;
 *  - é determinística.
 *
 * Lógica pura (sem I/O), então não há mocks.
 *
 * Validates: Requirements 8.1, 8.2, 8.3 (Property 1)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { computeCollageLayout, COLLAGE_MAX_TILES } from '../../utils/marketplaceCollage';

describe('CP-1: layout da Photo_Collage', () => {
  it('quantidade de quadros, overlay e índices respeitam as invariantes (1..10 fotos)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (n) => {
        const layout = computeCollageLayout(n);
        const expectedTiles = Math.min(n, COLLAGE_MAX_TILES);

        // min(n, 4) quadros e overlay = max(0, n - 4).
        expect(layout.tiles).toHaveLength(expectedTiles);
        expect(layout.overlayCount).toBe(Math.max(0, n - COLLAGE_MAX_TILES));

        // Índices crescentes 0..k-1 e dentro de [0, n).
        layout.tiles.forEach((tile, idx) => {
          expect(tile.photoIndex).toBe(idx);
          expect(tile.photoIndex).toBeGreaterThanOrEqual(0);
          expect(tile.photoIndex).toBeLessThan(n);
        });

        // Apenas o último quadro pode ter overlay; os demais têm 0.
        layout.tiles.forEach((tile, idx) => {
          const isLast = idx === layout.tiles.length - 1;
          if (!isLast) {
            expect(tile.overlayCount).toBe(0);
          } else {
            expect(tile.overlayCount).toBe(layout.overlayCount);
          }
        });

        // variant coerente com min(n, 4).
        expect(layout.variant).toBe(expectedTiles);
      }),
      { numRuns: 100 }
    );
  });

  it('é determinística (mesma entrada ⇒ mesma saída)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        expect(computeCollageLayout(n)).toEqual(computeCollageLayout(n));
      }),
      { numRuns: 100 }
    );
  });

  it('entradas inválidas (NaN, negativas, fracionárias) não lançam e saneiam para count >= 0', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(NaN, Infinity, -Infinity, -1, -10),
          fc.double({ min: -5, max: 0, noNaN: true }),
          fc.double({ min: 0, max: 12, noNaN: true })
        ),
        (raw) => {
          const layout = computeCollageLayout(raw);
          expect(layout.tiles.length).toBeGreaterThanOrEqual(0);
          expect(layout.tiles.length).toBeLessThanOrEqual(COLLAGE_MAX_TILES);
          expect(layout.overlayCount).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exemplos concretos (1, 3, 4, 10 fotos)', () => {
    expect(computeCollageLayout(1).tiles).toHaveLength(1);
    expect(computeCollageLayout(1).overlayCount).toBe(0);

    expect(computeCollageLayout(3).tiles).toHaveLength(3);
    expect(computeCollageLayout(3).overlayCount).toBe(0);

    expect(computeCollageLayout(4).tiles).toHaveLength(4);
    expect(computeCollageLayout(4).overlayCount).toBe(0);

    const ten = computeCollageLayout(10);
    expect(ten.tiles).toHaveLength(4);
    expect(ten.overlayCount).toBe(6);
    expect(ten.tiles[3].overlayCount).toBe(6);
  });
});

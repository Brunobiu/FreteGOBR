// Feature: marketplace, Property 2
/**
 * CP-2: Validação de anúncio completa e determinística
 *
 * `validateMarketplacePostInput(input).ok` é `true` se e somente se todas as
 * regras valem (título 1..120 após trim, descrição 0..2000, price null|>0,
 * 1..10 fotos com MIME/limite válidos, hasLocation true). Cada violação aponta
 * o campo ofensor com o code correto. Revalidar dá o mesmo resultado.
 *
 * Lógica pura (sem I/O), então não há mocks.
 *
 * Validates: Requirements 3.1-3.8, 4.4, 4.5 (Property 2)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  validateMarketplacePostInput,
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  TITLE_MAX,
  type MarketplacePostInput,
  type PhotoMeta,
  type PostType,
} from '../../utils/marketplacePost';
import { safeText } from '../_helpers/generators';

// ─── Geradores ───────────────────────────────────────────────────────────────

const NON_SPACE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP0123456789'.split('');

/** String sem espaços com comprimento (= comprimento após trim) em [min, max]. */
function nonSpaceOfLength(min: number, max: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...NON_SPACE), { minLength: min, maxLength: max }).map((a) => a.join(''));
}

/** String ASCII (pode conter espaços) com comprimento bruto em [min, max]. */
function asciiOfLength(min: number, max: number): fc.Arbitrary<string> {
  const chars = [...NON_SPACE, ' '];
  return fc.array(fc.constantFrom(...chars), { minLength: min, maxLength: max }).map((a) => a.join(''));
}

const postTypeGen = fc.constantFrom('venda', 'noticia') as fc.Arbitrary<PostType>;

const validPhoto: fc.Arbitrary<PhotoMeta> = fc.record({
  mime: fc.constantFrom(...ALLOWED_PHOTO_MIME),
  sizeBytes: fc.integer({ min: 1, max: MAX_PHOTO_BYTES }),
});

const badMimePhoto: fc.Arbitrary<PhotoMeta> = fc.record({
  mime: fc.constantFrom('application/pdf', 'text/plain', 'image/svg+xml', 'image/bmp', ''),
  sizeBytes: fc.integer({ min: 1, max: MAX_PHOTO_BYTES }),
});

const oversizePhoto: fc.Arbitrary<PhotoMeta> = fc.record({
  mime: fc.constantFrom(...ALLOWED_PHOTO_MIME),
  sizeBytes: fc.integer({ min: MAX_PHOTO_BYTES + 1, max: MAX_PHOTO_BYTES * 4 }),
});

const validPrice: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Anúncio totalmente válido. */
const validInput: fc.Arbitrary<MarketplacePostInput> = fc.record({
  postType: postTypeGen,
  title: nonSpaceOfLength(1, TITLE_MAX),
  description: fc.oneof(fc.constant(''), safeText(1, 400)),
  price: validPrice,
  photos: fc.array(validPhoto, { minLength: 1, maxLength: 10 }),
  hasLocation: fc.constant(true),
});

describe('CP-2: validação de anúncio', () => {
  it('input totalmente válido ⇒ ok === true e sem fieldErrors', () => {
    fc.assert(
      fc.property(validInput, (input) => {
        const res = validateMarketplacePostInput(input);
        expect(res.ok).toBe(true);
        expect(Object.keys(res.fieldErrors)).toHaveLength(0);
      }),
      { numRuns: 200 }
    );
  });

  it('é determinística (revalidar dá o mesmo resultado)', () => {
    fc.assert(
      fc.property(validInput, (input) => {
        expect(validateMarketplacePostInput(input)).toEqual(validateMarketplacePostInput(input));
      }),
      { numRuns: 100 }
    );
  });

  // ─── Cada violação isolada aponta o campo ofensor com o code correto ───────

  it('título vazio/só espaços ⇒ TITLE_REQUIRED', () => {
    fc.assert(
      fc.property(validInput, fc.constantFrom('', '   ', '\t', '  \n '), (base, title) => {
        const res = validateMarketplacePostInput({ ...base, title });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.title).toBe('TITLE_REQUIRED');
        expect(Object.keys(res.fieldErrors)).toEqual(['title']);
      }),
      { numRuns: 50 }
    );
  });

  it('título com mais de 120 caracteres ⇒ TITLE_TOO_LONG', () => {
    fc.assert(
      fc.property(validInput, nonSpaceOfLength(TITLE_MAX + 1, TITLE_MAX + 40), (base, title) => {
        const res = validateMarketplacePostInput({ ...base, title });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.title).toBe('TITLE_TOO_LONG');
      }),
      { numRuns: 50 }
    );
  });

  it('descrição com mais de 2000 caracteres ⇒ DESCRIPTION_TOO_LONG', () => {
    fc.assert(
      fc.property(validInput, asciiOfLength(2001, 2040), (base, description) => {
        const res = validateMarketplacePostInput({ ...base, description });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.description).toBe('DESCRIPTION_TOO_LONG');
      }),
      { numRuns: 50 }
    );
  });

  it('valor presente <= 0 ou não-finito ⇒ INVALID_PRICE', () => {
    fc.assert(
      fc.property(validInput, fc.constantFrom(0, -1, -99.9, NaN, Infinity, -Infinity), (base, price) => {
        const res = validateMarketplacePostInput({ ...base, price });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.price).toBe('INVALID_PRICE');
      }),
      { numRuns: 50 }
    );
  });

  it('sem valor (null) ⇒ PRICE_REQUIRED', () => {
    fc.assert(
      fc.property(validInput, (base) => {
        const res = validateMarketplacePostInput({ ...base, price: null });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.price).toBe('PRICE_REQUIRED');
      }),
      { numRuns: 30 }
    );
  });

  it('zero fotos ⇒ NO_PHOTOS', () => {
    fc.assert(
      fc.property(validInput, (base) => {
        const res = validateMarketplacePostInput({ ...base, photos: [] });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.photos).toBe('NO_PHOTOS');
      }),
      { numRuns: 30 }
    );
  });

  it('mais de 10 fotos ⇒ TOO_MANY_PHOTOS', () => {
    fc.assert(
      fc.property(validInput, fc.array(validPhoto, { minLength: 11, maxLength: 15 }), (base, photos) => {
        const res = validateMarketplacePostInput({ ...base, photos });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.photos).toBe('TOO_MANY_PHOTOS');
      }),
      { numRuns: 50 }
    );
  });

  it('alguma foto com MIME inválido ⇒ INVALID_FILE_TYPE', () => {
    fc.assert(
      fc.property(
        validInput,
        fc.array(validPhoto, { minLength: 0, maxLength: 9 }),
        badMimePhoto,
        (base, goodOnes, bad) => {
          const photos = [...goodOnes, bad]; // 1..10
          const res = validateMarketplacePostInput({ ...base, photos });
          expect(res.ok).toBe(false);
          expect(res.fieldErrors.photos).toBe('INVALID_FILE_TYPE');
        }
      ),
      { numRuns: 80 }
    );
  });

  it('alguma foto acima de 5 MB (MIME válido) ⇒ PHOTO_TOO_LARGE', () => {
    fc.assert(
      fc.property(
        validInput,
        fc.array(validPhoto, { minLength: 0, maxLength: 9 }),
        oversizePhoto,
        (base, goodOnes, bad) => {
          const photos = [...goodOnes, bad]; // 1..10
          const res = validateMarketplacePostInput({ ...base, photos });
          expect(res.ok).toBe(false);
          expect(res.fieldErrors.photos).toBe('PHOTO_TOO_LARGE');
        }
      ),
      { numRuns: 80 }
    );
  });

  it('sem localização ⇒ LOCATION_REQUIRED', () => {
    fc.assert(
      fc.property(validInput, (base) => {
        const res = validateMarketplacePostInput({ ...base, hasLocation: false });
        expect(res.ok).toBe(false);
        expect(res.fieldErrors.hasLocation).toBe('LOCATION_REQUIRED');
        expect(Object.keys(res.fieldErrors)).toEqual(['hasLocation']);
      }),
      { numRuns: 50 }
    );
  });

  // ─── Equivalência ok ⟺ sem fieldErrors (entradas arbitrárias) ──────────────

  it('ok é verdadeiro se e somente se não há fieldErrors', () => {
    const anyTitle = fc.oneof(
      nonSpaceOfLength(1, TITLE_MAX),
      fc.constantFrom('', '   '),
      nonSpaceOfLength(TITLE_MAX + 1, TITLE_MAX + 20)
    );
    const anyDescription = fc.oneof(asciiOfLength(0, 200), asciiOfLength(2001, 2020));
    const anyPrice = fc.oneof(
      validPrice,
      fc.constant<number | null>(null),
      fc.constantFrom(0, -1, NaN, Infinity)
    );
    const anyPhoto = fc.oneof(validPhoto, badMimePhoto, oversizePhoto);
    const anyPhotos = fc.oneof(
      fc.constant<PhotoMeta[]>([]),
      fc.array(anyPhoto, { minLength: 1, maxLength: 10 }),
      fc.array(validPhoto, { minLength: 11, maxLength: 14 })
    );
    const anyInput: fc.Arbitrary<MarketplacePostInput> = fc.record({
      postType: postTypeGen,
      title: anyTitle,
      description: anyDescription,
      price: anyPrice,
      photos: anyPhotos,
      hasLocation: fc.boolean(),
    });

    fc.assert(
      fc.property(anyInput, (input) => {
        const res = validateMarketplacePostInput(input);
        expect(res.ok).toBe(Object.keys(res.fieldErrors).length === 0);
      }),
      { numRuns: 300 }
    );
  });
});

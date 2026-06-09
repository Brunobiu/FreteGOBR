/**
 * Property-Based Test — Frete Comunidade, Property 6: Telefone BR determinístico
 * e WhatsApp_Deep_Link bem-formado.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 5.7, 10.7, 10.8
 *
 * Invariantes:
 *   - `normalizeCommunityPhone` é idempotente e produz apenas dígitos.
 *   - `buildWhatsAppDeepLink(phone)` retorna `https://wa.me/55<digits>?text=...`
 *     com o texto contendo FRETEGO_DOMAIN sse o telefone normalizado é BR
 *     válido (10/11 dígitos); retorna `null` exatamente quando inválido.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { normalizeCommunityPhone } from '../utils/communitySheet';
import {
  FRETEGO_DOMAIN,
  buildCommunityWhatsAppMessage,
  buildWhatsAppDeepLink,
} from '../utils/communityFrete';
import { isValidPhoneBR } from '../utils/phoneFormat';

/** Telefones BR válidos (10/11 dígitos com DDD) em formatos variados. */
const validPhoneArb = fc.constantFrom(
  '(62) 99999-8888',
  '62999998888',
  '(11) 98765-4321',
  '11 3333-4444',
  '6233334444',
  '(21) 9 9123-4567',
  '48988887777'
);

/** Telefones inválidos (curtos, longos, vazios, sem dígitos). */
const invalidPhoneArb = fc.constantFrom(
  '',
  '123',
  '999',
  '123456789', // 9 dígitos
  '123456789012', // 12 dígitos
  'abc',
  '(00)',
  '+55'
);

/** String arbitrária qualquer (ruído) para exercitar normalização. */
const noisyPhoneArb = fc
  .string({ minLength: 0, maxLength: 30 })
  .map((s) => s);

describe('Frete Comunidade — Property 6: telefone + WhatsApp deep-link', () => {
  it('normalizeCommunityPhone produz apenas dígitos e é idempotente', () => {
    fc.assert(
      fc.property(noisyPhoneArb, (raw) => {
        const once = normalizeCommunityPhone(raw);
        const twice = normalizeCommunityPhone(once);
        expect(/^[0-9]*$/.test(once)).toBe(true);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('telefone BR válido ⇒ deep-link bem-formado com FRETEGO_DOMAIN', () => {
    fc.assert(
      fc.property(validPhoneArb, (phone) => {
        const link = buildWhatsAppDeepLink(phone);
        expect(link).not.toBeNull();
        const digits = normalizeCommunityPhone(phone);
        expect(link).toContain(`https://wa.me/55${digits}?text=`);
        // O texto codificado deve conter o domínio do FreteGO.
        const decoded = decodeURIComponent(link!.split('?text=')[1]);
        expect(decoded).toContain(FRETEGO_DOMAIN);
        expect(decoded).toBe(buildCommunityWhatsAppMessage());
      }),
      { numRuns: 200 }
    );
  });

  it('telefone inválido ⇒ deep-link é null', () => {
    fc.assert(
      fc.property(invalidPhoneArb, (phone) => {
        expect(buildWhatsAppDeepLink(phone)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('null sse o telefone normalizado é inválido (bicondicional)', () => {
    fc.assert(
      fc.property(fc.oneof(validPhoneArb, invalidPhoneArb, noisyPhoneArb), (phone) => {
        const link = buildWhatsAppDeepLink(phone);
        const valid = isValidPhoneBR(normalizeCommunityPhone(phone));
        expect(link === null).toBe(!valid);
      }),
      { numRuns: 300 }
    );
  });

  it('mensagem canônica sempre inclui o domínio (Req 10.7)', () => {
    expect(buildCommunityWhatsAppMessage()).toContain(FRETEGO_DOMAIN);
  });
});

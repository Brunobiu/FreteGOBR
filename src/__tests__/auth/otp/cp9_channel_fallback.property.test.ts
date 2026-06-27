/**
 * Property-Based Test — auth-otp-whatsapp, CP9: decisão de canal / fallback.
 *
 * Feature: auth-otp-whatsapp
 * Validates: Requisitos 1 e 2 (envio por WhatsApp + fallback de e-mail).
 *
 * `src/utils/otpChannel.ts` é o ESPELHO testável da lógica que roda dentro da
 * Edge `send-signup-otp`. A decisão é PURA e determinística.
 *
 * Invariantes:
 *   - forceEmail ⇒ 'email' se houver e-mail, senão 'none'.
 *   - WhatsApp OK ⇒ 'whatsapp' (independe de hasEmail).
 *   - WhatsApp falhou ⇒ fallback 'email' se houver, senão 'none'.
 *   - Nunca retorna 'whatsapp' quando whatsappOk = false.
 *   - Determinístico: mesma entrada ⇒ mesma saída.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decideSentChannel } from '../../../utils/otpChannel';

describe('CP9 — decideSentChannel (fallback determinístico)', () => {
  it('forceEmail ⇒ email se houver e-mail, senão none', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (whatsappOk, hasEmail) => {
        const r = decideSentChannel({ whatsappOk, hasEmail, forceEmail: true });
        expect(r).toBe(hasEmail ? 'email' : 'none');
      })
    );
  });

  it('normal + WhatsApp OK ⇒ whatsapp (independe de hasEmail)', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasEmail) => {
        expect(decideSentChannel({ whatsappOk: true, hasEmail, forceEmail: false })).toBe(
          'whatsapp'
        );
      })
    );
  });

  it('normal + WhatsApp falhou ⇒ fallback email se houver, senão none', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasEmail) => {
        const r = decideSentChannel({ whatsappOk: false, hasEmail, forceEmail: false });
        expect(r).toBe(hasEmail ? 'email' : 'none');
      })
    );
  });

  it('nunca retorna whatsapp quando whatsappOk = false', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasEmail, forceEmail) => {
        expect(
          decideSentChannel({ whatsappOk: false, hasEmail, forceEmail })
        ).not.toBe('whatsapp');
      })
    );
  });

  it('determinístico: mesma entrada ⇒ mesma saída', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (w, h, f) => {
        const a = decideSentChannel({ whatsappOk: w, hasEmail: h, forceEmail: f });
        const b = decideSentChannel({ whatsappOk: w, hasEmail: h, forceEmail: f });
        expect(a).toBe(b);
      })
    );
  });
});

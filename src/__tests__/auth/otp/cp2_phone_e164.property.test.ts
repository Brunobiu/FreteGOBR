/**
 * Property-Based Test — auth-otp-whatsapp, CP2: normalização E.164 (BR).
 *
 * Feature: auth-otp-whatsapp
 * Validates: Requisito 9 (normalização determinística do telefone).
 *
 * `src/utils/phoneE164.ts` é o ESPELHO em TS da função SQL
 * `normalize_phone_e164` (migration 125). Estas propriedades garantem a
 * sincronia de regras e a idempotência (mesmo número ⇒ mesmo E.164).
 *
 * Invariantes:
 *   - Local BR (10/11 dígitos) ⇒ prefixa `55` (total 12/13).
 *   - Já internacional (`55` + 10/11) ⇒ inalterado.
 *   - Idempotência: e164(e164(x)) === e164(x).
 *   - Máscara/ruído não muda o resultado (só os dígitos importam).
 *   - Comprimentos fora das regras ⇒ null.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { toE164BR, onlyDigits } from '../../../utils/phoneE164';
import { validPhone } from '../../_helpers/generators';

// DDD 11..99 + assinante de 8 ou 9 dígitos ⇒ local de 10 ou 11 dígitos.
const ddd = fc.integer({ min: 11, max: 99 }).map(String);
const sub = fc.oneof(
  fc.integer({ min: 0, max: 99_999_999 }).map((n) => String(n).padStart(8, '0')),
  fc.integer({ min: 0, max: 999_999_999 }).map((n) => String(n).padStart(9, '0'))
);
const localPhone = fc.tuple(ddd, sub).map(([d, s]) => d + s);

describe('CP2 — normalize_phone_e164 (phoneE164.ts)', () => {
  it('local BR (10/11 dígitos) ⇒ prefixa 55 e fica com 12/13 dígitos', () => {
    fc.assert(
      fc.property(localPhone, (p) => {
        const e = toE164BR(p);
        expect(e).toBe(`55${p}`);
        expect(e!.length === 12 || e!.length === 13).toBe(true);
      })
    );
  });

  it('já internacional (55 + local) ⇒ inalterado', () => {
    fc.assert(
      fc.property(localPhone, (p) => {
        const intl = `55${p}`;
        expect(toE164BR(intl)).toBe(intl);
      })
    );
  });

  it('idempotência: e164(e164(x)) === e164(x)', () => {
    fc.assert(
      fc.property(localPhone, (p) => {
        const once = toE164BR(p)!;
        expect(toE164BR(once)).toBe(once);
      })
    );
  });

  it('tolera máscara/ruído: mesmos dígitos ⇒ mesmo E.164', () => {
    fc.assert(
      fc.property(validPhone(), (formatted) => {
        expect(toE164BR(formatted)).toBe(toE164BR(onlyDigits(formatted)));
      })
    );
  });

  it('idempotência geral: se e164(x) ≠ null então é ponto fixo', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (s) => {
        const e = toE164BR(s);
        if (e !== null) expect(toE164BR(e)).toBe(e);
      })
    );
  });

  it('comprimentos fora das regras ⇒ null', () => {
    const bad = fc.oneof(
      fc.integer({ min: 0, max: 9 }).map((n) => '1'.repeat(n)), // 0..9 dígitos
      fc.constantFrom('1'.repeat(14), '1'.repeat(15), '4499999999999') // 14/15; 13 sem 55
    );
    fc.assert(
      fc.property(bad, (s) => {
        const d = onlyDigits(s);
        const isLocal = d.length === 10 || d.length === 11;
        const isE164 = d.startsWith('55') && (d.length === 12 || d.length === 13);
        if (!isLocal && !isE164) expect(toE164BR(s)).toBeNull();
      })
    );
  });
});

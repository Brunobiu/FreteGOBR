/**
 * Property + unit tests da camada pura `whatsappHandoff`.
 *
 * Cobre:
 *  - whatsappGate: liberação só com AMBOS os lados >= limiar; "restantes" nunca
 *    negativos; saneamento de entradas inválidas (NaN/negativo/fracionário).
 *  - toWhatsappNumber/buildWhatsappLink: normalização para `wa.me` (DDI 55) e
 *    rejeição (null) de números implausíveis.
 *  - buildFreteInterestMessage: cita a rota e muda conforme motorista/embarcador.
 *
 * Convenções do projeto: fast-check; PII via `fc.constantFrom`; NUNCA `fc.stringOf`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  whatsappGate,
  toWhatsappNumber,
  buildWhatsappLink,
  buildFreteInterestMessage,
  WHATSAPP_UNLOCK_THRESHOLD,
} from '../services/whatsappHandoff';
import { validPhone } from './_helpers/generators';
import { sanitizePhone } from '../utils/phoneFormat';

/** Gera uma string só de dígitos com comprimento em [min, max] (sem fc.stringOf). */
function digitString(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...'0123456789'.split('')), { minLength: min, maxLength: max })
    .map((a) => a.join(''));
}

describe('whatsappGate', () => {
  it('libera somente quando os dois lados atingem o limiar', () => {
    fc.assert(
      fc.property(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.integer({ min: 1, max: 10 }), (s, p, t) => {
        const g = whatsappGate(s, p, t);
        expect(g.unlocked).toBe(s >= t && p >= t);
        expect(g.remainingSelf).toBe(Math.max(0, t - s));
        expect(g.remainingPeer).toBe(Math.max(0, t - p));
        // "restantes" nunca negativos
        expect(g.remainingSelf).toBeGreaterThanOrEqual(0);
        expect(g.remainingPeer).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('saneia entradas inválidas (NaN, negativo, fracionário) sem lançar', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(NaN, -1, -10, 2.7, Infinity, -Infinity),
        fc.constantFrom(NaN, -1, -10, 2.7, Infinity, -Infinity),
        (s, p) => {
          const g = whatsappGate(s, p, 3);
          // entradas <= 0 ou inválidas nunca liberam (precisam de 3 de cada lado)
          expect(g.unlocked).toBe(false);
          expect(g.remainingSelf).toBeGreaterThanOrEqual(0);
          expect(g.remainingPeer).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it('usa o limiar padrão 3 quando omitido', () => {
    expect(whatsappGate(3, 3).unlocked).toBe(true);
    expect(whatsappGate(3, 2).unlocked).toBe(false);
    expect(whatsappGate(2, 3).unlocked).toBe(false);
    expect(WHATSAPP_UNLOCK_THRESHOLD).toBe(3);
  });
});

describe('toWhatsappNumber', () => {
  it('telefones BR válidos viram 55 + dígitos', () => {
    fc.assert(
      fc.property(validPhone(), (phone) => {
        const out = toWhatsappNumber(phone);
        expect(out).not.toBeNull();
        expect(out).toBe(`55${sanitizePhone(phone)}`);
        expect(/^55\d{10,11}$/.test(out as string)).toBe(true);
      })
    );
  });

  it('qualquer saída não-nula é só dígitos, começa com 55 e tem 12–13 dígitos', () => {
    fc.assert(
      fc.property(digitString(0, 16), (d) => {
        const out = toWhatsappNumber(d);
        if (out !== null) {
          expect(/^55\d{10,11}$/.test(out)).toBe(true);
        }
        // 10 ou 11 dígitos sempre normaliza; outros tamanhos (exceto 12/13 com 55) → null
        if (d.length === 10 || d.length === 11) {
          expect(out).toBe(`55${d}`);
        }
      })
    );
  });

  it('casos inválidos retornam null', () => {
    expect(toWhatsappNumber('')).toBeNull();
    expect(toWhatsappNumber('123')).toBeNull();
    expect(toWhatsappNumber('999999999999999')).toBeNull();
    expect(toWhatsappNumber(null)).toBeNull();
    expect(toWhatsappNumber(undefined)).toBeNull();
  });

  it('mantém número que já vem com DDI 55 (12–13 dígitos)', () => {
    expect(toWhatsappNumber('5562999998888')).toBe('5562999998888');
    expect(toWhatsappNumber('556233334444')).toBe('556233334444');
  });
});

describe('buildWhatsappLink', () => {
  it('monta URL wa.me com texto codificado para telefone válido', () => {
    fc.assert(
      fc.property(validPhone(), (phone) => {
        const link = buildWhatsappLink(phone, 'Olá, tudo bem?');
        expect(link).not.toBeNull();
        expect((link as string).startsWith('https://wa.me/55')).toBe(true);
        expect(link).toContain('?text=');
        // espaços viram %20 (sem espaço cru na URL)
        expect((link as string).includes(' ')).toBe(false);
      })
    );
  });

  it('retorna null quando o telefone é inválido', () => {
    expect(buildWhatsappLink('123', 'oi')).toBeNull();
    expect(buildWhatsappLink('', 'oi')).toBeNull();
  });
});

describe('buildFreteInterestMessage', () => {
  const cidade = () =>
    fc.constantFrom('Goiânia, GO', 'São Paulo, SP', 'Uberlândia, MG', 'Rio Verde, GO');

  it('motorista cita interesse e a rota origem→destino', () => {
    fc.assert(
      fc.property(cidade(), cidade(), (origin, destination) => {
        const msg = buildFreteInterestMessage({ origin, destination, asMotorista: true });
        expect(msg).toContain('interesse');
        expect(msg).toContain(origin);
        expect(msg).toContain(destination);
        expect(msg).not.toContain('undefined');
      })
    );
  });

  it('embarcador usa texto diferente do motorista', () => {
    const asMot = buildFreteInterestMessage({ origin: 'A', destination: 'B', asMotorista: true });
    const asEmb = buildFreteInterestMessage({ origin: 'A', destination: 'B', asMotorista: false });
    expect(asMot).not.toBe(asEmb);
    expect(asEmb).toContain('Sobre o frete');
  });

  it('sem origem/destino não vaza "undefined" nem rota quebrada', () => {
    const msg = buildFreteInterestMessage({ asMotorista: true });
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain(' de  para ');
  });
});

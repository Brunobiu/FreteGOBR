/**
 * Property + unit tests dos helpers de data do chat (`chatDates`).
 *
 * Determinístico: as funções relativas a "hoje" recebem `now` explícito.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isSameDay, daySeparatorLabel, formatConversationStartDate } from '../utils/chatDates';

/** Arbitrary de Date sempre VÁLIDA (via timestamp), evitando o Invalid Date que
 *  `fc.date()` pode gerar. */
function validDate(min: Date, max: Date): fc.Arbitrary<Date> {
  return fc.integer({ min: min.getTime(), max: max.getTime() }).map((ms) => new Date(ms));
}

const ANY = () => validDate(new Date(2001, 0, 2), new Date(2098, 11, 30));

/** Normaliza uma data para o meio-dia local (evita bordas de meia-noite/DST). */
function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

describe('isSameDay', () => {
  it('é reflexiva: toda data é o mesmo dia que ela mesma', () => {
    fc.assert(
      fc.property(ANY(), (d) => {
        expect(isSameDay(d, d)).toBe(true);
      })
    );
  });

  it('é simétrica', () => {
    fc.assert(
      fc.property(ANY(), ANY(), (a, b) => {
        expect(isSameDay(a, b)).toBe(isSameDay(b, a));
      })
    );
  });

  it('horas diferentes no mesmo dia continuam o mesmo dia', () => {
    const manha = new Date(2026, 5, 21, 8, 30);
    const noite = new Date(2026, 5, 21, 23, 59);
    expect(isSameDay(manha, noite)).toBe(true);
  });

  it('dias diferentes não são o mesmo dia', () => {
    expect(isSameDay(new Date(2026, 5, 21), new Date(2026, 5, 22))).toBe(false);
  });
});

describe('formatConversationStartDate', () => {
  it('formata como DD/MM/AAAA', () => {
    fc.assert(
      fc.property(ANY(), (d) => {
        expect(/^\d{2}\/\d{2}\/\d{4}$/.test(formatConversationStartDate(d))).toBe(true);
      })
    );
  });

  it('exemplo concreto', () => {
    expect(formatConversationStartDate(new Date(2026, 5, 21))).toBe('21/06/2026');
  });
});

describe('daySeparatorLabel', () => {
  it("mesmo dia que 'now' → Hoje", () => {
    fc.assert(
      fc.property(ANY(), (now) => {
        expect(daySeparatorLabel(now, now)).toBe('Hoje');
      })
    );
  });

  it("dia anterior a 'now' → Ontem", () => {
    fc.assert(
      fc.property(ANY(), (raw) => {
        const now = atNoon(raw);
        const ontem = new Date(now);
        ontem.setDate(now.getDate() - 1);
        expect(daySeparatorLabel(ontem, now)).toBe('Ontem');
      })
    );
  });

  it('2+ dias atrás → DD/MM/AAAA', () => {
    fc.assert(
      fc.property(ANY(), fc.integer({ min: 2, max: 3650 }), (raw, offset) => {
        const now = atNoon(raw);
        const past = new Date(now);
        past.setDate(now.getDate() - offset);
        const label = daySeparatorLabel(past, now);
        expect(label).not.toBe('Hoje');
        expect(label).not.toBe('Ontem');
        expect(label).toBe(formatConversationStartDate(past));
      })
    );
  });
});

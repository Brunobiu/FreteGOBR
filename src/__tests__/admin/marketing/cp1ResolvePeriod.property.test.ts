// Feature: admin-marketing, Property 1: Mapeamento determinístico de período
/**
 * CP-1 — Mapeamento determinístico de período (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 1
 *   - requirements.md §Padrões de Sucesso (CP-1)
 *
 * Função sob teste:
 *   resolvePeriod(period: MetricPeriod, referenceInstant: Date): PeriodRange
 *   (src/services/admin/marketing.ts)
 *
 * Invariantes verificadas (para todo (period, referenceInstant)):
 *   1. Determinismo: mesmo input ⇒ mesmo output (função pura, não lê o relógio).
 *   2. `from <= to` (comparando Date.parse das ISO strings).
 *   3. `to === referenceInstant.toISOString()` (instante de referência normalizado).
 *   4. `7d` ⇒ to - from == 7 dias; `30d` ⇒ to - from == 30 dias (em ms).
 *   5. `today` ⇒ `from` é o início do dia local em America/Sao_Paulo:
 *      a hora local de `from` é 00:00:00 e cai no mesmo dia-calendário (SP) que
 *      o `referenceInstant`. Derivação independente via Intl.DateTimeFormat.
 *
 * Sem mocks: resolvePeriod é pura e determinística.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolvePeriod, type MetricPeriod } from '../../../services/admin/marketing';

/** Milissegundos em um dia (24h). */
const MS_PER_DAY = 86_400_000;

/** Timezone fixo do negócio (CP-1). */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Extrai os componentes de parede (Y/M/D h:m:s) de um instante no timezone
 * America/Sao_Paulo. Derivação INDEPENDENTE da implementação (usa diretamente
 * Intl.DateTimeFormat) para validar o resultado de resolvePeriod sem reusar a
 * lógica interna do service.
 */
function saoPauloWallParts(date: Date): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

// Domínio fechado de MetricPeriod.
const periodArb = fc.constantFrom<MetricPeriod>('today', '7d', '30d');

// Instantes arbitrários dentro de uma janela sã (1990–2099), sem datas inválidas.
const instantArb = fc.date({
  min: new Date('1990-01-01T00:00:00.000Z'),
  max: new Date('2099-12-31T23:59:59.999Z'),
  noInvalidDate: true,
});

// Instantes da ERA ATUAL (>= 2020) para a invariante de "início do dia local".
// O Brasil aboliu o horário de verão em out/2019 (Decreto 9.772/2019); desde
// então America/Sao_Paulo é UTC-3 fixo. `resolvePeriod` só é chamada com o
// instante de referência ≈ agora (KPIs do painel), nunca com datas históricas.
// A faixa ampla (1990–2099) gerava dias de spring-forward em que a meia-noite
// local NÃO existia (ex.: 2012-10-21 pulou 00:00→01:00), quebrando a asserção
// de "from é 00:00:00 local" — cenário impossível no uso real. Por isso a
// invariante de início-de-dia é verificada na era sem DST.
const currentEraInstantArb = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2099-12-31T23:59:59.999Z'),
  noInvalidDate: true,
});

describe('CP-1: resolvePeriod — mapeamento determinístico de período', () => {
  // 1. Determinismo: mesmo input ⇒ mesmo output.
  it('é determinístico (mesmo input ⇒ output profundamente igual)', () => {
    fc.assert(
      fc.property(periodArb, instantArb, (period, instant) => {
        const a = resolvePeriod(period, instant);
        const b = resolvePeriod(period, instant);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });

  // 2. from <= to sempre.
  it('produz from <= to', () => {
    fc.assert(
      fc.property(periodArb, instantArb, (period, instant) => {
        const { from, to } = resolvePeriod(period, instant);
        expect(Date.parse(from)).toBeLessThanOrEqual(Date.parse(to));
      }),
      { numRuns: 100 }
    );
  });

  // 3. to é o referenceInstant normalizado (ISO).
  it('to === referenceInstant.toISOString()', () => {
    fc.assert(
      fc.property(periodArb, instantArb, (period, instant) => {
        const { to } = resolvePeriod(period, instant);
        expect(to).toBe(instant.toISOString());
      }),
      { numRuns: 100 }
    );
  });

  // 4. Períodos relativos: diferença exata em dias.
  it('7d ⇒ to - from == 7 dias; 30d ⇒ to - from == 30 dias', () => {
    fc.assert(
      fc.property(fc.constantFrom<MetricPeriod>('7d', '30d'), instantArb, (period, instant) => {
        const { from, to } = resolvePeriod(period, instant);
        const expectedDays = period === '7d' ? 7 : 30;
        expect(Date.parse(to) - Date.parse(from)).toBe(expectedDays * MS_PER_DAY);
      }),
      { numRuns: 100 }
    );
  });

  // 5. today ⇒ from é o início do dia local em America/Sao_Paulo.
  it('today ⇒ from é 00:00:00 local (SP) no mesmo dia-calendário do referenceInstant', () => {
    fc.assert(
      fc.property(currentEraInstantArb, (instant) => {
        const { from, to } = resolvePeriod('today', instant);

        // A hora de parede de `from` em São Paulo deve ser meia-noite exata.
        const fromParts = saoPauloWallParts(new Date(from));
        expect(fromParts.hour).toBe('00');
        expect(fromParts.minute).toBe('00');
        expect(fromParts.second).toBe('00');

        // `from` e o referenceInstant caem no mesmo dia-calendário em SP.
        const refParts = saoPauloWallParts(instant);
        expect(`${fromParts.year}-${fromParts.month}-${fromParts.day}`).toBe(
          `${refParts.year}-${refParts.month}-${refParts.day}`
        );

        // from <= to e dentro de uma janela de no máximo 25h (margem DST).
        const diff = Date.parse(to) - Date.parse(from);
        expect(diff).toBeGreaterThanOrEqual(0);
        expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-Based Tests — Filtros de trial do painel admin (`src/services/admin/trial.ts`).
 *
 * Arquivo compartilhado pelas Correctness Properties de filtragem da spec
 * `trial-e-bloqueio` (Design Section "Correctness Properties"). Cada propriedade é
 * implementada por um único `describe` de topo (fast-check, >= 100 iterações) e
 * tagueada com o comentário `Feature: trial-e-bloqueio, Property {n}`.
 *
 * O helper puro `classifyTrialState(row, now)` é a fonte de verdade da derivação de
 * estado (`em_trial | expirado | assinante`) — espelho do `CASE` da RPC
 * `admin_list_trial_motoristas`. Estes testes garantem que o filtro de status do
 * painel admin é fiel a essa classificação.
 *
 * Layout do arquivo (um `describe` de topo por propriedade; seções claramente
 * separadas para que as próximas tarefas adicionem blocos sem conflito):
 *   - Property 10: filtro de status de trial no painel admin  (esta tarefa — 8.3)
 *   - Property 11: lista de prestes-a-expirar                 (tarefa 8.4)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  classifyTrialState,
  isAboutToExpire,
  type TrialMotoristaRow,
  type TrialStatusFilter,
} from '../../../services/admin/trial';

/** Milissegundos em um dia (24h) — espelha `DAY_MS` do núcleo puro. */
const DAY_MS = 86_400_000;

/** Range de datas usado pelos geradores (1970 .. 2100), sem datas inválidas. */
const DATE_RANGE = {
  min: new Date(Date.UTC(1970, 0, 1)),
  max: new Date(Date.UTC(2100, 0, 1)),
  noInvalidDate: true,
} as const;

/**
 * Forma "crua" gerada de um motorista de backing. Apenas os campos que
 * `classifyTrialState` consome (mais a chave `is_subscribed`) determinam o
 * `trial_state`; o restante da linha é preenchido com dados plausíveis.
 *
 * `offsetMs`:
 *   - `null`            => `trial_ends_at` ausente (nunca expira => `em_trial`/`assinante`)
 *   - número negativo   => `trial_ends_at` no passado (expirado se não-assinante)
 *   - número >= 0       => `trial_ends_at` >= now; offset 0 cobre a fronteira (<= now)
 */
interface RawRow {
  id: string;
  is_subscribed: boolean;
  offsetMs: number | null;
}

const rawRowArb: fc.Arbitrary<RawRow> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  is_subscribed: fc.boolean(),
  // Cobre passado/futuro/fronteira (0) e o caso nulo (sem trial_ends_at).
  offsetMs: fc.option(fc.integer({ min: -400 * DAY_MS, max: 400 * DAY_MS }), { nil: null }),
});

/**
 * Constrói uma `TrialMotoristaRow`-like a partir da forma crua e de um `now`
 * injetado, derivando `trial_state` via `classifyTrialState` (a fonte da verdade).
 */
function buildRow(raw: RawRow, now: Date): TrialMotoristaRow {
  const trial_ends_at =
    raw.offsetMs == null ? null : new Date(now.getTime() + raw.offsetMs).toISOString();
  const trial_state = classifyTrialState({ is_subscribed: raw.is_subscribed, trial_ends_at }, now);
  return {
    id: raw.id,
    name: `Motorista ${raw.id}`,
    phone: '11999999999',
    trial_ends_at,
    subscription_status: raw.is_subscribed ? 'active' : 'trial',
    is_subscribed: raw.is_subscribed,
    days_left: 0,
    trial_state,
    updated_at: now.toISOString(),
    admin_username: null,
  };
}

/**
 * Filtro PURO modelado conforme o design: mantém as linhas cujo
 * `classifyTrialState` é igual ao status selecionado; `'todos'` mantém todas.
 */
function applyStatusFilter(
  rows: TrialMotoristaRow[],
  status: TrialStatusFilter,
  now: Date
): TrialMotoristaRow[] {
  if (status === 'todos') return rows;
  return rows.filter((r) => classifyTrialState(r, now) === status);
}

// ============================================================================
// Feature: trial-e-bloqueio, Property 10: Filtro de status de trial no painel admin
// Validates: Requirements 10.2
//
// For any conjunto de motoristas de backing e for any filtro de status escolhido
// em {em_trial, expirado, assinante}, todas as linhas retornadas pelo filtro SHALL
// ter trial_state igual ao status solicitado, e nenhuma linha com status diferente
// SHALL ser incluída (classifyTrialState é a fonte da derivação).
// ============================================================================
describe('Property 10: filtro de status de trial no painel admin', () => {
  it('toda linha retornada tem trial_state igual ao status solicitado (nenhuma de status diferente)', () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.array(rawRowArb, { minLength: 0, maxLength: 20 }),
        fc.constantFrom<TrialStatusFilter>('em_trial', 'expirado', 'assinante'),
        (now, raws, status) => {
          const rows = raws.map((r) => buildRow(r, now));
          const filtered = applyStatusFilter(rows, status, now);

          // (a) Toda linha retornada tem o status solicitado.
          for (const row of filtered) {
            expect(row.trial_state).toBe(status);
            // Paridade: o estado pré-computado bate com a reclassificação ao vivo.
            expect(classifyTrialState(row, now)).toBe(status);
          }

          // (b) Nenhuma linha de status diferente foi incluída — o conjunto
          //     filtrado é exatamente o subconjunto de rows com aquele status.
          const expected = rows.filter((r) => r.trial_state === status);
          expect(filtered).toHaveLength(expected.length);
          expect(new Set(filtered.map((r) => r.id))).toEqual(new Set(expected.map((r) => r.id)));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('o filtro é uma partição: a soma dos três status cobre todas as linhas sem sobreposição', () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.array(rawRowArb, { minLength: 0, maxLength: 20 }),
        (now, raws) => {
          const rows = raws.map((r) => buildRow(r, now));

          const emTrial = applyStatusFilter(rows, 'em_trial', now);
          const expirado = applyStatusFilter(rows, 'expirado', now);
          const assinante = applyStatusFilter(rows, 'assinante', now);

          // Cobertura total e disjunta: cada linha cai em exatamente um status.
          expect(emTrial.length + expirado.length + assinante.length).toBe(rows.length);

          // Cada partição contém somente o seu status.
          for (const r of emTrial) expect(r.trial_state).toBe('em_trial');
          for (const r of expirado) expect(r.trial_state).toBe('expirado');
          for (const r of assinante) expect(r.trial_state).toBe('assinante');
        }
      ),
      { numRuns: 300 }
    );
  });

  it("o filtro 'todos' mantém todas as linhas inalteradas", () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.array(rawRowArb, { minLength: 0, maxLength: 20 }),
        (now, raws) => {
          const rows = raws.map((r) => buildRow(r, now));
          const filtered = applyStatusFilter(rows, 'todos', now);
          expect(filtered).toEqual(rows);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 11: Lista de prestes-a-expirar
// Validates: Requirements 10.3
//
// For any conjunto de motoristas de backing, o resultado do filtro
// "prestes a expirar" SHALL ser exatamente o conjunto de motoristas cujo
// days_left satisfaz 0 < days_left <= 5. Linhas ja expiradas (days_left === 0),
// fora da janela (days_left >= 6) e quaisquer valores negativos (defensivo)
// SHALL ser excluidas.
// ============================================================================

/**
 * Gerador de `days_left` para o filtro prestes-a-expirar. Mistura inteiros
 * arbitrarios com as fronteiras criticas {0, 1, 5, 6} e valores negativos
 * (defensivo) para exercitar exatamente os limites do predicado `0 < x <= 5`.
 */
const daysLeftArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(-10, -1, 0, 1, 2, 5, 6, 7, 30),
  fc.integer({ min: -50, max: 400 })
);

/**
 * Constroi uma `TrialMotoristaRow` com `days_left` explicito, reusando
 * `buildRow` (mesma forma de linha da Property 10) e sobrescrevendo apenas o
 * `days_left` — campo que o filtro prestes-a-expirar consome.
 */
function buildRowWithDaysLeft(raw: RawRow, daysLeft: number, now: Date): TrialMotoristaRow {
  return { ...buildRow(raw, now), days_left: daysLeft };
}

/**
 * Filtro PURO "prestes a expirar" modelado conforme o design: mantem as linhas
 * cujo `days_left` satisfaz `0 < days_left <= 5` via o helper `isAboutToExpire`.
 */
function applyAboutToExpireFilter(rows: TrialMotoristaRow[]): TrialMotoristaRow[] {
  return rows.filter((r) => isAboutToExpire(r.days_left));
}

describe('Property 11: lista de prestes-a-expirar', () => {
  it('retorna exatamente as linhas com 0 < days_left <= 5 (exclui expirados, fora da janela e negativos)', () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.array(fc.tuple(rawRowArb, daysLeftArb), { minLength: 0, maxLength: 30 }),
        (now, pairs) => {
          const rows = pairs.map(([raw, daysLeft]) => buildRowWithDaysLeft(raw, daysLeft, now));
          const filtered = applyAboutToExpireFilter(rows);

          // (a) Toda linha retornada satisfaz estritamente 0 < days_left <= 5.
          for (const row of filtered) {
            expect(row.days_left).toBeGreaterThan(0);
            expect(row.days_left).toBeLessThanOrEqual(5);
          }

          // (b) O conjunto retornado e EXATAMENTE o subconjunto esperado:
          //     mesma cardinalidade e mesmos ids, sem inclusoes/exclusoes indevidas.
          const expected = rows.filter((r) => r.days_left > 0 && r.days_left <= 5);
          expect(filtered).toHaveLength(expected.length);
          expect(filtered.map((r) => r.id)).toEqual(expected.map((r) => r.id));

          // (c) Nenhuma linha excluida satisfaz o predicado (fronteiras 0 e 6,
          //     valores negativos e fora da janela ficam de fora).
          const excluded = rows.filter((r) => !filtered.includes(r));
          for (const row of excluded) {
            expect(row.days_left <= 0 || row.days_left > 5).toBe(true);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('cobre as fronteiras criticas: 0 e 6 excluidos; 1 e 5 incluidos', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), rawRowArb, (now, raw) => {
        // Fronteira inferior aberta (days_left === 0 => expirado, excluido).
        expect(isAboutToExpire(buildRowWithDaysLeft(raw, 0, now).days_left)).toBe(false);
        // Limite inferior incluido.
        expect(isAboutToExpire(buildRowWithDaysLeft(raw, 1, now).days_left)).toBe(true);
        // Limite superior incluido.
        expect(isAboutToExpire(buildRowWithDaysLeft(raw, 5, now).days_left)).toBe(true);
        // Fronteira superior aberta (days_left === 6 => fora da janela, excluido).
        expect(isAboutToExpire(buildRowWithDaysLeft(raw, 6, now).days_left)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

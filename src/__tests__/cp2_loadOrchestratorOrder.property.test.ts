/**
 * Property-Based Test — Startup Performance Optimization, Property 4:
 * Invariante da ordem de carregamento.
 *
 * Feature: startup-performance-optimization
 * Property 4: Invariante da ordem de carregamento.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 13.4
 *
 * Invariante: para QUALQUER conjunto de estágios já iniciados, a função de
 * orquestração `nextStartableStages` nunca libera um estágio cujo predecessor
 * obrigatório não foi iniciado:
 *  - `primary` nunca é liberado sem `auth`;
 *  - `secondary` nunca é liberado sem `shell`;
 *  - `shell` nunca é liberado sem `auth`.
 * Exceção de degradação (Req 3.4): quando `auth` e `shell` já iniciaram e
 * `primary` NÃO iniciou, `secondary` ainda É liberável.
 * Além disso, estágios já iniciados nunca são re-liberados.
 *
 * Convenções fast-check do projeto: domínio fechado de estágios via
 * `fc.constantFrom`/`fc.subarray`; nunca `fc.stringOf`.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { nextStartableStages, type LoadStage } from '../services/loadOrchestrator';

const ALL_STAGES: readonly LoadStage[] = ['auth', 'shell', 'primary', 'secondary'];

/** Gera um subconjunto arbitrário dos estágios já iniciados. */
const startedArb: fc.Arbitrary<Set<LoadStage>> = fc
  .subarray([...ALL_STAGES])
  .map((arr) => new Set<LoadStage>(arr));

describe('Property 4: Invariante da ordem de carregamento (loadOrchestrator)', () => {
  it('nunca libera um estágio cujo predecessor obrigatório não foi iniciado', () => {
    fc.assert(
      fc.property(startedArb, (started) => {
        const next = nextStartableStages(started);

        for (const stage of next) {
          // Predecessores obrigatórios da invariante de ordem.
          if (stage === 'shell') {
            // shell nunca sem auth.
            expect(started.has('auth')).toBe(true);
          }
          if (stage === 'primary') {
            // primary nunca sem auth (e sem shell).
            expect(started.has('auth')).toBe(true);
          }
          if (stage === 'secondary') {
            // secondary nunca sem shell.
            expect(started.has('shell')).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('nunca re-libera um estágio já iniciado', () => {
    fc.assert(
      fc.property(startedArb, (started) => {
        const next = nextStartableStages(started);
        for (const stage of next) {
          expect(started.has(stage)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('exceção de degradação 3.4: auth+shell iniciados sem primary ⇒ secondary é liberável', () => {
    fc.assert(
      fc.property(
        // started garantidamente contém auth e shell, mas NÃO primary.
        // secondary pode ou não já ter iniciado.
        fc.boolean(),
        (secondaryStarted) => {
          const started = new Set<LoadStage>(['auth', 'shell']);
          if (secondaryStarted) started.add('secondary');

          const next = nextStartableStages(started);

          if (secondaryStarted) {
            // Já iniciado: não pode ser re-liberado.
            expect(next).not.toContain('secondary');
          } else {
            // Degradação: secondary continua liberável mesmo sem primary.
            expect(next).toContain('secondary');
            expect(started.has('primary')).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

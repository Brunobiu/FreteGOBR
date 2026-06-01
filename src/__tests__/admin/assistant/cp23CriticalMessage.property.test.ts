// Feature: admin-assistant, Property 23: mensagem automática descreve o quê/onde/sugestão
/**
 * CP-23 — Mensagem automática de Critical_Event (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 23
 *   - requirements.md §Padrões de Sucesso (CP-23) e Requirement 12.4
 *
 * Função sob teste:
 *   buildCriticalMessage(event)  (src/services/admin/assistant.ts)
 *
 * Invariantes verificadas para QUALQUER `DetectedEvent` arbitrário:
 *
 *   1. Pureza: a função não lança e produz uma string não vazia (sem invariante
 *      de I/O — chamada repetida com o mesmo input retorna o mesmo output).
 *   2. Estrutura "o quê / onde / sugestão" sempre presente:
 *        - inclui o `summary` do evento (ou um fallback determinístico quando
 *          `summary` vem vazio/branco);
 *        - inclui o `scope` (ou `global` quando o scope vem vazio/branco);
 *        - inclui um texto de SUGESTÃO (orientação, NUNCA aplicação automática
 *          de correção — Req 12.4).
 *   3. Sem remediação: a saída não menciona auto-execução nem aplicação direta
 *      de correção (palavras como "executando" / "aplicando correção" /
 *      "remediando automaticamente"). É descritiva, não imperativa.
 *
 * Convenções de PBT do projeto:
 *   - Domínio fechado de tipos via `fc.constantFrom(...)` para `CriticalEventType`
 *     e `Severity`. Sem `fc.stringOf` (gerador inexistente no projeto).
 *   - `summary`/`scope` cobertos com strings unicode + casos limites (vazio,
 *     só espaços) para exercitar os fallbacks.
 *
 * Lógica determinística (sem Supabase, sem Vault, sem rede). Ambiente jsdom.
 *
 * Validates: Requirements 12.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  buildCriticalMessage,
  type CriticalEventType,
  type DetectedEvent,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores (domínios fechados) -----

const eventTypeArb = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityArb = fc.constantFrom<Severity>('info', 'warning', 'critical');

/**
 * Texto arbitrário com casos limite cobertos:
 *  - string vazia (exercita fallback);
 *  - só espaços (exercita fallback via trim);
 *  - string unicode normal.
 */
const flexibleTextArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1, maxLength: 80 })
);

const detectedEventArb: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeArb,
  severity: severityArb,
  summary: flexibleTextArb,
  scope: flexibleTextArb,
});

/** Tokens que indicariam REMEDIAÇÃO automática (proibidos pela Req 12.4). */
const REMEDIATION_FORBIDDEN_TOKENS: readonly string[] = [
  'executando correcao',
  'executando correção',
  'aplicando correcao',
  'aplicando correção',
  'remediando automaticamente',
  'auto-remediando',
  'corrigindo automaticamente',
];

describe('CP-23: buildCriticalMessage — descreve o quê/onde/sugestão (Req 12.4)', () => {
  it('determinismo + estrutura completa para qualquer DetectedEvent', () => {
    fc.assert(
      fc.property(detectedEventArb, (event) => {
        const out1 = buildCriticalMessage(event);
        const out2 = buildCriticalMessage(event);

        // (1) Determinismo + função total: nunca lança, nunca string vazia.
        expect(typeof out1).toBe('string');
        expect(out1.length).toBeGreaterThan(0);
        expect(out2).toBe(out1);

        // (2.a) "Onde": scope efetivo (o do evento, ou 'global' como fallback).
        const expectedScope = event.scope && event.scope.trim().length > 0 ? event.scope : 'global';
        expect(out1).toContain(expectedScope);

        // (2.b) "O que": resumo efetivo (summary do evento ou fallback contendo
        // o expected scope; em todo caso o scope efetivo já está presente).
        if (event.summary && event.summary.trim().length > 0) {
          expect(out1).toContain(event.summary);
        }

        // (2.c) "Sugestão": existe um texto de orientação (rótulo "Sugestao:" e
        // pelo menos um caractere depois). A função usa o cabeçalho "Sugestao:"
        // (sem acento) — verificamos a presença literal do prefixo seguido por
        // um valor não vazio.
        expect(out1).toMatch(/Sugestao:\s+\S/);
      }),
      { numRuns: 100 }
    );
  });

  it('nunca contém termos de remediação automática (Req 12.4)', () => {
    fc.assert(
      fc.property(detectedEventArb, (event) => {
        const out = buildCriticalMessage(event).toLowerCase();
        for (const forbidden of REMEDIATION_FORBIDDEN_TOKENS) {
          expect(out).not.toContain(forbidden);
        }
      }),
      { numRuns: 100 }
    );
  });
});

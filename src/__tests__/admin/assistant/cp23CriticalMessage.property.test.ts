// Feature: admin-assistant, Property 23
/**
 * CP-23: Mensagem automatica de Critical_Event descreve o que/onde/sugestao
 * sem remediar
 *
 * Para todo DetectedEvent, buildCriticalMessage(event) produz um texto que
 * inclui (a) a descricao do que aconteceu (resumo ou categoria), (b) onde
 * ocorreu (`scope`, ou `global` quando em branco) e (c) uma sugestao de
 * correcao. A funcao e PURA: invoca-la duas vezes produz a mesma string e
 * nao realiza nenhuma remediacao nem efeito colateral.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 12.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  buildCriticalMessage,
  type DetectedEvent,
  type CriticalEventType,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores -----

const eventTypeGen = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityGen = fc.constantFrom<Severity>('info', 'warning', 'critical');

// Resumo/escopo as vezes em branco para exercitar os fallbacks deterministicos
// (escopo em branco => `global`; resumo em branco => derivado de categoria).
const maybeBlankGen = fc.oneof(
  fc.string({ minLength: 0, maxLength: 40 }),
  fc.constantFrom('', '   ', '\t')
);

const detectedEventGen: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeGen,
  severity: severityGen,
  summary: maybeBlankGen,
  scope: maybeBlankGen,
});

function expectedScope(scope: string): string {
  return scope && scope.trim().length > 0 ? scope : 'global';
}

describe('CP-23: Mensagem automatica descreve o que/onde/sugestao', () => {
  it('inclui o que aconteceu, o escopo e uma sugestao de correcao', () => {
    fc.assert(
      fc.property(detectedEventGen, (event) => {
        const message = buildCriticalMessage(event);

        // (a) O que aconteceu: marcador de descricao presente.
        expect(message).toContain('O que aconteceu:');

        // (b) Onde ocorreu: contem o scope (ou `global` quando em branco).
        const scope = expectedScope(event.scope);
        expect(message).toContain('Onde:');
        expect(message).toContain(scope);

        // (c) Sugestao de correcao: marcador de sugestao presente.
        expect(message).toContain('Sugestao:');
      }),
      { numRuns: 100 }
    );
  });

  it('e pura: duas invocacoes produzem string identica (sem remediacao/efeitos)', () => {
    fc.assert(
      fc.property(detectedEventGen, (event) => {
        const snapshot = { ...event };

        const first = buildCriticalMessage(event);
        const second = buildCriticalMessage(event);

        // Determinismo / pureza: mesma saida.
        expect(second).toBe(first);

        // Nao muta o evento de entrada (no-op sobre o argumento).
        expect(event).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: whatsapp-automation, Property 13: At most one WhatsApp_Session per instance, reused across operations (never a second session)
/**
 * Property-Based Test — WhatsApp Automation, Property 13:
 * No máximo uma sessão por instância (UNIQUE(instance_id)).
 *
 * Validates: Requirements 4.2
 *
 * Invariante verificada (≥100 runs) sobre o modelo de servidor em memória
 * (`_model/store.ts`), que espelha o UNIQUE(instance_id) da tabela
 * `whatsapp_sessions` e as RPCs `whatsapp_get_session`/`whatsapp_set_session_status`:
 *
 *   Para QUALQUER sequência de operações connect/disconnect sobre uma instância,
 *   existe NO MÁXIMO uma `WhatsApp_Session` associada àquele `instance_id`. A
 *   linha é REUSADA a cada operação (apenas o status/`lastConnectedAt` muda) —
 *   nunca é criada uma segunda sessão (Req 4.1, 4.2).
 *
 * Como é exercitado:
 *   - Um schedule arbitrário de operações (`connect` com status variados,
 *     `disconnect`, `getSession`) é aplicado repetidamente a uma instância.
 *   - Em todo instante: a partição da instância contém exatamente 0 ou 1 sessão
 *     (`countSessions <= 1`), e `getSession` é coerente com esse estado.
 *   - Uma vez existente, a sessão NUNCA volta a inexistir (a linha persiste): a
 *     mesma `instanceId` é mantida e nenhuma operação recria uma sessão "limpa".
 *   - Reuso comprovado pela continuidade de `lastConnectedAt`: um `CONNECTED`
 *     grava o relógio; operações subsequentes que NÃO são `CONNECTED`
 *     (reconectar em QR_PENDING/CONNECTING/EXPIRED ou desconectar) PRESERVAM o
 *     `lastConnectedAt` anterior — sinal de que a linha foi atualizada, não
 *     substituída por uma nova.
 *
 * Convenções do projeto (project-conventions / testing-governance):
 *   - Ids derivados de inteiros estáveis; status via `fc.constantFrom`.
 *   - NUNCA `fc.stringOf`. Reducers do modelo são PUROS — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  createInitialState,
  createInstance,
  connectSession,
  disconnectSession,
  getSession,
  getInstance,
  type ModelState,
  type SessionStatus,
} from './_model/store';

/** Id de instância estável, derivado de um inteiro (nunca dígitos aleatórios). */
const instanceIdArb = fc.integer({ min: 0, max: 50 }).map((n) => `wa-inst-${n}`);

/** Status alvo do connect (todo o domínio de `session_status`). */
const sessionStatusArb = fc.constantFrom<SessionStatus>(
  'DISCONNECTED',
  'CONNECTING',
  'QR_PENDING',
  'CONNECTED',
  'EXPIRED'
);

/** Uma operação escopada à sessão única da instância. */
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('connect' as const), status: sessionStatusArb }),
  fc.record({ kind: fc.constant('disconnect' as const) }),
  fc.record({ kind: fc.constant('get' as const) })
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 30 });

/** Conta as sessões da partição de uma instância (campo único ⇒ 0 ou 1). */
function countSessions(state: ModelState, instanceId: string): number {
  const inst = getInstance(state, instanceId);
  return inst?.session ? 1 : 0;
}

describe('WhatsApp Automation — Property 13: no máximo uma sessão por instância', () => {
  it('connect/disconnect arbitrários reusam a única sessão; nunca surge uma segunda (Req 4.2)', () => {
    fc.assert(
      fc.property(instanceIdArb, opsArb, (instanceId, ops) => {
        let state: ModelState = createInstance(createInitialState(), { instanceId });

        // Antes de qualquer operação: nenhuma sessão (linha criada sob demanda).
        expect(countSessions(state, instanceId)).toBe(0);
        expect(getSession(state, instanceId)).toBeNull();

        // Modelo de referência: o `lastConnectedAt` esperado da linha reusada.
        let sessionExists = false;
        let expectedLastConnectedAt: number | null = null;

        ops.forEach((op, step) => {
          const now = step + 1; // relógio virtual determinístico e crescente

          if (op.kind === 'connect') {
            state = connectSession(state, instanceId, op.status, now);
            sessionExists = true;
            // Só um CONNECTED atualiza o relógio; os demais preservam o valor.
            if (op.status === 'CONNECTED') {
              expectedLastConnectedAt = now;
            }
          } else if (op.kind === 'disconnect') {
            state = disconnectSession(state, instanceId);
            // disconnect cria a linha (DISCONNECTED) se ainda não existia,
            // preservando `lastConnectedAt` quando já havia sessão.
            sessionExists = true;
          }
          // `get` é leitura pura — não muta o estado.

          const session = getSession(state, instanceId);

          // (1) Invariante central (P13): nunca mais de uma sessão.
          expect(countSessions(state, instanceId)).toBeLessThanOrEqual(1);

          // (2) Coerência leitura ↔ estado e, uma vez criada, a linha persiste.
          if (sessionExists) {
            expect(countSessions(state, instanceId)).toBe(1);
            expect(session).not.toBeNull();
            // (3) A sessão pertence EXCLUSIVAMENTE a esta instância.
            expect(session?.instanceId).toBe(instanceId);
            // (4) Reuso: `lastConnectedAt` segue o modelo de referência — a linha
            // foi atualizada in-place, não substituída por uma sessão "limpa".
            expect(session?.lastConnectedAt ?? null).toBe(expectedLastConnectedAt);
          } else {
            expect(session).toBeNull();
          }
        });

        // Estado final: ainda no máximo uma sessão.
        expect(countSessions(state, instanceId)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  it('reconectar repetidamente com status variados nunca cria uma segunda sessão (Req 4.1, 4.2)', () => {
    fc.assert(
      fc.property(
        instanceIdArb,
        fc.array(sessionStatusArb, { minLength: 1, maxLength: 20 }),
        (instanceId, statuses) => {
          let state: ModelState = createInstance(createInitialState(), { instanceId });

          statuses.forEach((status, i) => {
            state = connectSession(state, instanceId, status, i + 1);
            // A cada reconexão a contagem permanece exatamente 1 (linha reusada).
            expect(countSessions(state, instanceId)).toBe(1);
            const session = getSession(state, instanceId);
            expect(session?.instanceId).toBe(instanceId);
            expect(session?.status).toBe(status);
          });

          // Uma desconexão final continua operando sobre a MESMA linha única.
          state = disconnectSession(state, instanceId);
          expect(countSessions(state, instanceId)).toBe(1);
          expect(getSession(state, instanceId)?.status).toBe('DISCONNECTED');
        }
      ),
      { numRuns: 100 }
    );
  });
});

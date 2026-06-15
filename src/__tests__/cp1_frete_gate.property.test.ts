/**
 * Property-Based Test — chat-frete-conversa, Properties 1-4.
 *
 * Alvo: camada pura `src/services/freteGate.ts`
 * (`freteStatusToGate`, `effectiveStatus`, `isInputBlocked`, `gateToBadge`).
 *
 * Toda a lógica de gating do chat (badge, bloqueio de input, drag-and-drop,
 * áudio) deriva exclusivamente dessas funções, então verificá-las cobre o
 * núcleo das Req 2, 3, 4, 6 e 7.
 *
 * Convenções fast-check do projeto: domínios fechados via `fc.constantFrom`,
 * nunca `fc.stringOf`. Mínimo de 100 iterações por property.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  freteStatusToGate,
  effectiveStatus,
  isInputBlocked,
  gateToBadge,
} from '../services/freteGate';
import type { FreteStatus, FreteSource } from '../services/fretes';
import type { FreteGate } from '../services/freteGate';

// Geradores de domínio fechado (NUNCA fc.stringOf).
const freteStatusArb = fc.constantFrom<FreteStatus>('ativo', 'encerrado', 'cancelado');
const freteGateArb = fc.constantFrom<FreteGate>('active', 'blocked', 'unknown');
const freteSourceArb = fc.constantFrom<FreteSource>('embarcador', 'comunidade');

describe('chat-frete-conversa — camada pura freteGate', () => {
  // Feature: chat-frete-conversa, Property 1: Mapeamento completo de status → gate → badge
  // Validates: Requirements 2.2, 2.3, 3.2, 3.3, 7.2
  it('Property 1: status → gate → badge é completo e determinístico', () => {
    fc.assert(
      fc.property(freteStatusArb, (status) => {
        const gate = freteStatusToGate(status);

        // 'active' se e somente se status === 'ativo'; senão 'blocked'.
        if (status === 'ativo') {
          expect(gate).toBe('active');
        } else {
          // 'encerrado' | 'cancelado' → 'blocked'
          expect(gate).toBe('blocked');
        }
        expect(gate === 'active').toBe(status === 'ativo');

        // Badge correspondente: verde "Ativo" / vermelho "Desativado".
        const badge = gateToBadge(gate);
        if (gate === 'active') {
          expect(badge).not.toBeNull();
          expect(badge!.label).toBe('Ativo');
          expect(badge!.className).toContain('green');
        } else {
          expect(badge).not.toBeNull();
          expect(badge!.label).toBe('Desativado');
          expect(badge!.className).toContain('red');
        }

        // Determinismo: re-resolver (ex.: realtime update) dá o mesmo resultado.
        expect(freteStatusToGate(status)).toBe(gate);
        expect(gateToBadge(gate)).toEqual(badge);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: chat-frete-conversa, Property 2: Status_Indisponivel nunca bloqueia e omite o badge
  // Validates: Requirements 2.5, 3.4, 6.2
  it('Property 2: entrada indisponível (null ou comunidade) → unknown, sem badge, input habilitado', () => {
    // Gera entradas indisponíveis: info === null OU source === 'comunidade'.
    const unavailableArb = fc.oneof(
      fc.constant(null),
      fc.record({ status: freteStatusArb, source: fc.constant<FreteSource>('comunidade') })
    );

    fc.assert(
      fc.property(unavailableArb, (info) => {
        const status = effectiveStatus(info);
        expect(status).toBeNull();

        const gate = freteStatusToGate(status);
        expect(gate).toBe('unknown');

        expect(gateToBadge('unknown')).toBeNull();
        expect(isInputBlocked('unknown')).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: chat-frete-conversa, Property 3: Bloqueio do input se e somente se gate é 'blocked'
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.3
  it('Property 3: isInputBlocked(gate) === true se e somente se gate === "blocked"', () => {
    fc.assert(
      fc.property(freteGateArb, (gate) => {
        expect(isInputBlocked(gate)).toBe(gate === 'blocked');

        // 'active' e 'unknown' mantêm o input habilitado.
        if (gate === 'active' || gate === 'unknown') {
          expect(isInputBlocked(gate)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: chat-frete-conversa, Property 4: Independência do papel do usuário
  // Validates: Requirements 2.4, 4.7
  it('Property 4: gate/badge/blocked dependem só do status — sem parâmetro de papel', () => {
    fc.assert(
      fc.property(freteStatusArb, freteSourceArb, (status, source) => {
        // Os mapeadores não recebem papel (motorista/embarcador). O resultado é
        // determinado unicamente pelo status efetivo, idêntico para ambos os
        // lados da mesma conversa. Modelamos isso por determinismo puro:
        // duas resoluções independentes do mesmo status produzem o mesmo gate.
        const effStatus = effectiveStatus({ status, source });
        const gateA = freteStatusToGate(effStatus);
        const gateB = freteStatusToGate(effStatus);
        expect(gateA).toBe(gateB);

        expect(gateToBadge(gateA)).toEqual(gateToBadge(gateB));
        expect(isInputBlocked(gateA)).toBe(isInputBlocked(gateB));

        // As funções têm aridade fixa (sem argumento de papel).
        expect(freteStatusToGate.length).toBe(1);
        expect(isInputBlocked.length).toBe(1);
        expect(gateToBadge.length).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});

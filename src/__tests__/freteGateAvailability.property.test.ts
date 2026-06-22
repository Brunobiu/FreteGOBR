/**
 * Property + unit tests de `availabilityToGate` (freteGate).
 *
 * Garante o contrato que faz o bloqueio refletir nos DOIS lados da conversa:
 *  - sem estado / não vinculado          → 'unknown' (não bloqueia, fail-safe)
 *  - vinculado e disponível               → 'active'
 *  - vinculado e indisponível             → 'blocked'
 *
 * Mantém a invariante existente: 'blocked' é o ÚNICO gate que bloqueia o input.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { availabilityToGate, isInputBlocked, gateToBadge } from '../services/freteGate';

describe('availabilityToGate', () => {
  it('null ou não vinculado → unknown (nunca bloqueia)', () => {
    expect(availabilityToGate(null)).toBe('unknown');
    fc.assert(
      fc.property(fc.boolean(), (available) => {
        expect(availabilityToGate({ linked: false, available })).toBe('unknown');
      })
    );
  });

  it('vinculado: available alterna entre active e blocked', () => {
    fc.assert(
      fc.property(fc.boolean(), (available) => {
        const gate = availabilityToGate({ linked: true, available });
        expect(gate).toBe(available ? 'active' : 'blocked');
        // só 'blocked' bloqueia o input
        expect(isInputBlocked(gate)).toBe(!available);
      })
    );
  });

  it('frete indisponível mostra badge vermelho "Indisponível"', () => {
    const badge = gateToBadge(availabilityToGate({ linked: true, available: false }));
    expect(badge?.label).toBe('Indisponível');
    expect(isInputBlocked(availabilityToGate({ linked: true, available: false }))).toBe(true);
  });
});

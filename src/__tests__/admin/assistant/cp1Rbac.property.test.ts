// Feature: admin-assistant, Property 1
/**
 * CP-1: Owner_Only_Gate — ASSISTANT_VIEW/EDIT exclusivas de SUPER_ADMIN
 *
 * Para todo AdminRole do dominio e toda acao em {ASSISTANT_VIEW, ASSISTANT_EDIT},
 * hasPermission(role, action) retorna verdadeiro SE E SOMENTE SE role === 'SUPER_ADMIN'.
 *
 * permissions.ts e logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 1.4, 1.5, 2.1, 2.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  hasPermission,
  ADMIN_ACTIONS,
  type AdminRole,
  type AdminAction,
} from '../../../services/admin/permissions';

// ----- Geradores -----

// Dominio fechado de AdminRole (todos os papeis).
const roleGen = fc.constantFrom<AdminRole>(
  'SUPER_ADMIN',
  'ADMIN',
  'SUPORTE',
  'FINANCEIRO',
  'MODERADOR'
);

// Acoes do modulo Assistente.
const assistantActionGen = fc.constantFrom<AdminAction>('ASSISTANT_VIEW', 'ASSISTANT_EDIT');

describe('CP-1: Owner_Only_Gate (ASSISTANT_VIEW/ASSISTANT_EDIT)', () => {
  it('concede ASSISTANT_VIEW/EDIT sse o papel e SUPER_ADMIN', () => {
    fc.assert(
      fc.property(roleGen, assistantActionGen, (role, action) => {
        const granted = hasPermission(role, action);
        // Bicondicional: verdadeiro exatamente quando SUPER_ADMIN.
        expect(granted).toBe(role === 'SUPER_ADMIN');
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: admin-assistant, Property 2
/**
 * CP-2: Deny-by-default fora do dominio de acoes
 *
 * Para todo AdminRole e toda string que NAO pertence a ADMIN_ACTIONS,
 * hasPermission(role, str) retorna falso. Garante o comportamento
 * deny-by-default: qualquer acao desconhecida e negada para todos os papeis,
 * inclusive SUPER_ADMIN (cujo ramo allow-all so se aplica a acoes do enum).
 *
 * Validates: Requirements 2.5
 */

// Conjunto canonico das acoes conhecidas, para excluir do gerador de strings.
const KNOWN_ACTIONS: ReadonlySet<string> = new Set<string>(ADMIN_ACTIONS);

// Gera strings arbitrarias que NAO pertencem a ADMIN_ACTIONS. O filtro
// descarta qualquer colisao acidental com uma acao conhecida.
const unknownActionGen = fc
  .string({ minLength: 0, maxLength: 40 })
  .filter((s) => !KNOWN_ACTIONS.has(s));

describe('CP-2: Deny-by-default (acao fora de ADMIN_ACTIONS)', () => {
  it('nega qualquer string fora de ADMIN_ACTIONS para todo papel', () => {
    fc.assert(
      fc.property(roleGen, unknownActionGen, (role, action) => {
        expect(hasPermission(role, action)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

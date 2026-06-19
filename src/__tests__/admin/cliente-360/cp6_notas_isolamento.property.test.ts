// Feature: admin-cliente-360, Property 6: Observacoes internas nunca expostas a nao-admin.
//
// Toda leitura de admin_user_notes por anon / cliente dono / outro cliente /
// admin sem USER_NOTE_VIEW resulta em ZERO linhas (modelo da RLS). Nenhuma
// Internal_Note aparece em superficie acessivel ao Cliente.
//
// Validates: Requirements 13.5, 13.8, 15.5

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { hasPermissionForRoles, type AdminRole } from '../../../services/admin/permissions';
import type { InternalNote } from '../../../services/admin/cliente360';
import { safeText, uuidLike } from '../../_helpers/generators';

/**
 * Modela a policy admin_user_notes_select: linhas visiveis SSE o caller tem
 * USER_NOTE_VIEW (is_admin_with_permission). Qualquer outro => zero linhas.
 */
function simulateNotesRls(callerRoles: AdminRole[], notes: InternalNote[]): InternalNote[] {
  return hasPermissionForRoles(callerRoles, 'USER_NOTE_VIEW') ? notes : [];
}

const ALL_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];

const noteArb: fc.Arbitrary<InternalNote> = fc.record({
  id: uuidLike(),
  body: safeText(1, 200),
  author_id: fc.option(uuidLike(), { nil: null }),
  author_name: fc.option(safeText(1, 20), { nil: null }),
  created_at: fc.constant('2024-01-01T00:00:00Z'),
  updated_at: fc.constant('2024-01-01T00:00:00Z'),
});

describe('CP-6 notas: nunca expostas a nao-admin', () => {
  it('callers sem USER_NOTE_VIEW => zero linhas', () => {
    fc.assert(
      fc.property(
        fc.array(noteArb, { maxLength: 8 }),
        fc.subarray(ALL_ROLES),
        (notes, callerRoles) => {
          const visible = simulateNotesRls(callerRoles, notes);
          const canView = callerRoles.includes('SUPER_ADMIN') || callerRoles.includes('ADMIN');
          if (canView) {
            expect(visible).toEqual(notes);
          } else {
            expect(visible).toEqual([]);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('callers canonicos nao-admin => vazio', () => {
    const notes: InternalNote[] = [
      { id: 'n1', body: 'segredo interno', author_id: null, author_name: null, created_at: 'x', updated_at: 'x' },
    ];
    // anon / cliente dono / outro cliente => sem papeis admin
    expect(simulateNotesRls([], notes)).toEqual([]);
    // admin sem USER_NOTE_VIEW (papeis de allowlist fechada)
    expect(simulateNotesRls(['SUPORTE'], notes)).toEqual([]);
    expect(simulateNotesRls(['FINANCEIRO'], notes)).toEqual([]);
    expect(simulateNotesRls(['MODERADOR'], notes)).toEqual([]);
    // admin com USER_NOTE_VIEW => le
    expect(simulateNotesRls(['ADMIN'], notes)).toEqual(notes);
  });
});

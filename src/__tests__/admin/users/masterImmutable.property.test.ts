/**
 * CP-1: Master_Admin e imutavel (camada service)
 *
 * Para toda mutacao destrutiva aplicada ao Master_Admin (admin_username = 'Nexus_Vortex99'),
 * o service rejeita com MASTER_ADMIN_IMMUTABLE antes de tocar o banco.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock do cliente Supabase
const writeSpy = vi.fn();
const masterId = '11111111-1111-1111-1111-111111111111';
const masterRow = {
  id: masterId,
  user_type: 'admin',
  name: 'Bruno Henrique',
  phone: 'admin:nexus_vortex99',
  email: 'nexus_vortex99@admin.fretego.local',
  cpf: null,
  is_active: true,
  ban_reason: null,
  banned_at: null,
  banned_by: null,
  profile_photo_url: null,
  admin_username: 'Nexus_Vortex99',
  created_at: '2025-01-01T00:00:00Z',
  last_activity_at: null,
  updated_at: '2025-01-01T00:00:00Z',
  embarcadores: null,
};

vi.mock('../../../services/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'caller-id-not-master' } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: masterRow }),
          select: vi.fn().mockReturnThis(),
        }),
        in: vi.fn().mockResolvedValue({ data: [masterRow] }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      }),
      update: vi.fn(() => {
        writeSpy('update');
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      delete: vi.fn(() => {
        writeSpy('delete');
        return { eq: vi.fn() };
      }),
      insert: vi.fn(() => {
        writeSpy('insert');
        return { select: vi.fn() };
      }),
    })),
    rpc: vi.fn((fn: string) => {
      writeSpy(`rpc:${fn}`);
      return Promise.resolve({ data: null, error: { message: 'should not reach' } });
    }),
  },
}));

vi.mock('../../../services/admin/audit', () => ({
  executeAdminMutation: vi.fn(async (_input, fn) => fn()),
  logAdminAction: vi.fn().mockResolvedValue(null),
}));

import {
  toggleActive,
  banUser,
  unbanUser,
  deleteUser,
  forceLogout,
  requestPasswordReset,
  editUser,
  UsersServiceError,
} from '../../../services/admin/users';

describe('CP-1: Master_Admin e imutavel (service-level)', () => {
  beforeEach(() => {
    writeSpy.mockClear();
  });

  it('rejeita toda mutacao destrutiva ao Master antes de chamar o banco', async () => {
    const actions: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [
      {
        name: 'toggleActive',
        run: () => toggleActive(masterId, false, '2025-01-01T00:00:00Z'),
      },
      {
        name: 'banUser',
        run: () => banUser(masterId, 'tentativa', '2025-01-01T00:00:00Z'),
      },
      {
        name: 'unbanUser',
        run: () => unbanUser(masterId, '2025-01-01T00:00:00Z'),
      },
      {
        name: 'editUser',
        run: () =>
          editUser(
            masterId,
            { name: 'Hack', email: null, phone: '+5511999999999' },
            '2025-01-01T00:00:00Z'
          ),
      },
      {
        name: 'deleteUser',
        run: () =>
          deleteUser(masterId, {
            confirmedName: 'Bruno Henrique',
            cancelActiveFretes: false,
          }),
      },
      {
        name: 'forceLogout',
        run: () => forceLogout(masterId),
      },
      {
        name: 'requestPasswordReset',
        run: () => requestPasswordReset(masterId),
      },
    ];

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: actions.length - 1 }), async (i) => {
        writeSpy.mockClear();
        const action = actions[i];
        let caught: unknown = null;
        try {
          await action.run();
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(UsersServiceError);
        expect((caught as UsersServiceError).code).toBe('MASTER_ADMIN_IMMUTABLE');
        // Nenhum write tocou o banco
        const writes = writeSpy.mock.calls.filter((c) => c[0] !== 'rpc:count_active_super_admins');
        expect(writes).toHaveLength(0);
      }),
      { numRuns: 50 }
    );
  });
});

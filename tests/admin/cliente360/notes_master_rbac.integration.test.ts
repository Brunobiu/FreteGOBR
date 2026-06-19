/**
 * Integração — Master_Admin imutável + grant de RBAC efetivo (migration 116). CP-8.
 *
 * Prova que:
 *   - admin_user_note_create com p_user_id = Master_Admin (admin_username
 *     'Nexus_Vortex99') é RECUSADO (master_admin_immutable), antes de escrever;
 *   - is_admin_with_permission('USER_NOTE_VIEW'/'USER_NOTE_EDIT') é verdadeiro
 *     SOMENTE para SUPER_ADMIN e ADMIN; falso para SUPORTE/FINANCEIRO/MODERADOR.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 13.2, 13.3, 14.9
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asService,
  asUser,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';
import type { AdminRole } from '../../../src/services/admin/permissions';

const HOOK_TIMEOUT = 30_000;
const MASTER_USERNAME = 'Nexus_Vortex99';

function uuid(): string {
  // UUID v4 simples para id de teste (não precisa de auth).
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

describeIntegration('Integração 116 — Master imutável + grant RBAC (CP-8)', () => {
  let admin: SeededUser;
  let masterId = '';
  let masterInserted = false;
  const roleUsers: Partial<Record<AdminRole, SeededUser>> = {};
  const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'c360-master-admin', userType: 'embarcador' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await seedAdminRole(svc, admin.id, 'ADMIN'); // USER_NOTE_EDIT

    // Reusa o Master existente se houver; senão cria um (sem trigger de proteção
    // de master nas migrations — a imutabilidade vive na camada RPC).
    const { data: existing } = await svc
      .from('users')
      .select('id')
      .eq('admin_username', MASTER_USERNAME)
      .maybeSingle();
    if (existing) {
      masterId = (existing as { id: string }).id;
    } else {
      masterId = uuid();
      await ensureUserRow(svc, {
        id: masterId,
        userType: 'admin',
        name: 'Master Teste',
        adminUsername: MASTER_USERNAME,
      });
      masterInserted = true;
    }

    // Um usuário por papel para checar o grant efetivo.
    for (const role of ROLES) {
      const u = await seedUser({ tag: `c360-rbac-${role.toLowerCase()}`, userType: 'embarcador' });
      await ensureUserRow(svc, { id: u.id, userType: 'embarcador' });
      await seedAdminRole(svc, u.id, role);
      roleUsers[role] = u;
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (masterInserted && masterId) await cleanupUserRow(svc, masterId);
    if (admin) {
      await cleanupUserRow(svc, admin.id);
      await cleanupUser(admin.id);
    }
    for (const role of ROLES) {
      const u = roleUsers[role];
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('nota com alvo = Master_Admin é recusada (master_admin_immutable)', async () => {
    const { error } = await asUser(admin.accessToken).rpc('admin_user_note_create', {
      p_user_id: masterId,
      p_body: 'tentativa de nota no master',
    });
    expect(error).not.toBeNull();
    expect(`${error?.message ?? ''}`).toContain('master_admin_immutable');
  });

  it('USER_NOTE_VIEW/EDIT: verdadeiro só para SUPER_ADMIN e ADMIN', async () => {
    for (const role of ROLES) {
      const u = roleUsers[role];
      if (!u) throw new Error(`papel ${role} não semeado`);
      const expected = role === 'SUPER_ADMIN' || role === 'ADMIN';
      for (const action of ['USER_NOTE_VIEW', 'USER_NOTE_EDIT'] as const) {
        const { data, error } = await asUser(u.accessToken).rpc('is_admin_with_permission', {
          p_action: action,
        });
        expect(error).toBeNull();
        expect(Boolean(data), `${role}/${action}`).toBe(expected);
      }
    }
  });
});

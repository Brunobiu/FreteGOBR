/**
 * Integração — RLS de admin_user_notes (Cliente 360 / migration 116). CP-6.
 *
 * Semeia uma Internal_Note via service_role (contorna RLS) e prova que:
 *   - anon, o próprio Cliente alvo, outro Cliente e admin SEM USER_NOTE_VIEW
 *     (papel SUPORTE) recebem ZERO linhas, embora a nota exista;
 *   - admin COM USER_NOTE_VIEW (papel ADMIN) lê a nota;
 *   - nenhum role escreve direto em admin_user_notes (só via RPC SECURITY DEFINER).
 *
 * Infra_Dependent: roda só com branch Supabase efêmero (describeIntegration skip).
 *
 * Validates: Requirements 13.4, 13.5, 13.8, 15.5
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asService,
  asUser,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 116 — RLS de admin_user_notes (CP-6)', () => {
  let admin: SeededUser;
  let suporteAdmin: SeededUser;
  let target: SeededUser;
  let other: SeededUser;
  let noteId: string;

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'c360-notes-admin', userType: 'embarcador' });
    suporteAdmin = await seedUser({ tag: 'c360-notes-suporte', userType: 'embarcador' });
    target = await seedUser({ tag: 'c360-notes-target', userType: 'motorista' });
    other = await seedUser({ tag: 'c360-notes-other', userType: 'motorista' });

    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: suporteAdmin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: target.id, userType: 'motorista' });
    await ensureUserRow(svc, { id: other.id, userType: 'motorista' });

    await seedAdminRole(svc, admin.id, 'ADMIN'); // ADMIN => USER_NOTE_VIEW (allow-all)
    await seedAdminRole(svc, suporteAdmin.id, 'SUPORTE'); // SUPORTE => sem USER_NOTE_VIEW

    const { data: note, error } = await svc
      .from('admin_user_notes')
      .insert({ user_id: target.id, author_id: admin.id, body: 'observação interna secreta' })
      .select('id')
      .single();
    if (error || !note) throw new Error(`seed nota falhou: ${error?.message}`);
    noteId = (note as { id: string }).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (noteId) await svc.from('admin_user_notes').delete().eq('id', noteId);
    for (const u of [admin, suporteAdmin, target, other]) {
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('service_role enxerga a nota semeada (vazios depois são significativos)', async () => {
    const { data } = await asService().from('admin_user_notes').select('id').eq('id', noteId);
    expect((data ?? []).length).toBe(1);
  });

  it('anônimo não lê admin_user_notes', async () => {
    const { data } = await asAnon().from('admin_user_notes').select('id').eq('id', noteId);
    expect((data ?? []).length).toBe(0);
  });

  it('o próprio Cliente alvo não lê suas notas', async () => {
    const { data } = await asUser(target.accessToken)
      .from('admin_user_notes')
      .select('id')
      .eq('id', noteId);
    expect((data ?? []).length).toBe(0);
  });

  it('outro Cliente não lê', async () => {
    const { data } = await asUser(other.accessToken)
      .from('admin_user_notes')
      .select('id')
      .eq('id', noteId);
    expect((data ?? []).length).toBe(0);
  });

  it('admin SEM USER_NOTE_VIEW (SUPORTE) não lê', async () => {
    const { data } = await asUser(suporteAdmin.accessToken)
      .from('admin_user_notes')
      .select('id')
      .eq('id', noteId);
    expect((data ?? []).length).toBe(0);
  });

  it('admin COM USER_NOTE_VIEW (ADMIN) lê a nota', async () => {
    const { data } = await asUser(admin.accessToken)
      .from('admin_user_notes')
      .select('id, body')
      .eq('id', noteId);
    expect((data ?? []).length).toBe(1);
  });

  it('nenhum role escreve direto em admin_user_notes (escrita só via RPC)', async () => {
    const { error: adminErr } = await asUser(admin.accessToken)
      .from('admin_user_notes')
      .insert({ user_id: target.id, author_id: admin.id, body: 'tentativa direta' });
    expect(adminErr).not.toBeNull(); // policy de escrita nega (USING/CHECK false)

    const { error: clientErr } = await asUser(target.accessToken)
      .from('admin_user_notes')
      .insert({ user_id: target.id, body: 'cliente tentando' });
    expect(clientErr).not.toBeNull();
  });
});

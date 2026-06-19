/**
 * Integração — schema/efeitos da migration 116 (admin_user_notes).
 *
 * A reaplicação 2x sem erro é garantida estruturalmente pela própria migration
 * (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF
 * EXISTS) e exercitada pelo runner de migrations do CI. Aqui provamos os efeitos
 * observáveis:
 *   - admin_user_notes existe; CHECK de body (1..5000) é aplicado;
 *   - RLS habilitada bloqueia anon;
 *   - trigger updated_at toca a coluna em UPDATE (versionamento otimista).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 13.1, 16.2, 16.7
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asService,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 116 — schema de admin_user_notes', () => {
  let target: SeededUser;
  let noteId: string | null = null;

  beforeAll(async () => {
    const svc = asService();
    target = await seedUser({ tag: 'c360-mig-target', userType: 'motorista' });
    await ensureUserRow(svc, { id: target.id, userType: 'motorista' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (noteId) await svc.from('admin_user_notes').delete().eq('id', noteId);
    if (target) {
      await cleanupUserRow(svc, target.id); // cascateia notas restantes
      await cleanupUser(target.id);
    }
  }, HOOK_TIMEOUT);

  it('aceita body válido e devolve id/updated_at', async () => {
    const { data, error } = await asService()
      .from('admin_user_notes')
      .insert({ user_id: target.id, body: 'nota válida' })
      .select('id, updated_at')
      .single();
    expect(error).toBeNull();
    const row = data as { id: string; updated_at: string };
    noteId = row.id;
    expect(row.id).toBeTruthy();
  });

  it('rejeita body vazio (CHECK 1..5000)', async () => {
    const { error } = await asService()
      .from('admin_user_notes')
      .insert({ user_id: target.id, body: '' });
    expect(error).not.toBeNull();
  });

  it('rejeita body acima de 5000 (CHECK 1..5000)', async () => {
    const { error } = await asService()
      .from('admin_user_notes')
      .insert({ user_id: target.id, body: 'x'.repeat(5001) });
    expect(error).not.toBeNull();
  });

  it('RLS habilitada bloqueia anon', async () => {
    const { data } = await asAnon().from('admin_user_notes').select('id');
    expect((data ?? []).length).toBe(0);
  });

  it('trigger updated_at toca a coluna em UPDATE', async () => {
    if (!noteId) throw new Error('nota não criada no teste anterior');
    const before = await asService()
      .from('admin_user_notes')
      .select('updated_at')
      .eq('id', noteId)
      .single();
    const beforeAt = (before.data as { updated_at: string }).updated_at;

    await new Promise((r) => setTimeout(r, 1100)); // garante delta de tempo
    await asService().from('admin_user_notes').update({ body: 'nota editada' }).eq('id', noteId);

    const after = await asService()
      .from('admin_user_notes')
      .select('updated_at')
      .eq('id', noteId)
      .single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(beforeAt).getTime());
  });
});

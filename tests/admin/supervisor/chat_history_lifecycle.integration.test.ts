/**
 * Integração — ciclo de vida do histórico de conversas (119): criar sessão,
 * anexar mensagens (ordenadas, tocando updated_at), renomear, excluir
 * (idempotente, CASCADE), com audits de SUCESSO persistidos.
 *
 * Prova:
 *   - create grava SUPERVISOR_CHAT_SESSION_CREATED (persistido);
 *   - append user+ai ⇒ messages_list em ordem asc (user antes de ai) e o
 *     updated_at da sessão avança;
 *   - rename do dono atualiza o título;
 *   - delete grava SUPERVISOR_CHAT_SESSION_DELETED, remove as mensagens (CASCADE)
 *     e é idempotente (2ª chamada ⇒ skipped ALREADY_GONE).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 1, 2, 3 (supervisor-chat-history)
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asUser,
  asService,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';
import {
  expectAuditPersisted,
  type AuditLogRowLike,
} from '../../../src/__tests__/_helpers/auditAssertions';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 119 — ciclo de vida do chat-history', () => {
  let admin: SeededUser;
  const createdSessions: string[] = [];

  function logs(action: string, targetId: string) {
    return async (): Promise<AuditLogRowLike[]> => {
      const { data } = await asService()
        .from('admin_audit_logs')
        .select('action, target_type, target_id, before_data, after_data')
        .eq('action', action)
        .eq('target_id', targetId)
        .limit(20);
      return (data ?? []) as AuditLogRowLike[];
    };
  }

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'chat-life-admin', userType: 'embarcador' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await seedAdminRole(svc, admin.id, 'ADMIN');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    for (const id of createdSessions) await svc.from('supervisor_chat_sessions').delete().eq('id', id);
    if (admin) {
      await cleanupUserRow(svc, admin.id);
      await cleanupUser(admin.id);
    }
  }, HOOK_TIMEOUT);

  it('create grava audit; append user+ai ordenado; updated_at avança', async () => {
    const a = asUser(admin.accessToken);
    const created = await a.rpc('supervisor_chat_session_create', { p_title: 'Ciclo de vida' });
    expect(created.error).toBeNull();
    const sid = (created.data as { id: string }).id;
    createdSessions.push(sid);

    await expectAuditPersisted(logs('SUPERVISOR_CHAT_SESSION_CREATED', sid), {
      action: 'SUPERVISOR_CHAT_SESSION_CREATED',
      targetType: 'supervisor_chat_sessions',
      targetId: sid,
    });

    const before = await asService()
      .from('supervisor_chat_sessions')
      .select('updated_at')
      .eq('id', sid)
      .single();
    const beforeAt = (before.data as { updated_at: string }).updated_at;

    await new Promise((r) => setTimeout(r, 1100));
    await a.rpc('supervisor_chat_message_append', { p_session: sid, p_role: 'user', p_content: 'primeira' });
    await a.rpc('supervisor_chat_message_append', { p_session: sid, p_role: 'ai', p_content: 'segunda' });

    const list = await a.rpc('supervisor_chat_messages_list', { p_session: sid });
    expect(list.error).toBeNull();
    const items = (list.data as { items: { role: string; content: string }[] }).items;
    expect(items.map((m) => m.role)).toEqual(['user', 'ai']); // ordem asc por created_at
    expect(items[0].content).toBe('primeira');

    const after = await asService()
      .from('supervisor_chat_sessions')
      .select('updated_at')
      .eq('id', sid)
      .single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(beforeAt).getTime()); // append tocou
  });

  it('rename do dono atualiza o título', async () => {
    const a = asUser(admin.accessToken);
    const created = await a.rpc('supervisor_chat_session_create', { p_title: 'Antes' });
    const sid = (created.data as { id: string }).id;
    createdSessions.push(sid);

    const ren = await a.rpc('supervisor_chat_session_rename', { p_session: sid, p_title: 'Depois' });
    expect(ren.error).toBeNull();
    expect((ren.data as { ok?: boolean }).ok).toBe(true);

    const row = await asService().from('supervisor_chat_sessions').select('title').eq('id', sid).single();
    expect((row.data as { title: string }).title).toBe('Depois');
  });

  it('delete grava audit, faz CASCADE e é idempotente', async () => {
    const a = asUser(admin.accessToken);
    const created = await a.rpc('supervisor_chat_session_create', { p_title: 'Para excluir' });
    const sid = (created.data as { id: string }).id;
    await a.rpc('supervisor_chat_message_append', { p_session: sid, p_role: 'user', p_content: 'x' });

    const del = await a.rpc('supervisor_chat_session_delete', { p_session: sid });
    expect(del.error).toBeNull();
    expect((del.data as { ok?: boolean }).ok).toBe(true);

    await expectAuditPersisted(logs('SUPERVISOR_CHAT_SESSION_DELETED', sid), {
      action: 'SUPERVISOR_CHAT_SESSION_DELETED',
      targetType: 'supervisor_chat_sessions',
      targetId: sid,
    });

    // CASCADE: mensagens removidas
    const msgs = await asService().from('supervisor_chat_messages').select('id').eq('session_id', sid);
    expect((msgs.data ?? []).length).toBe(0);

    // idempotente: 2ª exclusão ⇒ skipped
    const again = await a.rpc('supervisor_chat_session_delete', { p_session: sid });
    expect((again.data as { skipped?: boolean }).skipped).toBe(true);
    expect((again.data as { reason?: string }).reason).toBe('ALREADY_GONE');
  });
});

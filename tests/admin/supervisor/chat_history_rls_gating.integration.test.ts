/**
 * Integração — RLS POR DONO + gating das RPCs do histórico de conversas (119).
 *
 * Prova que:
 *   - admin A só vê as PRÓPRIAS conversas (supervisor_chat_sessions_list);
 *     a sessão de A NÃO aparece para o admin B (isolamento por dono);
 *   - B não lê as mensagens da sessão de A (messages_list ⇒ []), não anexa
 *     (append ⇒ 42501), e rename/delete da sessão de A ⇒ skipped (0 linhas);
 *   - Cliente comum ⇒ permission_denied (42501) nas 6 RPCs;
 *   - anon/Cliente não leem as tabelas direto (RLS).
 *
 * NOTA: o log negativo SUPERVISOR_VIEW_DENIED é gravado e revertido pelo RAISE
 * (1 txn/call) — por isso asserimos o erro 42501, não a persistência do log.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 1.3, 3.3, 4.x (supervisor-chat-history)
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asUser,
  asService,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;
const FAKE_ID = '11111111-1111-4111-8111-111111111111';

function deniedCode(res: { error: { code?: string; message?: string } | null }): string {
  return `${res.error?.code ?? ''}${res.error?.message ?? ''}`;
}

describeIntegration('Integração 119 — RLS por dono + gating do chat-history', () => {
  let adminA: SeededUser;
  let adminB: SeededUser;
  let client: SeededUser;
  let sessionA = '';

  beforeAll(async () => {
    const svc = asService();
    adminA = await seedUser({ tag: 'chat-rls-a', userType: 'embarcador' });
    adminB = await seedUser({ tag: 'chat-rls-b', userType: 'embarcador' });
    client = await seedUser({ tag: 'chat-rls-client', userType: 'motorista' });
    for (const u of [adminA, adminB]) {
      await ensureUserRow(svc, { id: u.id, userType: 'embarcador' });
      await seedAdminRole(svc, u.id, 'ADMIN');
    }
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });

    // A cria uma sessão + uma mensagem (via RPC, como dono).
    const created = await asUser(adminA.accessToken).rpc('supervisor_chat_session_create', {
      p_title: 'Conversa do A',
    });
    if (created.error) throw new Error(`create falhou: ${created.error.message}`);
    sessionA = (created.data as { id: string }).id;
    await asUser(adminA.accessToken).rpc('supervisor_chat_message_append', {
      p_session: sessionA,
      p_role: 'user',
      p_content: 'mensagem do A',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (sessionA) await svc.from('supervisor_chat_sessions').delete().eq('id', sessionA);
    for (const u of [adminA, adminB, client]) {
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('A vê a própria conversa; B NÃO a vê (isolamento por dono)', async () => {
    const aList = await asUser(adminA.accessToken).rpc('supervisor_chat_sessions_list', {
      p_limit: 50,
      p_offset: 0,
    });
    expect(aList.error).toBeNull();
    const aIds = ((aList.data as { items?: { id: string }[] }).items ?? []).map((s) => s.id);
    expect(aIds).toContain(sessionA);

    const bList = await asUser(adminB.accessToken).rpc('supervisor_chat_sessions_list', {
      p_limit: 50,
      p_offset: 0,
    });
    expect(bList.error).toBeNull();
    const bIds = ((bList.data as { items?: { id: string }[] }).items ?? []).map((s) => s.id);
    expect(bIds).not.toContain(sessionA);
  });

  it('B não lê mensagens da sessão de A (messages_list ⇒ [])', async () => {
    const res = await asUser(adminB.accessToken).rpc('supervisor_chat_messages_list', {
      p_session: sessionA,
    });
    expect(res.error).toBeNull();
    expect(((res.data as { items?: unknown[] }).items ?? []).length).toBe(0);
  });

  it('B não anexa na sessão de A (append ⇒ 42501)', async () => {
    const res = await asUser(adminB.accessToken).rpc('supervisor_chat_message_append', {
      p_session: sessionA,
      p_role: 'user',
      p_content: 'invasao',
    });
    expect(deniedCode(res)).toContain('42501');
  });

  it('B renomeia/exclui a sessão de A ⇒ skipped (0 linhas; não vaza nem altera)', async () => {
    const ren = await asUser(adminB.accessToken).rpc('supervisor_chat_session_rename', {
      p_session: sessionA,
      p_title: 'sequestrada',
    });
    expect(ren.error).toBeNull();
    expect((ren.data as { skipped?: boolean }).skipped).toBe(true);

    const del = await asUser(adminB.accessToken).rpc('supervisor_chat_session_delete', {
      p_session: sessionA,
    });
    expect(del.error).toBeNull();
    expect((del.data as { skipped?: boolean }).skipped).toBe(true);

    // a sessão de A continua intacta
    const still = await asService().from('supervisor_chat_sessions').select('title').eq('id', sessionA).single();
    expect((still.data as { title: string }).title).toBe('Conversa do A');
  });

  it('Cliente comum ⇒ permission_denied (42501) nas 6 RPCs', async () => {
    const c = asUser(client.accessToken);
    expect(deniedCode(await c.rpc('supervisor_chat_session_create', { p_title: 'x' }))).toContain('42501');
    expect(deniedCode(await c.rpc('supervisor_chat_sessions_list', { p_limit: 10, p_offset: 0 }))).toContain('42501');
    expect(deniedCode(await c.rpc('supervisor_chat_messages_list', { p_session: FAKE_ID }))).toContain('42501');
    expect(
      deniedCode(await c.rpc('supervisor_chat_message_append', { p_session: FAKE_ID, p_role: 'user', p_content: 'x' }))
    ).toContain('42501');
    expect(deniedCode(await c.rpc('supervisor_chat_session_rename', { p_session: FAKE_ID, p_title: 'x' }))).toContain('42501');
    expect(deniedCode(await c.rpc('supervisor_chat_session_delete', { p_session: FAKE_ID }))).toContain('42501');
  });

  it('isolamento: anon e Cliente não leem as tabelas direto', async () => {
    expect((await asAnon().from('supervisor_chat_sessions').select('id').limit(5)).data ?? []).toHaveLength(0);
    const c = asUser(client.accessToken);
    expect((await c.from('supervisor_chat_sessions').select('id').limit(5)).data ?? []).toHaveLength(0);
    expect((await c.from('supervisor_chat_messages').select('id').limit(5)).data ?? []).toHaveLength(0);
  });
});

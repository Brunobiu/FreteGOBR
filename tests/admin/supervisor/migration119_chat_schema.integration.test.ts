/**
 * Integração — schema/efeitos da migration 119 (supervisor_chat_sessions +
 * supervisor_chat_messages).
 *
 * Prova os efeitos observáveis:
 *   - tabelas existem; CHECK de title (1..120), role (user/ai) e content (1..8000);
 *   - FK session_id CASCADE (excluir sessão remove mensagens);
 *   - RLS habilitada bloqueia anon nas duas tabelas;
 *   - trigger supervisor_touch_updated_at toca updated_at da sessão em UPDATE.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 2.x, 3.x, 4.x (supervisor-chat-history)
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

describeIntegration('Integração 119 — schema de supervisor_chat_*', () => {
  let owner: SeededUser;
  let sessionId = '';
  const createdSessions: string[] = [];

  beforeAll(async () => {
    const svc = asService();
    owner = await seedUser({ tag: 'chat-schema-owner', userType: 'embarcador' });
    await ensureUserRow(svc, { id: owner.id, userType: 'embarcador' });
    const ins = await svc
      .from('supervisor_chat_sessions')
      .insert({ admin_id: owner.id, title: 'Conversa schema' })
      .select('id')
      .single();
    if (ins.error) throw new Error(`seed sessão falhou: ${ins.error.message}`);
    sessionId = (ins.data as { id: string }).id;
    createdSessions.push(sessionId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    for (const id of createdSessions) await svc.from('supervisor_chat_sessions').delete().eq('id', id);
    if (owner) {
      await cleanupUserRow(svc, owner.id);
      await cleanupUser(owner.id);
    }
  }, HOOK_TIMEOUT);

  it('aceita mensagem válida (role user/ai, content 1..8000)', async () => {
    const svc = asService();
    const u = await svc
      .from('supervisor_chat_messages')
      .insert({ session_id: sessionId, role: 'user', content: 'olá' })
      .select('id')
      .single();
    expect(u.error).toBeNull();
    const a = await svc
      .from('supervisor_chat_messages')
      .insert({ session_id: sessionId, role: 'ai', content: 'resposta' })
      .select('id')
      .single();
    expect(a.error).toBeNull();
  });

  it('rejeita role fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('supervisor_chat_messages')
      .insert({ session_id: sessionId, role: 'system', content: 'x' });
    expect(error).not.toBeNull();
  });

  it('rejeita content vazio e content > 8000 (CHECK)', async () => {
    const svc = asService();
    const empty = await svc
      .from('supervisor_chat_messages')
      .insert({ session_id: sessionId, role: 'user', content: '' });
    expect(empty.error).not.toBeNull();
    const tooLong = await svc
      .from('supervisor_chat_messages')
      .insert({ session_id: sessionId, role: 'user', content: 'a'.repeat(8001) });
    expect(tooLong.error).not.toBeNull();
  });

  it('rejeita title fora de 1..120 (CHECK)', async () => {
    const svc = asService();
    const empty = await svc
      .from('supervisor_chat_sessions')
      .insert({ admin_id: owner.id, title: '' });
    expect(empty.error).not.toBeNull();
    const tooLong = await svc
      .from('supervisor_chat_sessions')
      .insert({ admin_id: owner.id, title: 'a'.repeat(121) });
    expect(tooLong.error).not.toBeNull();
  });

  it('FK CASCADE: excluir a sessão remove suas mensagens', async () => {
    const svc = asService();
    const s = await svc
      .from('supervisor_chat_sessions')
      .insert({ admin_id: owner.id, title: 'Cascata' })
      .select('id')
      .single();
    const sid = (s.data as { id: string }).id;
    await svc.from('supervisor_chat_messages').insert({ session_id: sid, role: 'user', content: 'x' });
    await svc.from('supervisor_chat_sessions').delete().eq('id', sid);
    const msgs = await svc.from('supervisor_chat_messages').select('id').eq('session_id', sid);
    expect((msgs.data ?? []).length).toBe(0);
  });

  it('RLS habilitada bloqueia anon nas duas tabelas (0 linhas)', async () => {
    const s = await asAnon().from('supervisor_chat_sessions').select('id').limit(5);
    expect((s.data ?? []).length).toBe(0);
    const m = await asAnon().from('supervisor_chat_messages').select('id').limit(5);
    expect((m.data ?? []).length).toBe(0);
  });

  it('trigger toca updated_at da sessão em UPDATE', async () => {
    const svc = asService();
    const before = await svc
      .from('supervisor_chat_sessions')
      .select('updated_at')
      .eq('id', sessionId)
      .single();
    const beforeAt = (before.data as { updated_at: string }).updated_at;
    await new Promise((r) => setTimeout(r, 1100));
    await svc.from('supervisor_chat_sessions').update({ title: 'Conversa schema (ed)' }).eq('id', sessionId);
    const after = await svc
      .from('supervisor_chat_sessions')
      .select('updated_at')
      .eq('id', sessionId)
      .single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(beforeAt).getTime());
  });
});

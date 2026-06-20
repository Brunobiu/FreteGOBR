/**
 * Service do histórico de conversas (supervisor-chat-history / 119).
 *
 * Cobre: createChatSession (deriva título sem PII); listChatSessions/Messages
 * (mapeamento + sanitização de content na leitura); appendChatMessage (sanitiza
 * content ANTES da RPC; inválido ⇒ null sem chamar RPC; erro de RPC ⇒ null sem
 * lançar — Req 6.2); rename/delete (_SKIPPED); permission_denied propaga.
 *
 * Validates: Requirements 1, 2, 3, 6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) =>
      (
        (globalThis as Record<string, unknown>).__rpc as (n: string, a: unknown) => Promise<unknown>
      )(name, args),
  },
}));

import {
  createChatSession,
  listChatSessions,
  listChatMessages,
  appendChatMessage,
  renameChatSession,
  deleteChatSession,
  SupervisorError,
} from '../../../services/admin/supervisor';
import { expectNoSecrets } from '../../_helpers/logAssertions';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}
function setupRpc(handler: (name: string, args: Record<string, unknown>) => unknown): RpcCall[] {
  const calls: RpcCall[] = [];
  (globalThis as Record<string, unknown>).__rpc = vi.fn((name: string, args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push({ name, args: a });
    return Promise.resolve(handler(name, a));
  });
  return calls;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__rpc;
});

const SECRET = 'sb_' + 'secret_' + 'ABCDEFGHIJ1234567890';

describe('createChatSession', () => {
  it('deriva o título da 1ª mensagem (sem PII) e envia p_title', async () => {
    const calls = setupRpc(() => ({ data: { id: 's1', title: 'x' }, error: null }));
    const res = await createChatSession(`pergunta com ${SECRET} dentro`);
    expect(res.id).toBe('s1');
    const sent = String(calls[0].args.p_title);
    expect(sent).not.toContain(SECRET); // título redigido
    expectNoSecrets(sent);
  });

  it('mensagem vazia ⇒ título default', async () => {
    const calls = setupRpc(() => ({ data: { id: 's2', title: 'Nova conversa' }, error: null }));
    await createChatSession('   ');
    expect(calls[0].args.p_title).toBe('Nova conversa');
  });
});

describe('listChatSessions / listChatMessages', () => {
  it('lista sessões (mapeia snake_case)', async () => {
    setupRpc(() => ({
      data: { items: [{ id: 's1', admin_id: 'a', title: 'Conversa', updated_at: 't' }] },
      error: null,
    }));
    const out = await listChatSessions();
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Conversa');
  });

  it('mensagens: content é sanitizado na leitura (defesa)', async () => {
    setupRpc(() => ({
      data: { items: [{ id: 'm1', session_id: 's1', role: 'user', content: `vazou ${SECRET}` }] },
      error: null,
    }));
    const out = await listChatMessages('s1');
    expect(out[0].content).not.toContain(SECRET);
    expectNoSecrets(out[0].content);
  });
});

describe('appendChatMessage', () => {
  it('sanitiza o content ANTES de enviar à RPC', async () => {
    const calls = setupRpc(() => ({ data: { id: 'm9' }, error: null }));
    const res = await appendChatMessage('s1', 'user', `olha o ${SECRET}`);
    expect(res).toEqual({ id: 'm9' });
    const sent = String(calls[0].args.p_content);
    expect(sent).not.toContain(SECRET);
    expectNoSecrets(sent);
  });

  it('content inválido (vazio) ⇒ null e NÃO chama a RPC', async () => {
    const calls = setupRpc(() => ({ data: { id: 'x' }, error: null }));
    const res = await appendChatMessage('s1', 'user', '   ');
    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('erro de RPC ⇒ null (NÃO lança — o chat não pode quebrar)', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    const res = await appendChatMessage('s1', 'ai', 'resposta');
    expect(res).toBeNull();
  });
});

describe('renameChatSession / deleteChatSession', () => {
  it('rename ok', async () => {
    setupRpc(() => ({ data: { ok: true }, error: null }));
    expect(await renameChatSession('s1', 'Novo nome')).toEqual({ ok: true });
  });

  it('delete idempotente ⇒ skipped quando já foi', async () => {
    setupRpc(() => ({ data: { skipped: true, reason: 'ALREADY_GONE' }, error: null }));
    expect(await deleteChatSession('s1')).toEqual({ skipped: true, reason: 'ALREADY_GONE' });
  });

  it('rename com permission_denied ⇒ SupervisorError(PERMISSION_DENIED)', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    await expect(renameChatSession('s1', 'x')).rejects.toMatchObject({
      name: 'SupervisorError',
      code: 'PERMISSION_DENIED',
    });
    expect(SupervisorError).toBeTruthy();
  });
});

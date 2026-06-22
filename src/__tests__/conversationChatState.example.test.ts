/**
 * Testes de integração (mock) de `getConversationChatState`.
 *
 * Valida:
 *   - mapeamento jsonb (snake_case) → objeto camelCase tipado;
 *   - frete excluído/indisponível → available=false (bloqueio dos dois lados);
 *   - fail-safe: erro do Supabase ou ausência de dados → null (nunca lança).
 *
 * Convenção do projeto: `vi.mock` é hoisted — resultado mutável exposto via
 * `globalThis`, sem referenciar variáveis externas no factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getConversationChatState } from '../services/chatFrete';

vi.mock('../services/supabase', () => {
  return {
    supabase: {
      rpc: () => (globalThis as Record<string, unknown>).__chatStateResult,
    },
  };
});

function setResult(r: unknown) {
  (globalThis as Record<string, unknown>).__chatStateResult = Promise.resolve(r);
}

describe('getConversationChatState', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__chatStateResult;
  });

  it('mapeia frete ativo + WhatsApp liberado (snake_case → camelCase)', async () => {
    setResult({
      data: {
        frete: { linked: true, exists: true, status: 'ativo', available: true, value: '1500.5' },
        whatsapp: {
          unlocked: true,
          peer_phone: '5562999998888',
          msgs_self: 4,
          msgs_peer: 3,
          threshold: 3,
        },
      },
      error: null,
    });
    const st = await getConversationChatState('conv-1');
    expect(st).toEqual({
      frete: { linked: true, exists: true, status: 'ativo', available: true, value: 1500.5 },
      whatsapp: {
        unlocked: true,
        peerPhone: '5562999998888',
        msgsSelf: 4,
        msgsPeer: 3,
        threshold: 3,
      },
    });
  });

  it('frete excluído → available=false e peer_phone null', async () => {
    setResult({
      data: {
        frete: { linked: true, exists: false, status: null, available: false, value: null },
        whatsapp: { unlocked: false, peer_phone: null, msgs_self: 1, msgs_peer: 0, threshold: 3 },
      },
      error: null,
    });
    const st = await getConversationChatState('conv-2');
    expect(st?.frete.available).toBe(false);
    expect(st?.frete.exists).toBe(false);
    expect(st?.whatsapp.peerPhone).toBeNull();
    expect(st?.whatsapp.unlocked).toBe(false);
  });

  it('erro do Supabase → null sem lançar (fail-safe)', async () => {
    setResult({ data: null, error: { message: 'boom' } });
    await expect(getConversationChatState('conv-3')).resolves.toBeNull();
  });

  it('sem data → null', async () => {
    setResult({ data: null, error: null });
    await expect(getConversationChatState('conv-4')).resolves.toBeNull();
  });

  it('defaults seguros quando campos vêm ausentes', async () => {
    setResult({ data: { frete: {}, whatsapp: {} }, error: null });
    const st = await getConversationChatState('conv-5');
    expect(st).toEqual({
      frete: { linked: false, exists: false, status: null, available: false, value: null },
      whatsapp: { unlocked: false, peerPhone: null, msgsSelf: 0, msgsPeer: 0, threshold: 3 },
    });
  });
});

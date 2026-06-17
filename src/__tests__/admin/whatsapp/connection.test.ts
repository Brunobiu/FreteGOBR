// Feature: whatsapp-automation, Task 20.2 (suporte): cliente do proxy de conexão
/**
 * Testes unitários do cliente de conexão (`src/services/admin/whatsapp/connection.ts`),
 * wrapper TS da Edge Function `whatsapp-evolution-proxy`.
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 3 (conexão).
 *
 * Cobre:
 *  - connect ⇒ QR_PENDING com QR / CONNECTED já pareado (Req 3.2-3.4);
 *  - erro/indisponibilidade ⇒ `ok:false` + Canonical_Message
 *    `Não foi possível conectar o WhatsApp.` mantendo DISCONNECTED (Req 3.5);
 *  - logout ⇒ DISCONNECTED (Req 3.6);
 *  - listGroups ⇒ mapeia grupos; sessão não conectada / falha ⇒ vazio.
 *
 * Convenções: `vi.mock` hoisted, spy via `globalThis`. Identifiers em inglês;
 * mensagens user-facing em pt-BR.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/supabase', () => {
  const invokeSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waProxyInvokeSpy = invokeSpy;
  return { supabase: { functions: { invoke: (...args: unknown[]) => invokeSpy(...args) } } };
});

import {
  connectInstance,
  refreshQr,
  getConnectionStatus,
  disconnectInstance,
  listInstanceGroups,
  WHATSAPP_CONNECT_FAILED_MESSAGE,
} from '../../../services/admin/whatsapp/connection';

const invokeSpy = (globalThis as Record<string, unknown>).__waProxyInvokeSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  invokeSpy.mockReset();
});

describe('connectInstance — conexão e QR (Req 3.2-3.5)', () => {
  it('QR_PENDING retorna o QR', async () => {
    invokeSpy.mockResolvedValue({
      data: { ok: true, status: 'QR_PENDING', qr: 'data:image/png;base64,AAAA' },
      error: null,
    });

    const res = await connectInstance(INSTANCE_A);

    expect(invokeSpy).toHaveBeenCalledWith('whatsapp-evolution-proxy', {
      body: { action: 'connect', instanceId: INSTANCE_A },
    });
    expect(res).toEqual({ ok: true, status: 'QR_PENDING', qr: 'data:image/png;base64,AAAA' });
  });

  it('já pareado retorna CONNECTED sem QR', async () => {
    invokeSpy.mockResolvedValue({ data: { ok: true, status: 'CONNECTED' }, error: null });
    const res = await connectInstance(INSTANCE_A);
    expect(res).toEqual({ ok: true, status: 'CONNECTED', qr: null });
  });

  it('indisponível (ok:false) ⇒ Canonical_Message + DISCONNECTED (Req 3.5)', async () => {
    invokeSpy.mockResolvedValue({
      data: { ok: false, code: 'EVOLUTION_UNAVAILABLE', message: 'Nao foi possivel conectar o WhatsApp.', status: 'DISCONNECTED' },
      error: null,
    });
    const res = await connectInstance(INSTANCE_A);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('DISCONNECTED');
    expect(res.qr).toBeNull();
    expect(res.message).toBeTruthy();
  });

  it('erro de transporte ⇒ ok:false + Canonical_Message, sem lançar', async () => {
    invokeSpy.mockResolvedValue({ data: null, error: { message: 'network' } });
    const res = await connectInstance(INSTANCE_A);
    expect(res).toEqual({
      ok: false,
      status: 'DISCONNECTED',
      qr: null,
      message: WHATSAPP_CONNECT_FAILED_MESSAGE,
    });
  });

  it('exceção do invoke ⇒ ok:false (não propaga)', async () => {
    invokeSpy.mockRejectedValue(new Error('boom'));
    const res = await connectInstance(INSTANCE_A);
    expect(res.ok).toBe(false);
    expect(res.message).toBe(WHATSAPP_CONNECT_FAILED_MESSAGE);
  });
});

describe('refreshQr / getConnectionStatus / disconnectInstance', () => {
  it('refreshQr usa a ação qr', async () => {
    invokeSpy.mockResolvedValue({ data: { ok: true, status: 'QR_PENDING', qr: 'x' }, error: null });
    await refreshQr(INSTANCE_A);
    expect(invokeSpy).toHaveBeenCalledWith('whatsapp-evolution-proxy', {
      body: { action: 'qr', instanceId: INSTANCE_A },
    });
  });

  it('getConnectionStatus usa a ação status', async () => {
    invokeSpy.mockResolvedValue({ data: { ok: true, status: 'CONNECTED' }, error: null });
    const res = await getConnectionStatus(INSTANCE_A);
    expect(invokeSpy).toHaveBeenCalledWith('whatsapp-evolution-proxy', {
      body: { action: 'status', instanceId: INSTANCE_A },
    });
    expect(res.status).toBe('CONNECTED');
  });

  it('disconnectInstance usa a ação logout e resulta em DISCONNECTED', async () => {
    invokeSpy.mockResolvedValue({ data: { ok: true, status: 'DISCONNECTED' }, error: null });
    const res = await disconnectInstance(INSTANCE_A);
    expect(invokeSpy).toHaveBeenCalledWith('whatsapp-evolution-proxy', {
      body: { action: 'logout', instanceId: INSTANCE_A },
    });
    expect(res).toEqual({ ok: true, status: 'DISCONNECTED', qr: null });
  });
});

describe('listInstanceGroups — cache de grupos via proxy', () => {
  it('mapeia os grupos retornados', async () => {
    invokeSpy.mockResolvedValue({
      data: {
        ok: true,
        status: 'CONNECTED',
        groups: [
          { group_jid: '123@g.us', name: 'Grupo A', participant_count: 42 },
          { group_jid: '456@g.us', name: null, participant_count: null },
        ],
      },
      error: null,
    });

    const res = await listInstanceGroups(INSTANCE_A);
    expect(res.ok).toBe(true);
    expect(res.groups).toEqual([
      { groupJid: '123@g.us', name: 'Grupo A', participantCount: 42 },
      { groupJid: '456@g.us', name: null, participantCount: null },
    ]);
  });

  it('sessão não conectada (ok:false) ⇒ grupos vazios + mensagem', async () => {
    invokeSpy.mockResolvedValue({
      data: { ok: false, code: 'SESSION_NOT_CONNECTED', message: 'Conecte o WhatsApp antes de iniciar o disparo.', status: 'DISCONNECTED' },
      error: null,
    });
    const res = await listInstanceGroups(INSTANCE_A);
    expect(res.ok).toBe(false);
    expect(res.groups).toEqual([]);
    expect(res.message).toBeTruthy();
  });

  it('erro de transporte ⇒ vazio + Canonical_Message', async () => {
    invokeSpy.mockResolvedValue({ data: null, error: { message: 'network' } });
    const res = await listInstanceGroups(INSTANCE_A);
    expect(res.groups).toEqual([]);
    expect(res.message).toBe(WHATSAPP_CONNECT_FAILED_MESSAGE);
  });
});

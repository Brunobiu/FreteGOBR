/**
 * Testes unitários da camada de serviço de sessão única do WhatsApp_Module
 * (`src/services/admin/whatsapp/session.ts`) — task 6.3.
 *
 * Mockam-se (hoisted) `supabase.rpc` (as RPCs reais são `SECURITY DEFINER` no
 * lado SQL) e `executeAdminMutation` (audit-by-construction, admin-patterns §1),
 * expondo os spies via `globalThis` conforme a convenção do projeto. O mock de
 * `executeAdminMutation` executa a `fn` interna (para exercitar a chamada à RPC)
 * e registra o `input` de auditoria — permitindo asserir o `instance_id`.
 *
 * Cobertura:
 *  - Transições de status: connect→`CONNECTING`, disconnect→`DISCONNECTED`,
 *    `setSessionStatus` (uso geral, ex.: `QR_PENDING`/`CONNECTED`/`EXPIRED`).
 *  - Sessão única por instância: `getSession` retorna o default `DISCONNECTED`
 *    quando não há linha materializada; a mesma sessão é reutilizada.
 *  - Bloqueio quando não `CONNECTED`: guarda `assertConnected` lança a
 *    Canonical_Message `Conecte o WhatsApp antes de iniciar o disparo.`
 *  - Auditoria em connect/disconnect: `executeAdminMutation` é invocado com o
 *    `instance_id` (targetId); `getSession` (leitura) nunca audita.
 *
 * Validates: Requirements 3.4, 3.8, 4.5, 2.9
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waSessionRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waSessionAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  connect,
  disconnect,
  setSessionStatus,
  getSession,
  assertConnected,
  WHATSAPP_NOT_CONNECTED_MESSAGE,
  type SessionStatus,
  type WhatsAppSession,
} from '../../../services/admin/whatsapp/session';

const rpcSpy = (globalThis as Record<string, unknown>).__waSessionRpcSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waSessionAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE = '11111111-1111-1111-1111-111111111111';

/** Linha crua (snake_case) como retornada pelas RPCs de sessão. */
function sessionRow(
  status: SessionStatus,
  overrides: Partial<{
    qr_code: string | null;
    last_connected_at: string | null;
    updated_at: string | null;
  }> = {}
) {
  return {
    instance_id: INSTANCE,
    status,
    qr_code: 'qr_code' in overrides ? (overrides.qr_code ?? null) : null,
    last_connected_at:
      'last_connected_at' in overrides ? (overrides.last_connected_at ?? null) : null,
    updated_at:
      'updated_at' in overrides ? (overrides.updated_at ?? null) : '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('transições de status da sessão', () => {
  it('connect → CONNECTING via whatsapp_set_session_status', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('CONNECTING'), error: null });

    const session = await connect(INSTANCE);

    expect(session.status).toBe('CONNECTING');
    expect(session.instanceId).toBe(INSTANCE);
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_session_status', {
      p_instance_id: INSTANCE,
      p_status: 'CONNECTING',
      p_qr_code: null,
    });
  });

  it('disconnect → DISCONNECTED via whatsapp_set_session_status', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('DISCONNECTED'), error: null });

    const session = await disconnect(INSTANCE);

    expect(session.status).toBe('DISCONNECTED');
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_session_status', {
      p_instance_id: INSTANCE,
      p_status: 'DISCONNECTED',
      p_qr_code: null,
    });
  });

  it('setSessionStatus define status arbitrário (QR_PENDING) preservando o qr_code', async () => {
    rpcSpy.mockResolvedValue({
      data: sessionRow('QR_PENDING', { qr_code: 'data:image/png;base64,QR' }),
      error: null,
    });

    const session = await setSessionStatus(INSTANCE, 'QR_PENDING', 'data:image/png;base64,QR');

    expect(session.status).toBe('QR_PENDING');
    expect(session.qrCode).toBe('data:image/png;base64,QR');
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_session_status', {
      p_instance_id: INSTANCE,
      p_status: 'QR_PENDING',
      p_qr_code: 'data:image/png;base64,QR',
    });
  });

  it('setSessionStatus promove a CONNECTED registrando last_connected_at', async () => {
    rpcSpy.mockResolvedValue({
      data: sessionRow('CONNECTED', { last_connected_at: '2026-01-02T10:00:00.000Z' }),
      error: null,
    });

    const session = await setSessionStatus(INSTANCE, 'CONNECTED');

    expect(session.status).toBe('CONNECTED');
    expect(session.lastConnectedAt).toBe('2026-01-02T10:00:00.000Z');
  });

  it('propaga erro mapeado da RPC ao transicionar', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'boom interno', code: 'XX000' },
    });

    await expect(connect(INSTANCE)).rejects.toThrow('boom interno');
  });
});

describe('sessão única por instância', () => {
  it('getSession retorna o default DISCONNECTED quando não há sessão materializada', async () => {
    // A RPC `whatsapp_get_session` retorna a forma default quando não há linha.
    rpcSpy.mockResolvedValue({
      data: sessionRow('DISCONNECTED', { updated_at: null }),
      error: null,
    });

    const session = await getSession(INSTANCE);

    expect(session.status).toBe('DISCONNECTED');
    expect(session.updatedAt).toBeNull();
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_session', {
      p_instance_id: INSTANCE,
    });
  });

  it('reutiliza a mesma sessão (uma por instância) em leituras repetidas', async () => {
    rpcSpy.mockResolvedValue({
      data: sessionRow('CONNECTED', { last_connected_at: '2026-01-02T10:00:00.000Z' }),
      error: null,
    });

    const first = await getSession(INSTANCE);
    const second = await getSession(INSTANCE);

    // Mesma instância ⇒ mesma sessão única reutilizada por todos os módulos.
    expect(first).toEqual(second);
    expect(first.instanceId).toBe(INSTANCE);
    expect(first.status).toBe('CONNECTED');
    // Toda leitura passa pela RPC de sessão única, sempre escopada ao instance_id.
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(rpcSpy).toHaveBeenNthCalledWith(1, 'whatsapp_get_session', {
      p_instance_id: INSTANCE,
    });
    expect(rpcSpy).toHaveBeenNthCalledWith(2, 'whatsapp_get_session', {
      p_instance_id: INSTANCE,
    });
  });

  it('getSession (leitura) nunca audita', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('CONNECTED'), error: null });

    await getSession(INSTANCE);

    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('bloqueio de ações quando não CONNECTED (assertConnected)', () => {
  const NON_CONNECTED: SessionStatus[] = ['DISCONNECTED', 'CONNECTING', 'QR_PENDING', 'EXPIRED'];

  function makeSession(status: SessionStatus): WhatsAppSession {
    return {
      instanceId: INSTANCE,
      status,
      qrCode: null,
      lastConnectedAt: null,
      updatedAt: null,
    };
  }

  it.each(NON_CONNECTED)('lança a Canonical_Message quando o status é %s', (status) => {
    expect(() => assertConnected(makeSession(status))).toThrow(
      'Conecte o WhatsApp antes de iniciar o disparo.'
    );
    expect(WHATSAPP_NOT_CONNECTED_MESSAGE).toBe('Conecte o WhatsApp antes de iniciar o disparo.');
  });

  it('é no-op (não lança) quando a sessão está CONNECTED', () => {
    expect(() => assertConnected(makeSession('CONNECTED'))).not.toThrow();
  });
});

describe('auditoria em connect/disconnect (instance_id no log)', () => {
  it('connect audita com action e targetId = instance_id', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('CONNECTING'), error: null });

    await connect(INSTANCE);

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_SESSION_CONNECT',
      targetType: 'whatsapp_sessions',
      targetId: INSTANCE,
    });
    // o instance_id também acompanha o snapshot `after`
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE);
  });

  it('disconnect audita com action e targetId = instance_id', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('DISCONNECTED'), error: null });

    await disconnect(INSTANCE);

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_SESSION_DISCONNECT',
      targetType: 'whatsapp_sessions',
      targetId: INSTANCE,
    });
  });

  it('setSessionStatus audita com action genérica e instance_id', async () => {
    rpcSpy.mockResolvedValue({ data: sessionRow('EXPIRED'), error: null });

    await setSessionStatus(INSTANCE, 'EXPIRED');

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_SESSION_SET_STATUS',
      targetId: INSTANCE,
    });
  });
});

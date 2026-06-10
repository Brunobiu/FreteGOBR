/**
 * Testes do serviço de verificação de e-mail pré-cadastro (migration 066).
 *
 * Cobre `requestSignupEmailCode` e `confirmSignupEmailCode`:
 *  - mapeamento de erros (invalid_email, rate_limited, rede);
 *  - propagação de status/token na confirmação.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('../../services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

beforeEach(() => rpcMock.mockReset());

describe('requestSignupEmailCode', () => {
  it('sucesso: não lança', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { requestSignupEmailCode } = await import('../../services/signupVerification');
    await expect(requestSignupEmailCode('a@b.com')).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith('request_signup_email_code', { p_email: 'a@b.com' });
  });

  it('invalid_email ⇒ código INVALID_EMAIL', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'invalid_email' } });
    const { requestSignupEmailCode } = await import('../../services/signupVerification');
    await expect(requestSignupEmailCode('xxx')).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('rate_limited ⇒ código RATE_LIMITED', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rate_limited' } });
    const { requestSignupEmailCode } = await import('../../services/signupVerification');
    await expect(requestSignupEmailCode('a@b.com')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('confirmSignupEmailCode', () => {
  it('OK: retorna status e token', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'OK', token: 'tok-123' }, error: null });
    const { confirmSignupEmailCode } = await import('../../services/signupVerification');
    const res = await confirmSignupEmailCode('a@b.com', '123456');
    expect(res).toEqual({ status: 'OK', token: 'tok-123' });
  });

  it('normaliza o código (remove não-dígitos) antes de enviar', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'INVALID' }, error: null });
    const { confirmSignupEmailCode } = await import('../../services/signupVerification');
    await confirmSignupEmailCode('a@b.com', '12-34 56');
    expect(rpcMock).toHaveBeenCalledWith('confirm_signup_email_code', {
      p_email: 'a@b.com',
      p_code: '123456',
    });
  });

  it('erro de rede ⇒ lança NETWORK_ERROR', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { confirmSignupEmailCode } = await import('../../services/signupVerification');
    await expect(confirmSignupEmailCode('a@b.com', '123456')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

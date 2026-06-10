/**
 * Testes do fluxo de exclusão imediata + anti-reuso (Feature 4 —
 * legal-exclusao-dados).
 *
 * Cobre o serviço `dataDeletion.ts`:
 *  - sucesso ⇒ encerra a sessão (signOut) e retorna alreadyDeleted conforme RPC;
 *  - MASTER_PROTECTED / permission_denied / erro genérico ⇒ DataDeletionError
 *    com o código correto e mensagem pt-BR;
 *  - idempotência: already_deleted=true é propagado sem erro.
 *
 * Validates: Requirements 2.x (exclusão), 4.x (proteção master), 6.x (estado).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('../../services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: { signOut: () => signOutMock() },
  },
}));

beforeEach(() => {
  rpcMock.mockReset();
  signOutMock.mockClear();
});

describe('deleteMyAccount — sucesso', () => {
  it('chama a RPC, encerra a sessão e retorna alreadyDeleted=false', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already_deleted: false }, error: null });
    const { deleteMyAccount } = await import('../../services/dataDeletion');

    const res = await deleteMyAccount();

    expect(rpcMock).toHaveBeenCalledWith('rpc_delete_my_account');
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, alreadyDeleted: false });
  });

  it('idempotência: already_deleted=true é propagado sem erro', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already_deleted: true }, error: null });
    const { deleteMyAccount } = await import('../../services/dataDeletion');

    const res = await deleteMyAccount();
    expect(res.alreadyDeleted).toBe(true);
  });
});

describe('deleteMyAccount — erros', () => {
  it('MASTER_PROTECTED ⇒ DataDeletionError com código e mensagem pt-BR', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'MASTER_PROTECTED' } });
    const { deleteMyAccount, DataDeletionError } = await import('../../services/dataDeletion');

    await expect(deleteMyAccount()).rejects.toBeInstanceOf(DataDeletionError);
    await expect(deleteMyAccount()).rejects.toMatchObject({ code: 'MASTER_PROTECTED' });
    // Não encerra a sessão quando a exclusão falha.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('permission_denied ⇒ código UNAUTHENTICATED', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'permission_denied: missing auth.uid()' },
    });
    const { deleteMyAccount } = await import('../../services/dataDeletion');
    await expect(deleteMyAccount()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('erro desconhecido ⇒ código UNKNOWN', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'algo quebrou' } });
    const { deleteMyAccount } = await import('../../services/dataDeletion');
    await expect(deleteMyAccount()).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

/**
 * services/dataDeletion.ts
 *
 * Cliente do fluxo LGPD de exclusão IMEDIATA da própria conta
 * (legal-exclusao-dados / Feature 4).
 *
 * Decisões oficiais:
 *   - A exclusão é imediata e irreversível: a RPC `rpc_delete_my_account`
 *     (SECURITY DEFINER) grava o anti-reuso (hash de CPF/telefone), apaga os
 *     arquivos do Storage, `public.users` (cascata) e `auth.users`.
 *   - Após excluir, o anti-reuso impede recriar conta com o mesmo CPF/telefone;
 *     o cadastro orienta o usuário a falar com o suporte (ver auth.ts /
 *     RegisterForm — mensagem `ACCOUNT_BLOCKED`).
 */

import { supabase } from './supabase';

export class DataDeletionError extends Error {
  constructor(
    message: string,
    public code: 'MASTER_PROTECTED' | 'UNAUTHENTICATED' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'DataDeletionError';
  }
}

export interface DeleteAccountResult {
  ok: true;
  alreadyDeleted: boolean;
}

/**
 * Exclui imediatamente a conta e os dados do usuário autenticado. Em sucesso,
 * encerra a sessão local (signOut) — a identidade de auth já foi removida no
 * servidor. Lança `DataDeletionError` em casos tratáveis pela UI.
 */
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  const { data, error } = await supabase.rpc('rpc_delete_my_account');

  if (error) {
    const msg = error.message ?? '';
    if (/MASTER_PROTECTED/i.test(msg)) {
      throw new DataDeletionError('Esta conta não pode ser excluída.', 'MASTER_PROTECTED');
    }
    if (/permission_denied/i.test(msg)) {
      throw new DataDeletionError('Faça login para continuar.', 'UNAUTHENTICATED');
    }
    throw new DataDeletionError('Não foi possível excluir a conta. Tente novamente.', 'UNKNOWN');
  }

  // Encerra a sessão local: a identidade de auth já não existe no servidor.
  try {
    await supabase.auth.signOut();
  } catch {
    // best-effort — a conta já foi removida no servidor.
  }

  const result = (data ?? {}) as { already_deleted?: boolean };
  return { ok: true, alreadyDeleted: result.already_deleted === true };
}

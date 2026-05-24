/**
 * DeleteUserModal - dupla confirmacao para excluir conta.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../services/supabase';
import {
  deleteUser,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type UserRow,
} from '../../../services/admin/users';

interface Props {
  user: UserRow;
  onClose: () => void;
  onDeleted: () => void;
}

export default function DeleteUserModal({ user, onClose, onDeleted }: Props) {
  const [confirmName, setConfirmName] = useState('');
  const [acknowledgeFretes, setAcknowledgeFretes] = useState(false);
  const [activeFretes, setActiveFretes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user.user_type !== 'embarcador') return;
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from('fretes')
        .select('id', { count: 'exact', head: true })
        .eq('embarcador_id', user.id)
        .eq('status', 'ativo');
      if (!cancelled) setActiveFretes(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, user.user_type]);

  const requiresAck = activeFretes > 0;
  const nameMatches = confirmName.trim() === user.name.trim();
  const canSubmit = nameMatches && (!requiresAck || acknowledgeFretes) && !busy;

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      await deleteUser(user.id, {
        confirmedName: confirmName,
        cancelActiveFretes: requiresAck && acknowledgeFretes,
      });
      onDeleted();
    } catch (err) {
      if (err instanceof UsersServiceError) {
        setError(USERS_ERROR_MESSAGES[err.code]);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-red-900/40 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="delete-user-title" className="text-sm font-semibold text-red-300">
            Excluir conta
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
            Esta acao e irreversivel. Todos os dados deste usuario serao removidos.
          </div>

          {requiresAck && (
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={acknowledgeFretes}
                onChange={(e) => setAcknowledgeFretes(e.target.checked)}
                className="mt-1"
              />
              <span>
                Estou ciente de que <strong>{activeFretes}</strong> fretes ativos serao cancelados.
              </span>
            </label>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Para confirmar, digite o nome exato:{' '}
              <span className="text-gray-200">{user.name}</span>
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
            />
          </div>

          {error && (
            <div className="text-sm text-red-400" role="alert">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              {busy ? 'Excluindo...' : 'Confirmar exclusao'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

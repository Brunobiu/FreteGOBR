/**
 * BanUserForm - aba Moderacao do EditUserModal.
 *
 * Banir/desbanir um usuario. Usa banUser/unbanUser do service.
 */

import { useState } from 'react';
import {
  banUser,
  unbanUser,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type UserRow,
} from '../../../services/admin/users';

interface Props {
  user: UserRow;
  onChanged: (updated: UserRow) => void;
  onClose: () => void;
}

const MAX_REASON = 1000;

export default function BanUserForm({ user, onChanged, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBanned = !!user.ban_reason;

  async function handleBan() {
    setError(null);
    if (!reason.trim()) {
      setError('Informe um motivo para o banimento.');
      return;
    }
    setBusy(true);
    try {
      const updated = await banUser(user.id, reason, user.updated_at);
      onChanged(updated);
      onClose();
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

  async function handleUnban() {
    setError(null);
    setBusy(true);
    try {
      const updated = await unbanUser(user.id, user.updated_at);
      onChanged(updated);
      onClose();
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
    <div className="space-y-3">
      <div className="text-xs text-gray-400">
        Status atual:{' '}
        {isBanned ? (
          <span className="text-red-300">Banido</span>
        ) : user.is_active ? (
          <span className="text-green-300">Ativo</span>
        ) : (
          <span className="text-gray-300">Inativo</span>
        )}
      </div>

      {isBanned ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-300">
            Motivo atual: <span className="text-gray-400">{user.ban_reason}</span>
          </p>
          <button
            type="button"
            onClick={handleUnban}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-50"
          >
            {busy ? 'Desbanindo...' : 'Desbanir usuario'}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Motivo do banimento ({reason.length}/{MAX_REASON})
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
              rows={4}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              placeholder="Descreva o motivo do banimento..."
            />
          </div>
          <button
            type="button"
            onClick={handleBan}
            disabled={busy || !reason.trim()}
            className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            {busy ? 'Banindo...' : 'Banir usuario'}
          </button>
        </>
      )}

      {error && (
        <div className="text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

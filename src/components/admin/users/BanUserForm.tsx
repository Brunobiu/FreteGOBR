/**
 * BanUserForm - aba Moderacao do EditUserModal.
 *
 * Banir/desbanir um usuario. Suporta opcionalmente:
 *   - ao banir: adicionar identificadores (phone/cpf/cnpj/email) a blacklist
 *   - ao desbanir: remover entradas de blacklist vinculadas a este usuario
 *
 * Acoes opcionais ficam gated por BLACKLIST_MANAGE.
 */

import { useEffect, useState } from 'react';
import {
  banUser,
  unbanUser,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type BanUserBlacklistItem,
  type UserRow,
} from '../../../services/admin/users';
import { DEFAULT_BLACKLIST_FILTERS, listEntries } from '../../../services/admin/blacklist';
import { useAdminPermission } from '../../../hooks/useAdminPermission';

interface Props {
  user: UserRow;
  onChanged: (updated: UserRow) => void;
  onClose: () => void;
}

const MAX_REASON = 1000;

type IdentifierKey = 'phone' | 'cpf' | 'cnpj' | 'email';

function availableIdentifiers(user: UserRow): Array<{
  key: IdentifierKey;
  label: string;
  value: string;
}> {
  const out: Array<{ key: IdentifierKey; label: string; value: string }> = [];
  if (user.phone) out.push({ key: 'phone', label: 'Telefone', value: user.phone });
  if (user.user_type === 'motorista' && user.cpf) {
    out.push({ key: 'cpf', label: 'CPF', value: user.cpf });
  }
  if (user.user_type === 'embarcador' && user.cnpj) {
    out.push({ key: 'cnpj', label: 'CNPJ', value: user.cnpj });
  }
  if (user.email) out.push({ key: 'email', label: 'E-mail', value: user.email });
  return out;
}

export default function BanUserForm({ user, onChanged, onClose }: Props) {
  const { allowed: canManageBlacklist } = useAdminPermission('BLACKLIST_MANAGE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBanned = !!user.ban_reason;
  const identifiers = availableIdentifiers(user);

  // Modo BAN: checkbox principal + checkboxes individuais
  const [addBlacklist, setAddBlacklist] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<IdentifierKey>>(
    new Set(identifiers.map((i) => i.key))
  );

  // Modo UNBAN: checkbox + contagem
  const [removeBlacklist, setRemoveBlacklist] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);

  // Carrega contagem de entradas ativas vinculadas (apenas no modo unban)
  useEffect(() => {
    if (!isBanned || !canManageBlacklist) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await listEntries({
          ...DEFAULT_BLACKLIST_FILTERS,
          sourceUserId: user.id,
          status: 'ativo',
          pageSize: 1,
        });
        if (!cancelled) setActiveCount(result.total);
      } catch {
        if (!cancelled) setActiveCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBanned, canManageBlacklist, user.id]);

  function toggleKey(key: IdentifierKey) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleBan() {
    setError(null);
    if (!reason.trim()) {
      setError('Informe um motivo para o banimento.');
      return;
    }
    setBusy(true);
    try {
      const items: BanUserBlacklistItem[] =
        addBlacklist && canManageBlacklist
          ? identifiers
              .filter((i) => selectedKeys.has(i.key))
              .map((i) => ({ type: i.key, value: i.value }))
          : [];

      const result = await banUser(user.id, reason, user.updated_at, {
        addToBlacklist: items,
      });
      onChanged(result.user);
      if (result.blacklistResult && items.length > 0) {
        // toast simples

        alert(
          `Usuário banido. ${result.blacklistResult.inserted} entrada(s) adicionada(s) à blacklist, ${result.blacklistResult.skipped} pulada(s), ${result.blacklistResult.failed} falha(s).`
        );
      }
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
      const result = await unbanUser(user.id, user.updated_at, {
        removeBlacklistEntries: removeBlacklist && canManageBlacklist,
      });
      onChanged(result.user);
      if (removeBlacklist && canManageBlacklist) {
        alert(
          `Usuário desbanido. ${result.blacklistRemoved ?? 0} entrada(s) removida(s) da blacklist.`
        );
      }
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
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            Motivo atual: <span className="text-gray-400">{user.ban_reason}</span>
          </p>

          {canManageBlacklist && (
            <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-1">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={removeBlacklist}
                  onChange={(e) => setRemoveBlacklist(e.target.checked)}
                  className="accent-cyan-500"
                />
                Remover entradas de blacklist vinculadas
                {activeCount !== null && (
                  <span className="text-gray-500">
                    ({activeCount} ativa{activeCount === 1 ? '' : 's'})
                  </span>
                )}
              </label>
            </div>
          )}

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

          {canManageBlacklist && identifiers.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={addBlacklist}
                  onChange={(e) => setAddBlacklist(e.target.checked)}
                  className="accent-cyan-500"
                />
                Adicionar identificadores à blacklist
              </label>

              {addBlacklist && (
                <div className="ml-5 space-y-1">
                  {identifiers.map((i) => (
                    <label key={i.key} className="flex items-center gap-2 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(i.key)}
                        onChange={() => toggleKey(i.key)}
                        className="accent-cyan-500"
                      />
                      <span className="text-gray-300">{i.label}:</span>
                      <span className="text-gray-500">{i.value}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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

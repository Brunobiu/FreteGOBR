/**
 * UserBanInfoBlock - mostra dados do banimento quando user.ban_reason existe.
 */

import type { UserRow } from '../../../services/admin/users';

interface Props {
  user: UserRow;
  bannedByName: string | null;
  canUnban: boolean;
  onUnban: () => void;
}

export default function UserBanInfoBlock({ user, bannedByName, canUnban, onUnban }: Props) {
  if (!user.ban_reason) return null;

  return (
    <section className="rounded-lg border border-red-900/40 bg-red-950/20 p-5">
      <h3 className="text-sm font-semibold text-red-300 mb-3">Banimento</h3>
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0">Motivo:</dt>
          <dd className="text-gray-200">{user.ban_reason}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0">Banido em:</dt>
          <dd className="text-gray-300">
            {user.banned_at ? new Date(user.banned_at).toLocaleString('pt-BR') : '—'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0">Por:</dt>
          <dd className="text-gray-300">{bannedByName ?? '—'}</dd>
        </div>
      </dl>
      {canUnban && (
        <button
          type="button"
          onClick={onUnban}
          className="mt-3 px-3 py-1.5 rounded text-xs bg-green-500/20 text-green-200 hover:bg-green-500/30 transition"
        >
          Desbanir usuario
        </button>
      )}
    </section>
  );
}

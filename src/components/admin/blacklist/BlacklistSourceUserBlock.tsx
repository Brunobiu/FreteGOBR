/**
 * BlacklistSourceUserBlock - usuário cuja conta originou a entrada (auto-blacklist
 * no ban). Visível apenas quando sourceUser foi resolvido.
 *
 * Status derivado:
 *   - banned_at != null            ⇒ Banido (vermelho, prioridade)
 *   - is_active === true           ⇒ Ativo (verde)
 *   - is_active === false (sem ban)⇒ Inativo (cinza)
 */

import { Link } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import type { BlacklistSourceUser } from '../../../services/admin/blacklist';

interface Props {
  sourceUser: BlacklistSourceUser | null;
  error?: string;
}

const TYPE_LABEL: Record<BlacklistSourceUser['type'], string> = {
  motorista: 'Motorista',
  embarcador: 'Embarcador',
};

export default function BlacklistSourceUserBlock({ sourceUser, error }: Props) {
  const { allowed: canViewUser } = useAdminPermission('USER_VIEW');

  if (error) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Usuário de origem</h2>
        <div
          role="alert"
          className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300"
        >
          Não foi possível carregar usuário de origem: {error}
        </div>
      </section>
    );
  }

  if (!sourceUser) return null;

  const isBanned = sourceUser.banned_at != null;
  const isActive = !isBanned && sourceUser.is_active;

  let badgeLabel: string;
  let badgeCls: string;
  if (isBanned) {
    badgeLabel = 'Banido';
    badgeCls = 'bg-red-500/15 text-red-300 border-red-500/30';
  } else if (isActive) {
    badgeLabel = 'Ativo';
    badgeCls = 'bg-green-500/15 text-green-300 border-green-500/30';
  } else {
    badgeLabel = 'Inativo';
    badgeCls = 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Usuário de origem</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-gray-500 text-xs">Nome</dt>
          <dd className="text-gray-200">{sourceUser.name}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Tipo</dt>
          <dd className="text-gray-200">{TYPE_LABEL[sourceUser.type]}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Status</dt>
          <dd>
            <span
              className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badgeCls}`}
            >
              {badgeLabel}
            </span>
          </dd>
        </div>
      </dl>

      {canViewUser && (
        <Link
          to={`/admin/users/${sourceUser.id}`}
          className="inline-block mt-3 text-xs text-cyan-400 hover:text-cyan-300"
        >
          Ver perfil →
        </Link>
      )}
    </section>
  );
}

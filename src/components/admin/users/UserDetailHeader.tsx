/**
 * UserDetailHeader - foto, nome, dados basicos e botoes de acao.
 *
 * Visibilidade dos botoes segue Permission_Matrix + checks Master/self.
 */

import { classifyUserStatus, isMasterAdmin, type UserRow } from '../../../services/admin/users';

interface Props {
  user: UserRow;
  selfId: string | null;
  canEdit: boolean;
  canToggleActive: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onResetPassword: () => void;
  onForceLogout: () => void;
  onDelete: () => void;
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  ativo: {
    label: 'Ativo',
    cls: 'bg-green-500/15 text-green-300 border-green-500/30',
  },
  inativo: {
    label: 'Inativo',
    cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  },
  banido: {
    label: 'Banido',
    cls: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
};

export default function UserDetailHeader({
  user,
  selfId,
  canEdit,
  canToggleActive,
  canDelete,
  onEdit,
  onToggleActive,
  onResetPassword,
  onForceLogout,
  onDelete,
}: Props) {
  const status = classifyUserStatus(user);
  const badge = STATUS_BADGES[status];
  const isMaster = isMasterAdmin(user);
  const isSelf = selfId === user.id;
  const initial = (user.name || '?').charAt(0).toUpperCase();

  // Visibility por acao
  const showEdit = canEdit && !isMaster;
  const showToggleActive = canToggleActive && !isMaster && !isSelf;
  const showResetPassword = canEdit && !isMaster;
  const showForceLogout = canEdit && !isMaster && !isSelf;
  const showDelete = canDelete && !isMaster && !isSelf;

  const toggleLabel = user.is_active ? 'Desativar conta' : 'Ativar conta';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 overflow-hidden flex items-center justify-center text-white text-2xl font-semibold shrink-0">
          {user.profile_photo_url ? (
            <img src={user.profile_photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-gray-100 truncate">{user.name}</h2>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
            >
              {badge.label}
            </span>
            {isMaster && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Master
              </span>
            )}
            {isSelf && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Voce
              </span>
            )}
          </div>

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-400">
            <div>
              <span className="text-gray-500">Tipo: </span>
              <span className="capitalize text-gray-300">{user.user_type}</span>
            </div>
            <div>
              <span className="text-gray-500">Telefone: </span>
              <span className="text-gray-300">{user.phone}</span>
            </div>
            <div>
              <span className="text-gray-500">Email: </span>
              <span className="text-gray-300">{user.email ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">
                {user.user_type === 'embarcador' ? 'CNPJ' : 'CPF'}:{' '}
              </span>
              <span className="text-gray-300">
                {user.user_type === 'embarcador' ? (user.cnpj ?? '—') : (user.cpf ?? '—')}
              </span>
            </div>
            {user.user_type === 'embarcador' && (
              <div className="sm:col-span-2">
                <span className="text-gray-500">Razao social: </span>
                <span className="text-gray-300">{user.company_name ?? '—'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Acoes */}
        <div className="flex flex-col gap-2 shrink-0">
          {showEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Editar
            </button>
          )}
          {showToggleActive && (
            <button
              type="button"
              onClick={onToggleActive}
              className={`px-3 py-1.5 rounded text-xs transition ${
                user.is_active
                  ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  : 'bg-green-500/20 text-green-200 hover:bg-green-500/30'
              }`}
            >
              {toggleLabel}
            </button>
          )}
          {showResetPassword && (
            <button
              type="button"
              onClick={onResetPassword}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Reset senha
            </button>
          )}
          {showForceLogout && (
            <button
              type="button"
              onClick={onForceLogout}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Forcar logout
            </button>
          )}
          {showDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 transition"
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

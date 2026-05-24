/**
 * UsersTable - tabela paginada de usuarios com checkboxes de bulk selection.
 */

import { Link } from 'react-router-dom';
import { classifyUserStatus, type UserRow } from '../../../services/admin/users';

interface Props {
  rows: UserRow[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  canSelect: boolean;
  isMasterAdminId: (id: string) => boolean;
  isSelfId: (id: string) => boolean;
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return p;
}

export default function UsersTable({
  rows,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  canSelect,
  isMasterAdminId,
  isSelfId,
}: Props) {
  const selectableIds = rows
    .filter((r) => !isMasterAdminId(r.id) && !isSelfId(r.id))
    .map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900"
      aria-busy={loading}
    >
      <table className="min-w-full text-sm">
        <caption className="sr-only">Lista de usuarios do FreteGO</caption>
        <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
          <tr>
            {canSelect && (
              <th scope="col" className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label="Selecionar todos os usuarios da pagina"
                  className="rounded border-gray-600 bg-gray-700"
                />
              </th>
            )}
            <th scope="col" className="text-left px-3 py-2">
              Usuario
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Tipo
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Telefone
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Status
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Cadastro
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Ultima atividade
            </th>
            <th scope="col" className="text-right px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            rows.length === 0 &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-t border-gray-800">
                <td colSpan={canSelect ? 8 : 7} className="px-3 py-3">
                  <div className="h-4 bg-gray-800 rounded animate-pulse" />
                </td>
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={canSelect ? 8 : 7}
                className="px-3 py-8 text-center text-gray-500"
                role="status"
              >
                Nenhum usuario encontrado com os filtros atuais.
              </td>
            </tr>
          )}
          {rows.map((u) => {
            const status = classifyUserStatus(u);
            const badge = STATUS_BADGES[status];
            const initial = (u.name || '?').charAt(0).toUpperCase();
            const isMaster = isMasterAdminId(u.id);
            const isSelf = isSelfId(u.id);
            const selectable = canSelect && !isMaster && !isSelf;

            return (
              <tr key={u.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                {canSelect && (
                  <td className="px-3 py-2">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => onToggleSelect(u.id)}
                        aria-label={`Selecionar usuario ${u.name}`}
                        className="rounded border-gray-600 bg-gray-700"
                      />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 overflow-hidden flex items-center justify-center text-white text-xs font-semibold shrink-0">
                      {u.profile_photo_url ? (
                        <img
                          src={u.profile_photo_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        initial
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-gray-100 font-medium truncate">{u.name}</div>
                      <div className="text-xs text-gray-500 truncate">{u.email ?? '—'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-400 capitalize">{u.user_type}</td>
                <td className="px-3 py-2 text-gray-400">{formatPhone(u.phone)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {formatDate(u.created_at)}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {formatDate(u.last_activity_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="text-cyan-400 hover:text-cyan-300 text-sm"
                    aria-label={`Abrir detalhe de ${u.name}`}
                  >
                    →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

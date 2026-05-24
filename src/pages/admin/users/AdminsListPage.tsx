/**
 * AdminsListPage - /admin/users/admins
 *
 * Apenas SUPER_ADMIN (gating via ADMIN_ROLE_GRANT).
 * Lista admins, marca Master e self, abre ManageAdminModal.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  countActiveSuperAdmins,
  listAdmins,
  type AdminUserRow,
} from '../../../services/admin/users';
import { subscribeRoleChanges } from '../../../services/admin/roles';
import { useAdminContext } from '../../../components/admin/AdminProvider';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import ManageAdminModal from '../../../components/admin/users/ManageAdminModal';

export default function AdminsListPage() {
  const { allowed } = useAdminPermission('ADMIN_ROLE_GRANT');
  const { session } = useAdminContext();
  const selfId = session?.userId ?? '';

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<AdminUserRow | null>(null);
  const [activeSuperAdmins, setActiveSuperAdmins] = useState(1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rs, count] = await Promise.all([listAdmins(), countActiveSuperAdmins()]);
      setRows(rs);
      setActiveSuperAdmins(count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadAll();
  }, [allowed, loadAll]);

  // Realtime: re-fetch ao receber qualquer mudanca em admin_roles
  useEffect(() => {
    if (!allowed) return;
    const unsub = subscribeRoleChanges(() => {
      void loadAll();
    });
    return unsub;
  }, [allowed, loadAll]);

  if (!allowed) return <Stealth404 />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Administradores</h1>
        <Link to="/admin/users" className="text-sm text-cyan-400 hover:text-cyan-300">
          ← Voltar a usuarios
        </Link>
      </div>

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
            <tr>
              <th scope="col" className="text-left px-3 py-2">
                Nome
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Username
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Papeis ativos
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Status
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Ultimo login
              </th>
              <th scope="col" className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-gray-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-gray-500">
                  Nenhum administrador encontrado.
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-200">{a.name}</span>
                    {a.is_master && (
                      <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        Master
                      </span>
                    )}
                    {a.id === selfId && (
                      <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        Voce
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-400 font-mono text-xs">
                  @{a.admin_username ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {a.roles.length === 0 ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : (
                      a.roles.map((r) => (
                        <span
                          key={r}
                          className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-gray-800 text-gray-300 border border-gray-700"
                        >
                          {r}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {a.is_active ? (
                    <span className="text-green-300 text-xs">Ativo</span>
                  ) : (
                    <span className="text-gray-500 text-xs">Inativo</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {a.last_login_at ? new Date(a.last_login_at).toLocaleDateString('pt-BR') : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setManaging(a)}
                    disabled={a.is_master}
                    className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Gerenciar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {managing && (
        <ManageAdminModal
          admin={managing}
          selfId={selfId}
          totalActiveSuperAdmins={activeSuperAdmins}
          onClose={() => setManaging(null)}
          onChanged={() => void loadAll()}
        />
      )}
    </div>
  );
}

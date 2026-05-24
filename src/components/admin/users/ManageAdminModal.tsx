/**
 * ManageAdminModal - gerenciar papeis de outro admin (apenas SUPER_ADMIN).
 *
 * - Master_Admin: tudo desabilitado (papeis imutaveis)
 * - Last_Super_Admin: SUPER_ADMIN desabilitado
 * - Aplica diff via grantRole/revokeRole
 */

import { useState } from 'react';
import { grantRole, revokeRole } from '../../../services/admin/roles';
import { ADMIN_ACTIONS } from '../../../services/admin/permissions';
import type { AdminRole } from '../../../services/admin/permissions';
import type { AdminUserRow } from '../../../services/admin/users';

const ALL_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];

interface Props {
  admin: AdminUserRow;
  selfId: string;
  totalActiveSuperAdmins: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function ManageAdminModal({
  admin,
  selfId,
  totalActiveSuperAdmins,
  onClose,
  onChanged,
}: Props) {
  const initial = new Set(admin.roles);
  const [selected, setSelected] = useState<Set<AdminRole>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avoid TS unused import warning for ADMIN_ACTIONS — pode ser usado por permissoes futuras
  void ADMIN_ACTIONS;

  const isMaster = admin.is_master;
  const isSelf = admin.id === selfId;
  const isLastSuperAdmin = admin.roles.includes('SUPER_ADMIN') && totalActiveSuperAdmins === 1;

  function toggleRole(role: AdminRole) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function handleApply() {
    setError(null);
    setBusy(true);
    try {
      // Diff: grants (em selected mas nao em initial) e revokes (em initial mas nao em selected)
      const grants: AdminRole[] = [];
      const revokes: AdminRole[] = [];
      for (const r of ALL_ROLES) {
        const wasActive = initial.has(r);
        const isActiveNow = selected.has(r);
        if (!wasActive && isActiveNow) grants.push(r);
        if (wasActive && !isActiveNow) revokes.push(r);
      }

      // Aplica em sequencia (preserva ordem em audit log)
      for (const r of grants) {
        await grantRole(admin.id, r);
      }
      for (const r of revokes) {
        await revokeRole(admin.id, r);
      }

      onChanged();
      onClose();
    } catch (err) {
      const msg = (err as Error).message ?? 'Erro';
      if (msg.includes('last_super_admin_protected')) {
        setError('Nao e possivel revogar o ultimo SUPER_ADMIN.');
      } else if (msg.includes('master_admin_immutable')) {
        setError('Master_Admin e imutavel.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function isCheckboxDisabled(role: AdminRole): boolean {
    if (isMaster) return true;
    if (!admin.is_active && role === 'SUPER_ADMIN') return true;
    if (role === 'SUPER_ADMIN' && isLastSuperAdmin && admin.roles.includes('SUPER_ADMIN'))
      return true;
    return false;
  }

  function tooltipFor(role: AdminRole): string | undefined {
    if (isMaster) return 'Master_Admin: papel imutavel.';
    if (role === 'SUPER_ADMIN' && isLastSuperAdmin && admin.roles.includes('SUPER_ADMIN'))
      return 'Nao e possivel revogar o ultimo SUPER_ADMIN.';
    if (!admin.is_active && role === 'SUPER_ADMIN')
      return 'Reative o admin antes de promovel-o a SUPER_ADMIN.';
    return undefined;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-admin-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="manage-admin-title" className="text-sm font-semibold text-gray-200">
            Gerenciar admin
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
          <div>
            <div className="text-sm font-semibold text-gray-200">
              {admin.name}
              {isSelf && <span className="ml-2 text-[10px] uppercase text-cyan-300">(voce)</span>}
              {isMaster && (
                <span className="ml-2 text-[10px] uppercase text-amber-300">(master)</span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              @{admin.admin_username ?? '—'} · {admin.is_active ? 'ativo' : 'inativo'}
            </div>
          </div>

          {!admin.is_active && (
            <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
              Este admin esta desativado. Reative-o para promover a SUPER_ADMIN.
            </div>
          )}

          <div className="space-y-1">
            {ALL_ROLES.map((role) => {
              const tt = tooltipFor(role);
              const disabled = isCheckboxDisabled(role);
              const checked = selected.has(role);
              return (
                <label
                  key={role}
                  title={tt}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                    disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-gray-800/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleRole(role)}
                  />
                  <span className="text-gray-200">{role}</span>
                </label>
              );
            })}
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
              onClick={handleApply}
              disabled={busy || isMaster}
              className="px-4 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white"
            >
              {busy ? 'Aplicando...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

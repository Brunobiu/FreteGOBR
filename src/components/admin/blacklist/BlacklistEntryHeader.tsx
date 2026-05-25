/**
 * BlacklistEntryHeader - cabeçalho do detalhe da entrada com ações.
 *
 * Visibilidade dos botões:
 *   - Editar / Remover (cyan/red): visíveis apenas quando removed_at IS NULL
 *     E admin tem BLACKLIST_MANAGE.
 *   - Reativar (green): visível apenas quando removed_at IS NOT NULL
 *     E admin tem BLACKLIST_MANAGE.
 *   - Botões são OCULTADOS (não disabled) quando admin não tem permissão.
 */

import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  maskValueForList,
  type BlacklistEntry,
  type BlacklistType,
} from '../../../services/admin/blacklist';

interface Props {
  entry: BlacklistEntry;
  onEdit: () => void;
  onRemove: () => void;
  onReactivate: () => void;
  /** Quando true, exibe o valor integral em vez do mascarado. Default: false. */
  revealed?: boolean;
}

const TYPE_BADGES: Record<BlacklistType, { label: string; cls: string }> = {
  phone: {
    label: 'Telefone',
    cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  cpf: {
    label: 'CPF',
    cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  cnpj: {
    label: 'CNPJ',
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  email: {
    label: 'E-mail',
    cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  ip_address: {
    label: 'IP',
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
};

export default function BlacklistEntryHeader({
  entry,
  onEdit,
  onRemove,
  onReactivate,
  revealed = false,
}: Props) {
  const { allowed: canManage } = useAdminPermission('BLACKLIST_MANAGE');
  const isRemoved = entry.removed_at != null;

  const showEdit = canManage && !isRemoved;
  const showRemove = canManage && !isRemoved;
  const showReactivate = canManage && isRemoved;

  const badge = TYPE_BADGES[entry.type];
  const displayValue = revealed ? entry.value : maskValueForList(entry.type, entry.value);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <span
            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
          >
            {badge.label}
          </span>
          <span className="text-gray-100 font-mono text-sm break-all">{displayValue}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {showEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 rounded text-xs bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 transition"
            >
              Editar
            </button>
          )}
          {showRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 transition"
            >
              Remover
            </button>
          )}
          {showReactivate && (
            <button
              type="button"
              onClick={onReactivate}
              className="px-3 py-1.5 rounded text-xs bg-green-500/20 text-green-200 hover:bg-green-500/30 transition"
            >
              Reativar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

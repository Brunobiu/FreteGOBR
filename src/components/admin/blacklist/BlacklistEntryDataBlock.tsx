/**
 * BlacklistEntryDataBlock - card com os dados completos da entrada.
 *
 * - Valor mascarado por default; para cpf/cnpj exibe botão "Mostrar" para
 *   admins com BLACKLIST_MANAGE (revelação local, sem audit log nesta spec).
 * - Bloco aninhado "Removida" só aparece quando removed_at IS NOT NULL.
 * - Links para perfil do criador / removedor apenas se admin tem USER_VIEW.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  classifyEntryStatus,
  maskValueForList,
  type BlacklistEntry,
  type BlacklistType,
} from '../../../services/admin/blacklist';

interface Props {
  entry: BlacklistEntry;
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

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  ativo: {
    label: 'Ativo',
    cls: 'bg-green-500/15 text-green-300 border-green-500/30',
  },
  expirado: {
    label: 'Expirado',
    cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  },
  removido: {
    label: 'Removido',
    cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  },
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default function BlacklistEntryDataBlock({ entry }: Props) {
  const { allowed: canManage } = useAdminPermission('BLACKLIST_MANAGE');
  const { allowed: canViewUser } = useAdminPermission('USER_VIEW');
  const [revealed, setRevealed] = useState(false);

  const status = classifyEntryStatus(entry);
  const typeBadge = TYPE_BADGES[entry.type];
  const statusBadge = STATUS_BADGES[status];

  const isMaskable = entry.type === 'cpf' || entry.type === 'cnpj';
  const showRevealButton = isMaskable && canManage;
  const displayValue =
    isMaskable && !revealed ? maskValueForList(entry.type, entry.value) : entry.value;

  const isExpired = (() => {
    if (!entry.expires_at) return false;
    const exp = new Date(entry.expires_at);
    return !Number.isNaN(exp.getTime()) && exp.getTime() <= Date.now();
  })();

  const isRemoved = entry.removed_at != null;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Dados da entrada</h2>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-gray-500 text-xs">ID</dt>
          <dd className="text-gray-200 font-mono text-xs break-all">{entry.id}</dd>
        </div>

        <div>
          <dt className="text-gray-500 text-xs">Tipo</dt>
          <dd>
            <span
              className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${typeBadge.cls}`}
            >
              {typeBadge.label}
            </span>
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-gray-500 text-xs">Valor</dt>
          <dd className="text-gray-200 font-mono text-sm flex items-center gap-2 flex-wrap">
            <span className="break-all">{displayValue}</span>
            {showRevealButton && (
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                {revealed ? 'Ocultar' : 'Mostrar'}
              </button>
            )}
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-gray-500 text-xs">Motivo</dt>
          <dd className="text-gray-200 text-sm whitespace-pre-wrap">{entry.reason}</dd>
        </div>

        <div>
          <dt className="text-gray-500 text-xs">Expiração</dt>
          <dd className="text-gray-200 flex items-center gap-2 flex-wrap">
            {entry.expires_at ? (
              <>
                <span>{formatDate(entry.expires_at)}</span>
                {isExpired && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                    Expirada em {formatDate(entry.expires_at)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-400">Permanente</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 text-xs">Status</dt>
          <dd>
            <span
              className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${statusBadge.cls}`}
            >
              {statusBadge.label}
            </span>
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 text-xs">Criado por</dt>
          <dd className="text-gray-200">
            {canViewUser ? (
              <Link
                to={`/admin/users/${entry.created_by}`}
                className="text-cyan-400 hover:text-cyan-300"
              >
                {entry.created_by_name ?? '—'}
              </Link>
            ) : (
              <span>{entry.created_by_name ?? '—'}</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 text-xs">Criado em</dt>
          <dd className="text-gray-200">{formatDateTime(entry.created_at)}</dd>
        </div>
      </dl>

      {isRemoved && (
        <div className="mt-4 rounded border border-red-900/40 bg-red-500/5 p-3">
          <h3 className="text-xs font-semibold text-red-300 mb-2 uppercase tracking-wider">
            Removida
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Removido por</dt>
              <dd className="text-gray-200">
                {entry.removed_by && canViewUser ? (
                  <Link
                    to={`/admin/users/${entry.removed_by}`}
                    className="text-cyan-400 hover:text-cyan-300"
                  >
                    {entry.removed_by_name ?? '—'}
                  </Link>
                ) : (
                  <span>{entry.removed_by_name ?? '—'}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Removido em</dt>
              <dd className="text-gray-200">{formatDateTime(entry.removed_at)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500 text-xs">Motivo da remoção</dt>
              <dd className="text-sm whitespace-pre-wrap">
                {entry.removed_reason ? (
                  <span className="text-gray-200">{entry.removed_reason}</span>
                ) : (
                  <span className="text-gray-500">Sem motivo informado</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

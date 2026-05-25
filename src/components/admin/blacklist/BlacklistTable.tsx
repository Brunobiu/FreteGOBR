/**
 * BlacklistTable - tabela paginada de entradas de blacklist com checkboxes de bulk.
 *
 * Padrão visual herdado de UsersTable: dark theme, badges coloridos por tipo/status,
 * estado vazio com role="status", aria-busy enquanto loading, skeleton de 5 rows.
 */

import { Link } from 'react-router-dom';
import {
  classifyEntryStatus,
  maskValueForList,
  type BlacklistEntry,
  type BlacklistType,
} from '../../../services/admin/blacklist';

interface Props {
  rows: BlacklistEntry[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  canSelect: boolean;
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export default function BlacklistTable({
  rows,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  canSelect,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900"
      aria-busy={loading}
    >
      <table className="min-w-full text-sm">
        <caption className="sr-only">Lista de entradas da blacklist do FreteGO</caption>
        <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
          <tr>
            {canSelect && (
              <th scope="col" className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label="Selecionar todas as entradas da página"
                  className="rounded border-gray-600 bg-gray-700"
                />
              </th>
            )}
            <th scope="col" className="text-left px-3 py-2">
              ID
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Tipo
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Valor
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Motivo
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Criado por
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Criado em
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Expira em
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Status
            </th>
            <th scope="col" className="text-right px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            rows.length === 0 &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-t border-gray-800">
                <td colSpan={canSelect ? 10 : 9} className="px-3 py-3">
                  <div className="h-4 bg-gray-800 rounded animate-pulse" />
                </td>
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={canSelect ? 10 : 9}
                className="px-3 py-8 text-center text-gray-500"
                role="status"
              >
                Nenhuma entrada encontrada com os filtros atuais.
              </td>
            </tr>
          )}
          {rows.map((e) => {
            const status = classifyEntryStatus(e);
            const typeBadge = TYPE_BADGES[e.type];
            const statusBadge = STATUS_BADGES[status];
            const masked = maskValueForList(e.type, e.value);

            return (
              <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                {canSelect && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(e.id)}
                      onChange={() => onToggleSelect(e.id)}
                      aria-label={`Selecionar entrada ${typeBadge.label} ${masked}`}
                      className="rounded border-gray-600 bg-gray-700"
                    />
                  </td>
                )}
                <td className="px-3 py-2 text-gray-400 font-mono text-xs">{e.id.slice(0, 8)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${typeBadge.cls}`}
                  >
                    {typeBadge.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-100 font-mono text-xs">{masked}</td>
                <td className="px-3 py-2 text-gray-400 text-xs" title={e.reason}>
                  {truncate(e.reason, 60)}
                </td>
                <td className="px-3 py-2 text-gray-400 text-xs">{e.created_by_name ?? '—'}</td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {formatDate(e.created_at)}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {formatDate(e.expires_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${statusBadge.cls}`}
                  >
                    {statusBadge.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={`/admin/blacklist/${e.id}`}
                    className="text-cyan-400 hover:text-cyan-300 text-sm"
                    aria-label={`Abrir detalhe da entrada ${typeBadge.label} ${masked}`}
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

/**
 * FretesTable - tabela paginada de fretes com bulk selection.
 */

import { Link } from 'react-router-dom';
import type { FreteRow } from '../../../services/admin/fretes';

interface Props {
  rows: FreteRow[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  canSelect: boolean;
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  ativo: {
    label: 'Ativo',
    cls: 'bg-green-500/15 text-green-300 border-green-500/30',
  },
  encerrado: {
    label: 'Encerrado',
    cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  },
  cancelado: {
    label: 'Cancelado',
    cls: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
};

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

export default function FretesTable({
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
        <caption className="sr-only">Lista de fretes do FreteGO</caption>
        <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
          <tr>
            {canSelect && (
              <th scope="col" className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label="Selecionar todos os fretes da pagina"
                  className="rounded border-gray-600 bg-gray-700"
                />
              </th>
            )}
            <th scope="col" className="text-left px-3 py-2">
              Embarcador
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Origem → Destino
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Carga
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Valor
            </th>
            <th scope="col" className="text-left px-3 py-2">
              Publicado em
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
                <td colSpan={canSelect ? 7 : 6} className="px-3 py-3">
                  <div className="h-4 bg-gray-800 rounded animate-pulse" />
                </td>
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={canSelect ? 7 : 6}
                className="px-3 py-8 text-center text-gray-500"
                role="status"
              >
                Nenhum frete encontrado com os filtros atuais.
              </td>
            </tr>
          )}
          {rows.map((f) => {
            const badge = STATUS_BADGES[f.status];
            return (
              <tr key={f.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                {canSelect && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={() => onToggleSelect(f.id)}
                      aria-label={`Selecionar frete ${f.origin} para ${f.destination}`}
                      className="rounded border-gray-600 bg-gray-700"
                    />
                  </td>
                )}
                <td className="px-3 py-2 text-gray-200 max-w-[180px]">
                  <div className="flex items-center gap-1.5">
                    {f.flagged_for_review && (
                      <span
                        className="text-amber-400 text-xs"
                        aria-label="Sinalizado para revisao"
                        title="Sinalizado para revisao"
                      >
                        ⚑
                      </span>
                    )}
                    <div
                      className="truncate"
                      title={f.embarcador_company_name ?? f.embarcador_name ?? '—'}
                    >
                      {f.embarcador_company_name ?? f.embarcador_name ?? '—'}
                    </div>
                  </div>
                  {f.embarcador_company_name && f.embarcador_name && (
                    <div className="text-xs text-gray-500 truncate" title={f.embarcador_name}>
                      {f.embarcador_name}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-200">
                  <span className="truncate">{f.origin}</span>
                  <span className="text-gray-500 mx-1">→</span>
                  <span className="truncate">{f.destination}</span>
                </td>
                <td className="px-3 py-2 text-gray-400">{f.cargo_type}</td>
                <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{BRL.format(f.value)}</td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {formatDate(f.created_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={`/admin/fretes/${f.id}`}
                    className="text-cyan-400 hover:text-cyan-300 text-sm"
                    aria-label={`Abrir detalhe de ${f.origin} a ${f.destination}`}
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

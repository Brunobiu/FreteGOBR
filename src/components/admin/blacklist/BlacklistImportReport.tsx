/**
 * BlacklistImportReport
 *
 * Relatorio pos-execucao do bulk import. Mostra sumario com inserted/skipped/failed
 * e tabela com linhas que precisam de atencao (skipped + failed).
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  buildImportReportCsv,
  type BulkImportResult,
  type BulkImportRow,
} from '../../../services/admin/blacklist';

interface Props {
  result: BulkImportResult;
  onReset: () => void;
}

function isAttentionRow(r: BulkImportRow): boolean {
  return r.result?.status === 'failed' || r.result?.status === 'skipped';
}

function rowStatusLabel(r: BulkImportRow): string {
  if (!r.result) return r.validation.ok ? 'pendente' : 'inválido';
  if (r.result.status === 'inserted') return 'inserido';
  if (r.result.status === 'skipped') {
    return r.result.reason === 'MASTER_PROTECTED' ? 'pulado (master)' : 'pulado (já existe)';
  }
  return 'falhou';
}

function rowDetail(r: BulkImportRow): string {
  if (!r.validation.ok) return r.validation.detail;
  if (!r.result) return '';
  if (r.result.status === 'inserted') return r.result.id;
  if (r.result.status === 'skipped') {
    if (r.result.reason === 'ALREADY_BLACKLISTED') {
      return r.result.existingId ?? 'identificador já bloqueado';
    }
    return 'master admin protegido';
  }
  return r.result.detail;
}

export default function BlacklistImportReport({ result, onReset }: Props) {
  const attention = useMemo(() => result.rows.filter(isAttentionRow), [result.rows]);

  function handleDownload() {
    const csv = buildImportReportCsv(result.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    a.href = url;
    a.download = `blacklist-import-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
        <div className="text-sm font-semibold text-gray-100 mb-1">Importação concluída</div>
        <div className="text-xs text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
          <span>Total: {result.total}</span>
          <span className="text-emerald-300">Inseridos: {result.inserted}</span>
          <span className="text-amber-300">Pulados: {result.skipped}</span>
          <span className="text-red-300">Falhas: {result.failed}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-400">
          {attention.length === 0
            ? 'Nenhuma linha precisa de atenção.'
            : `${attention.length} linha(s) com atenção (puladas ou falhas).`}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
          >
            Baixar relatório CSV
          </button>
          <button
            type="button"
            onClick={onReset}
            className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700"
          >
            Nova importação
          </button>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="rounded border border-gray-800 overflow-hidden">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Linhas que precisam de atenção</caption>
              <thead className="bg-gray-900 sticky top-0 z-10">
                <tr className="text-gray-300">
                  <th scope="col" className="px-2 py-1 text-left font-medium w-12">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium w-24">
                    Tipo
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Valor
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium w-32">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Detalhe
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium w-24">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {attention.map((r) => {
                  const existingId =
                    r.result?.status === 'skipped' && r.result.reason === 'ALREADY_BLACKLISTED'
                      ? r.result.existingId
                      : undefined;
                  return (
                    <tr key={r.lineNumber} className="border-t border-gray-800">
                      <td className="px-2 py-1 text-gray-400">{r.lineNumber}</td>
                      <td className="px-2 py-1 text-gray-200">{r.raw.type || '—'}</td>
                      <td className="px-2 py-1 text-gray-200 truncate max-w-[16rem]">
                        {r.raw.value || '—'}
                      </td>
                      <td className="px-2 py-1 text-gray-300">{rowStatusLabel(r)}</td>
                      <td className="px-2 py-1 text-gray-400 truncate max-w-[20rem]">
                        {rowDetail(r)}
                      </td>
                      <td className="px-2 py-1">
                        {existingId ? (
                          <Link
                            to={`/admin/blacklist/${existingId}`}
                            className="text-cyan-300 hover:text-cyan-200 underline"
                          >
                            Ver entrada
                          </Link>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * BlacklistImportPreview
 *
 * Pre-visualizacao do CSV importado antes da execucao em massa.
 * Mostra ate as primeiras 1000 linhas com status de validacao client-side.
 */

import { useMemo } from 'react';
import type { BulkImportRow } from '../../../services/admin/blacklist';

interface Props {
  rows: BulkImportRow[];
  onConfirm: () => void;
  onCancel: () => void;
  running?: boolean;
  progress?: { current: number; total: number } | null;
}

const MAX_PREVIEW_ROWS = 1000;

export default function BlacklistImportPreview({
  rows,
  onConfirm,
  onCancel,
  running = false,
  progress = null,
}: Props) {
  const total = rows.length;
  const valid = useMemo(() => rows.filter((r) => r.validation.ok).length, [rows]);
  const invalid = total - valid;
  const truncated = total > MAX_PREVIEW_ROWS;
  const visibleRows = truncated ? rows.slice(0, MAX_PREVIEW_ROWS) : rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-300">
          <span className="font-medium text-gray-100">Total:</span> {total} linhas ·{' '}
          <span className="text-emerald-300">Válidas:</span> {valid} ·{' '}
          <span className="text-red-300">Inválidas:</span> {invalid}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={running}
            className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={running || valid === 0}
            className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            {running
              ? progress
                ? `Processando ${progress.current} de ${progress.total}...`
                : 'Processando...'
              : 'Confirmar importação'}
          </button>
        </div>
      </div>

      {truncated && (
        <div className="rounded bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-200">
          Arquivo excede o limite de {MAX_PREVIEW_ROWS} linhas. Apenas as {MAX_PREVIEW_ROWS}{' '}
          primeiras serão processadas.
        </div>
      )}

      <div className="rounded border border-gray-800 overflow-hidden">
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Pré-visualização do arquivo de importação</caption>
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
                <th scope="col" className="px-2 py-1 text-left font-medium">
                  Motivo
                </th>
                <th scope="col" className="px-2 py-1 text-left font-medium w-32">
                  Expira em
                </th>
                <th scope="col" className="px-2 py-1 text-left font-medium w-48">
                  Validação
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const ok = r.validation.ok;
                return (
                  <tr
                    key={r.lineNumber}
                    className={`border-t border-gray-800 ${ok ? '' : 'bg-red-500/5'}`}
                  >
                    <td className="px-2 py-1 text-gray-400">{r.lineNumber}</td>
                    <td className="px-2 py-1 text-gray-200">{r.raw.type || '—'}</td>
                    <td className="px-2 py-1 text-gray-200 truncate max-w-[16rem]">
                      {r.raw.value || '—'}
                    </td>
                    <td className="px-2 py-1 text-gray-400 truncate max-w-[20rem]">
                      {r.raw.reason || '—'}
                    </td>
                    <td className="px-2 py-1 text-gray-400">{r.raw.expires_at ?? '—'}</td>
                    <td className="px-2 py-1">
                      {ok ? (
                        <span className="text-emerald-300">válido</span>
                      ) : (
                        <span className="text-red-300">
                          {(r.validation as { ok: false; detail: string }).detail}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

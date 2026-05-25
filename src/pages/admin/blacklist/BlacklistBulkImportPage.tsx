/**
 * BlacklistBulkImportPage - /admin/blacklist/bulk
 *
 * Importacao em massa de entradas via CSV. Gated por BLACKLIST_BULK.
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  buildImportTemplateCsv,
  bulkImport,
  parseImportCsv,
  type BulkImportResult,
  type BulkImportRow,
} from '../../../services/admin/blacklist';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import BlacklistImportPreview from '../../../components/admin/blacklist/BlacklistImportPreview';
import BlacklistImportReport from '../../../components/admin/blacklist/BlacklistImportReport';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export default function BlacklistBulkImportPage() {
  const { allowed: canBulk } = useAdminPermission('BLACKLIST_BULK');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<BulkImportRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canBulk) return null;

  function reset() {
    setRows(null);
    setParseErrors([]);
    setRunning(false);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDownloadTemplate() {
    const csv = buildImportTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blacklist-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Arquivo excede 2 MB.');
      setRows(null);
      setParseErrors([]);
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseImportCsv(text);
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
    } catch (err) {
      setError((err as Error).message ?? 'Falha ao ler arquivo.');
      setRows(null);
      setParseErrors([]);
    }
  }

  async function handleConfirm() {
    if (!rows) return;
    setRunning(true);
    setError(null);
    try {
      const r = await bulkImport(rows);
      setResult(r);
    } catch (err) {
      setError((err as Error).message ?? 'Falha na importação.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Link
            to="/admin/blacklist"
            className="text-cyan-300 hover:text-cyan-200 underline text-xs"
          >
            ← Voltar
          </Link>
          <span className="text-gray-500">/</span>
          <span className="text-gray-200">Importar CSV</span>
        </div>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700"
        >
          Baixar modelo CSV
        </button>
      </div>

      {!rows && !result && (
        <div className="rounded border border-gray-800 bg-gray-900/40 p-4 space-y-3">
          <div className="text-sm text-gray-100 font-medium">Selecione um arquivo CSV</div>
          <p className="text-xs text-gray-400">
            Formato esperado: cabeçalho{' '}
            <code className="text-gray-200">type;value;reason;expires_at</code>, separador{' '}
            <code className="text-gray-200">;</code>, codificação UTF-8. Linhas iniciadas com{' '}
            <code className="text-gray-200">#</code> são ignoradas. Limite: 1000 linhas, 2 MB.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void handleFileChange(e)}
            className="block text-xs text-gray-200 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-cyan-500/15 file:text-cyan-300 hover:file:bg-cyan-500/25"
          />
        </div>
      )}

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="rounded bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 space-y-1">
          {parseErrors.map((msg, idx) => (
            <div key={idx}>{msg}</div>
          ))}
        </div>
      )}

      {rows && !result && (
        <BlacklistImportPreview
          rows={rows}
          running={running}
          onCancel={reset}
          onConfirm={() => void handleConfirm()}
        />
      )}

      {result && <BlacklistImportReport result={result} onReset={reset} />}
    </div>
  );
}

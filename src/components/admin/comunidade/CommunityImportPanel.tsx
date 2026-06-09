/**
 * CommunityImportPanel — bloco "Importação" do painel admin.
 *
 * Baixar modelo (CSV BOM UTF-8) → upload do CSV preenchido → parser →
 * abre o Preview editável. spec frete-comunidade (Fase 5 / Req 4.x, 5.x).
 */

import { useRef, useState } from 'react';
import {
  buildModeloPlanilhaCsv,
  parseCommunityCsv,
  type ImportRow,
  type ParseResult,
} from '../../../utils/communitySheet';
import CommunityPreviewTable from './CommunityPreviewTable';
import type { PublishResult } from '../../../services/admin/comunidade';

interface Props {
  canEdit: boolean;
  onPublished: () => void;
}

export default function CommunityImportPanel({ canEdit, onPublished }: Props) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownloadModel = () => {
    const csv = buildModeloPlanilhaCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_frete_comunidade.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setErrors([]);
    setSummary(null);
    setRows(null);
    const text = await file.text();
    const result: ParseResult = parseCommunityCsv(text);
    if (!result.templateOk || result.errors.length > 0) {
      setErrors(result.errors);
      return;
    }
    if (result.truncated) {
      setErrors(['A planilha excede 200 linhas. As linhas extras foram ignoradas.']);
    }
    setRows(result.rows);
  };

  const handlePublished = (result: PublishResult) => {
    setRows(null);
    setSummary(
      `Publicados: ${result.published} · Atualizados: ${result.updated} · ` +
        `Ignorados: ${result.skipped} · Erros: ${result.errors}`
    );
    onPublished();
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Importação por planilha (CSV)</h2>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadModel}
          className="rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200"
        >
          Baixar modelo
        </button>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
            >
              Enviar planilha
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-red-600">
          {errors.map((er, i) => (
            <li key={i}>{er}</li>
          ))}
        </ul>
      )}

      {summary && <p className="mt-2 text-xs text-green-700">{summary}</p>}

      {rows && (
        <div className="mt-4">
          <CommunityPreviewTable initialRows={rows} onPublished={handlePublished} />
        </div>
      )}
    </section>
  );
}

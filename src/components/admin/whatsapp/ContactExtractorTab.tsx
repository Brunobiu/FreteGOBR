/**
 * ContactExtractorTab (task 20.10, Req 17.1-17.10)
 *
 * Extrator de Contatos da Active_Instance: seleciona grupos (GroupSelector),
 * extrai os participantes (`extractContacts`, com degradação parcial) e exibe
 * estatísticas (total/únicos/grupos), dedup opcional entre grupos, a
 * Dispatch_Ready_List (copiar/exportar texto) e o CSV — reusando os helpers
 * puros de `extractor.ts`. Opera só sobre grupos/sessão da Active_Instance.
 *
 * Seleção vazia ⇒ `Selecione ao menos um grupo.`; indisponibilidade total ⇒
 * `Não foi possível concluir a operação.` (tratado pelo service).
 */

import { useMemo, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { extractContacts, type ExtractionResult } from '../../../services/admin/whatsapp/extraction';
import {
  computeExtractionStats,
  buildDispatchReadyList,
  buildExtractedContactsCsv,
} from '../../../services/admin/whatsapp/extractor';
import GroupSelector from './GroupSelector';

interface Props {
  instanceId: string;
}

export default function ContactExtractorTab({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [groups, setGroups] = useState<string[]>([]);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [dedup, setDedup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Estatísticas + Dispatch_Ready_List derivadas (puras) do resultado.
  const stats = useMemo(
    () => (result ? computeExtractionStats(result.contacts, result.analyzedGroups) : null),
    [result]
  );
  const dispatchReadyList = useMemo(
    () => (result ? buildDispatchReadyList(result.contacts.map((c) => c.phone)) : ''),
    [result]
  );

  const handleExtract = async () => {
    setError(null);
    setNotice(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await extractContacts(instanceId, groups);
      setResult(res);
      if (res.failedGroups.length > 0) {
        setNotice(`Extração concluída com ${res.failedGroups.length} grupo(s) indisponível(is).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível extrair os contatos.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!dispatchReadyList) return;
    try {
      await navigator.clipboard?.writeText(dispatchReadyList);
      setNotice('Lista copiada.');
    } catch {
      setError('Não foi possível copiar.');
    }
  };

  const handleExportCsv = () => {
    if (!result) return;
    const { csv, filename } = buildExtractedContactsCsv(result.contacts, { dedupAcrossGroups: dedup });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500">
        Você não tem permissão para extrair contatos nesta instância.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GroupSelector instanceId={instanceId} selected={groups} onChange={setGroups} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleExtract()}
          disabled={busy}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Extraindo...' : 'Extrair contatos'}
        </button>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={dedup}
            onChange={(e) => setDedup(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700"
          />
          Remover duplicados entre grupos
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-yellow-900/40 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-300">
          {notice}
        </div>
      )}

      {result && stats && (
        <div className="space-y-3">
          {/* Estatísticas */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total extraído" value={stats.totalContacts} />
            <Stat label="Únicos" value={stats.uniqueContacts} />
            <Stat label="Grupos analisados" value={stats.analyzedGroups} />
          </div>

          {/* Dispatch_Ready_List */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] uppercase tracking-wider text-gray-500">
                Lista pronta para disparo
              </h4>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!dispatchReadyList}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  Copiar
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700"
                >
                  Exportar CSV
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={dispatchReadyList}
              rows={4}
              className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 font-mono text-[11px] text-gray-100"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-gray-100">{value}</p>
    </div>
  );
}

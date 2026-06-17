/**
 * DraftsList (task 20.13, Req 21.2, 21.5, 21.6)
 *
 * Lista os Drafts (rascunhos) da Active_Instance (`listDrafts`) com data de
 * criação/última edição e resumo (tipo, nº de conteúdos, nº de destinatários) e
 * permite INICIAR um rascunho (`startDraft` → DRAFT→QUEUED, revalidado no
 * backend; lista vazia/Content inválido bloqueiam com a Canonical_Message).
 * Iniciar exige `SETTINGS_EDIT`.
 *
 * A EDIÇÃO completa de um rascunho (recompor Contact_List/Contents) não é
 * recuperável a partir do job (o `list_id` não é persistido no Dispatch_Job) e
 * fica como follow-up — esta lista cobre Req 21.2 (listar) e 21.5/21.6 (iniciar).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { listDrafts, startDraft, type DraftSummary } from '../../../services/admin/whatsapp/drafts';

interface Props {
  instanceId: string;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export default function DraftsList({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDrafts(instanceId)
      .then((rows) => {
        if (!cancelled) setDrafts(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar rascunhos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  const handleStart = async (draft: DraftSummary) => {
    setStartingId(draft.id);
    setError(null);
    setNotice(null);
    try {
      const res = await startDraft(instanceId, draft.id, draft.updatedAt);
      if ('skipped' in res) {
        setNotice('Este rascunho já havia sido iniciado.');
      } else {
        setNotice('Disparo iniciado.');
      }
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível iniciar o rascunho.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Recarregue a página.' : message);
      load();
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500">
          Rascunhos {drafts.length > 0 && `(${drafts.length})`}
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Carregando...' : '↻ Atualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-green-900/40 bg-green-500/10 px-2 py-1 text-[11px] text-green-300">
          {notice}
        </div>
      )}

      {drafts.length === 0 && !loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
          Nenhum rascunho salvo.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {drafts.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 p-2.5"
            >
              <div className="min-w-0">
                <div className="text-xs text-gray-300">
                  {d.kind === 'GROUP' ? 'Grupos' : 'Contatos'} · {d.totalCount} destinatário(s) ·{' '}
                  {d.contentCount} conteúdo(s)
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  Criado {formatDateTime(d.createdAt)} · editado {formatDateTime(d.updatedAt)}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleStart(d)}
                  disabled={startingId === d.id}
                  className="shrink-0 rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {startingId === d.id ? 'Iniciando...' : 'Iniciar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

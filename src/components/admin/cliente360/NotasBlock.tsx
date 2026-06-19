/**
 * NotasBlock — bloco Observacoes internas (Visao 360). Renderizado APENAS com
 * USER_NOTE_VIEW (a pagina gateia; o bundle omite sem a permissao). Controles
 * criar/editar/remover so com USER_NOTE_EDIT. STALE_VERSION => recarrega; skip
 * de remocao => toast neutro. Req 13.6, 13.7, 14.1, 14.4, 14.5.
 */

import { useState } from 'react';
import {
  createNote,
  updateNote,
  deleteNote,
  Cliente360Error,
  type InternalNote,
} from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import NotaEditor from './NotaEditor';
import { fmtDateTime } from './format';

interface Props {
  notas: InternalNote[] | undefined;
  canEdit: boolean;
  userId: string;
  error?: string;
  onRetry: () => void;
  onChanged: () => void;
}

export default function NotasBlock({ notas, canEdit, userId, error, onRetry, onChanged }: Props) {
  const list = notas ?? [];
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function handleError(err: unknown) {
    if (err instanceof Cliente360Error) {
      setMsg(err.message);
      if (err.code === 'STALE_VERSION') onChanged();
    } else {
      setMsg('Não foi possível concluir.');
    }
  }

  async function handleCreate(body: string) {
    setBusy(true);
    setMsg(null);
    try {
      await createNote(userId, body);
      setCreating(false);
      setMsg('Observação adicionada.');
      onChanged();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(note: InternalNote, body: string) {
    setBusy(true);
    setMsg(null);
    try {
      await updateNote(note.id, body, note.updated_at);
      setEditingId(null);
      setMsg('Observação atualizada.');
      onChanged();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(noteId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteNote(noteId);
      setMsg('skipped' in r ? 'Esta nota já estava removida.' : 'Observação removida.');
      onChanged();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Observações internas</h3>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
          >
            Nova observação
          </button>
        )}
      </div>

      {msg && <div className="mb-2 text-xs text-cyan-300">{msg}</div>}

      {canEdit && creating && (
        <div className="mb-3">
          <NotaEditor
            submitLabel="Adicionar"
            busy={busy}
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : list.length === 0 ? (
        <div className="text-xs text-gray-500">Nenhuma observação registrada.</div>
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id} className="py-1 border-b border-gray-800/40 last:border-0">
              {editingId === n.id ? (
                <NotaEditor
                  initialBody={n.body}
                  submitLabel="Salvar"
                  busy={busy}
                  onSubmit={(body) => void handleUpdate(n, body)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{n.body}</p>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-500">
                      {n.author_name ?? 'Autor removido'} · {fmtDateTime(n.created_at)}
                    </span>
                    {canEdit && (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(n.id);
                            setCreating(false);
                          }}
                          className="text-[11px] text-cyan-400 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDelete(n.id)}
                          className="text-[11px] text-red-400 hover:underline disabled:opacity-50"
                        >
                          Remover
                        </button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

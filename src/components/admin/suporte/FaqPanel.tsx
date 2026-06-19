/**
 * FaqPanel — Base de Conhecimento (FAQ). Leitura sob FAQ_VIEW; CRUD sob FAQ_EDIT.
 *
 * Validação no frontend espelha o backend (validation.ts) e é a ÚNICA condição
 * que bloqueia o envio (Req 12.3): envio bloqueado E mensagem pt-BR exibida.
 * STALE_VERSION ⇒ recarrega; remoção idempotente ⇒ toast neutro.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  listFaq,
  createFaq,
  updateFaq,
  deleteFaq,
  SuporteError,
  type FaqEntry,
} from '../../../services/admin/suporte';
import {
  FAQ_CATEGORIES,
  validateFaqQuestion,
  validateFaqAnswer,
  type FaqCategory,
  type FaqPublicationState,
} from '../../../services/admin/suporte/validation';
import DashboardBlockError from '../dashboard/DashboardBlockError';

interface EditorState {
  id: string | null;
  question: string;
  answer: string;
  category: FaqCategory;
  publicationState: FaqPublicationState;
  expectedUpdatedAt: string | null;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  question: '',
  answer: '',
  category: 'geral',
  publicationState: 'rascunho',
  expectedUpdatedAt: null,
};

export default function FaqPanel() {
  const { allowed: canEdit } = useAdminPermission('FAQ_EDIT');
  const [items, setItems] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listFaq({}, 0, 100)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof SuporteError ? err.message : 'Erro ao carregar a FAQ.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  function startCreate() {
    setFormError(null);
    setEditor({ ...EMPTY_EDITOR });
  }

  function startEdit(f: FaqEntry) {
    setFormError(null);
    setEditor({
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: f.category,
      publicationState: f.publicationState,
      expectedUpdatedAt: f.updatedAt,
    });
  }

  async function save() {
    if (!editor) return;
    // Validação frontend espelhando o backend (única condição de bloqueio).
    if (!validateFaqQuestion(editor.question)) {
      setFormError('A pergunta deve ter entre 3 e 300 caracteres.');
      return;
    }
    if (!validateFaqAnswer(editor.answer)) {
      setFormError('A resposta deve ter entre 1 e 5000 caracteres.');
      return;
    }
    setFormError(null);
    try {
      if (editor.id === null) {
        await createFaq({
          question: editor.question,
          answer: editor.answer,
          category: editor.category,
          publicationState: editor.publicationState,
        });
        setNotice('FAQ criada.');
      } else {
        await updateFaq(
          editor.id,
          {
            question: editor.question,
            answer: editor.answer,
            category: editor.category,
            publicationState: editor.publicationState,
          },
          editor.expectedUpdatedAt
        );
        setNotice('FAQ atualizada.');
      }
      setEditor(null);
      load();
    } catch (err) {
      if (err instanceof SuporteError && err.code === 'STALE_VERSION') {
        setNotice('Outro admin atualizou. Recarregando.');
        setEditor(null);
        load();
        return;
      }
      setFormError(err instanceof SuporteError ? err.message : 'Não foi possível salvar.');
    }
  }

  async function remove(f: FaqEntry) {
    try {
      const res = await deleteFaq(f.id);
      setNotice('skipped' in res ? 'Esta FAQ já estava removida.' : 'FAQ removida.');
      load();
    } catch (err) {
      setError(err instanceof SuporteError ? err.message : 'Não foi possível remover.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">{items.length} entrada(s) na Base de Conhecimento</div>
        {canEdit && (
          <button
            type="button"
            onClick={startCreate}
            className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700"
          >
            Nova FAQ
          </button>
        )}
      </div>

      {notice && (
        <div className="text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1">
          {notice}
        </div>
      )}

      {editor && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Pergunta</label>
            <input
              value={editor.question}
              onChange={(e) => setEditor({ ...editor, question: e.target.value })}
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Resposta</label>
            <textarea
              value={editor.answer}
              onChange={(e) => setEditor({ ...editor, answer: e.target.value })}
              rows={4}
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Categoria</label>
              <select
                value={editor.category}
                onChange={(e) => setEditor({ ...editor, category: e.target.value as FaqCategory })}
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Publicação</label>
              <select
                value={editor.publicationState}
                onChange={(e) =>
                  setEditor({ ...editor, publicationState: e.target.value as FaqPublicationState })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="rascunho">Rascunho</option>
                <option value="publicada">Publicada</option>
              </select>
            </div>
          </div>
          {formError && (
            <div className="text-[11px] text-red-400" role="alert">
              {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="text-xs px-2.5 py-1 rounded text-gray-400 hover:text-gray-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {error ? (
        <DashboardBlockError message={error} onRetry={load} />
      ) : loading ? (
        <div className="text-center text-gray-500 text-sm py-6">Carregando FAQ...</div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-6">Nenhuma entrada cadastrada.</p>
      ) : (
        <div className="space-y-2">
          {items.map((f) => (
            <div key={f.id} className="rounded border border-gray-800 bg-gray-900 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-100 font-medium truncate">{f.question}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{f.answer}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">{f.category}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        f.publicationState === 'publicada'
                          ? 'bg-green-500/15 text-green-300 border-green-500/30'
                          : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                      }`}
                    >
                      {f.publicationState}
                    </span>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(f)}
                      className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(f)}
                      className="text-xs px-2.5 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25"
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

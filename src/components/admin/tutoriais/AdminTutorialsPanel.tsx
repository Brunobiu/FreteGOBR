import { useEffect, useState } from 'react';
import {
  listTutorialsAdmin,
  createTutorial,
  updateTutorial,
  deleteTutorial,
  reorderTutorials,
  uploadTutorialVideo,
  type TutorialAudience,
  type TutorialVideo,
  type TutorialSourceType,
} from '../../../services/tutorials';

/**
 * Painel admin para gerenciar vídeos de tutorial de um público
 * (motorista OU embarcador). Permite adicionar vídeo por link do YouTube ou
 * por upload, editar título/descrição, ativar/desativar, reordenar e excluir.
 */
export default function AdminTutorialsPanel({ audience }: { audience: TutorialAudience }) {
  const [items, setItems] = useState<TutorialVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TutorialVideo | null>(null);
  const [reordering, setReordering] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sourceType, setSourceType] = useState<TutorialSourceType>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listTutorialsAdmin(audience));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar tutoriais');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setDescription('');
    setIsActive(true);
    setSourceType('youtube');
    setYoutubeUrl('');
    setFile(null);
    setModalOpen(true);
  };

  const openEdit = (v: TutorialVideo) => {
    setEditing(v);
    setTitle(v.title);
    setDescription(v.description ?? '');
    setIsActive(v.isActive);
    setSourceType(v.sourceType);
    setYoutubeUrl(v.youtubeUrl ?? '');
    setFile(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (editing) {
        // Edição só altera metadados (título/descrição/ativo). Trocar o
        // arquivo/link = criar um novo vídeo (mais simples e seguro).
        await updateTutorial(editing.id, {
          title,
          description: description.trim() || null,
          isActive,
        });
      } else {
        let storagePath: string | null = null;
        if (sourceType === 'upload') {
          if (!file) throw new Error('Selecione um arquivo de vídeo.');
          storagePath = await uploadTutorialVideo(file);
        }
        await createTutorial({
          audience,
          title,
          description: description.trim() || null,
          sourceType,
          youtubeUrl: sourceType === 'youtube' ? youtubeUrl : null,
          storagePath,
          sortOrder: items.length,
          isActive,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (v: TutorialVideo) => {
    if (!confirm(`Excluir o tutorial "${v.title}"?`)) return;
    try {
      await deleteTutorial(v.id, v.storagePath);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  };

  const toggleActive = async (v: TutorialVideo) => {
    try {
      await updateTutorial(v.id, { isActive: !v.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar');
    }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;
    setReordering(true);
    try {
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(newIndex, 0, moved);
      setItems(next.map((it, i) => ({ ...it, sortOrder: i })));
      await reorderTutorials(next.map((it) => it.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao reordenar');
      await load();
    } finally {
      setReordering(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          Vídeos exibidos no Tutorial do {audience === 'motorista' ? 'motorista' : 'embarcador'}.
          Reordene com as setas.
        </p>
        <button
          onClick={openNew}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold"
        >
          + Novo vídeo
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-gray-400">Nenhum vídeo cadastrado para este público.</p>
      ) : (
        <div className="overflow-x-auto bg-gray-800 border border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left w-16">Ordem</th>
                <th className="px-3 py-2 text-left">Título</th>
                <th className="px-3 py-2 text-left w-24">Tipo</th>
                <th className="px-3 py-2 text-left w-24">Status</th>
                <th className="px-3 py-2 text-right w-48">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v, idx) => (
                <tr key={v.id} className="border-t border-gray-700">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0 || reordering}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-40"
                        aria-label="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1 || reordering}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-40"
                        aria-label="Mover para baixo"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-100 font-medium">{v.title}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">
                    {v.sourceType === 'youtube' ? 'YouTube' : 'Upload'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        v.isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {v.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => openEdit(v)}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActive(v)}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                      >
                        {v.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => handleDelete(v)}
                        className="px-2 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded text-xs"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-bold text-gray-100">
              {editing ? 'Editar vídeo' : 'Novo vídeo'}
            </h2>

            {!editing && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Origem do vídeo</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType('youtube')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                      sourceType === 'youtube'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-800 text-gray-300 border border-gray-700'
                    }`}
                  >
                    Link do YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType('upload')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                      sourceType === 'upload'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-800 text-gray-300 border border-gray-700'
                    }`}
                  >
                    Enviar arquivo
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">Título</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                placeholder="Ex: Como completar seu perfil"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Descrição (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm resize-none"
                placeholder="Breve explicação do vídeo"
              />
            </div>

            {!editing && sourceType === 'youtube' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Link do YouTube</label>
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>
            )}

            {!editing && sourceType === 'upload' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Arquivo de vídeo</label>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  required
                  className="w-full text-sm text-gray-300"
                />
                <p className="text-[10px] text-gray-500 mt-1">MP4/WebM/MOV. Limite: 500 MB.</p>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-300">Ativo (visível para o usuário)</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

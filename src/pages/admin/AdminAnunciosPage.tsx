import { useEffect, useState } from 'react';
import {
  listAllAnuncios,
  createAnuncio,
  updateAnuncio,
  deleteAnuncio,
  uploadAnuncioImage,
  type Anuncio,
} from '../../services/anuncios';

export default function AdminAnunciosPage() {
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Anuncio | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listAllAnuncios();
      setAnuncios(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar anúncios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setName('');
    setLinkUrl('');
    setSortOrder(anuncios.length);
    setIsActive(true);
    setFile(null);
    setModalOpen(true);
  };

  const openEdit = (a: Anuncio) => {
    setEditing(a);
    setName(a.name);
    setLinkUrl(a.linkUrl || '');
    setSortOrder(a.sortOrder);
    setIsActive(a.isActive);
    setFile(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let imagePath = editing?.imagePath || '';
      if (file) {
        imagePath = await uploadAnuncioImage(file);
      }
      if (!imagePath) {
        throw new Error('Selecione uma imagem.');
      }
      if (editing) {
        await updateAnuncio(editing.id, {
          name,
          imagePath,
          linkUrl: linkUrl || null,
          sortOrder,
          isActive,
        });
      } else {
        await createAnuncio({
          name,
          imagePath,
          linkUrl: linkUrl || null,
          sortOrder,
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

  const handleDelete = async (a: Anuncio) => {
    if (!confirm(`Deletar o anúncio "${a.name}"?`)) return;
    try {
      await deleteAnuncio(a.id, a.imagePath);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao deletar');
    }
  };

  const toggleActive = async (a: Anuncio) => {
    try {
      await updateAnuncio(a.id, { isActive: !a.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Anúncios</h1>
          <p className="text-sm text-gray-400 mt-1">
            Gerencie os banners exibidos no carrossel do motorista e embarcador.
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold"
        >
          + Novo Anúncio
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Carregando...</p>
      ) : anuncios.length === 0 ? (
        <p className="text-gray-400">Nenhum anúncio cadastrado.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {anuncios.map((a) => (
            <div key={a.id} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <img src={a.imageUrl} alt={a.name} className="w-full aspect-[16/7] object-cover" />
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-100 text-sm">{a.name}</h3>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      a.isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {a.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {a.linkUrl && (
                  <p className="text-[11px] text-gray-500 truncate mb-2">{a.linkUrl}</p>
                )}
                <p className="text-[10px] text-gray-500 mb-3">Ordem: {a.sortOrder}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(a)}
                    className="flex-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActive(a)}
                    className="flex-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                  >
                    {a.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={() => handleDelete(a)}
                    className="px-2 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded text-xs"
                  >
                    Del
                  </button>
                </div>
              </div>
            </div>
          ))}
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
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4"
          >
            <h2 className="text-lg font-bold text-gray-100">
              {editing ? 'Editar Anúncio' : 'Novo Anúncio'}
            </h2>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome interno</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Imagem {editing && '(deixe vazio para manter)'}
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required={!editing}
                className="w-full text-sm text-gray-300"
              />
              {editing && (
                <img
                  src={editing.imageUrl}
                  alt=""
                  className="mt-2 w-full aspect-[16/7] object-cover rounded"
                />
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Link (opcional - quando o usuário clica)
              </label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                maxLength={500}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Ordem</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                />
              </div>
              <label className="flex items-end gap-2 pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-300">Ativo</span>
              </label>
            </div>

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

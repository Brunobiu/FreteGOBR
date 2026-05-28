import { useEffect, useState } from 'react';
import {
  listAllCommodities,
  createCommodity,
  updateCommodity,
  deleteCommodity,
  reorderCommodities,
  uploadCommodityIcon,
  slugifyCommodityName,
  type CommodityCategory,
} from '../../../services/commodities';

/**
 * Painel admin para gerenciar Categorias de Commodities (Soja, Milho, etc.).
 * - CRUD completo (criar, editar, excluir, ativar/desativar)
 * - Reordenacao via setas Up/Down (persiste sort_order no banco)
 * - Upload de icone para o bucket commodity_icons
 *
 * Reflete dinamicamente no carrossel do motorista (HomePage).
 */
export default function AdminCommoditiesPanel() {
  const [items, setItems] = useState<CommodityCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CommodityCategory | null>(null);
  const [reordering, setReordering] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listAllCommodities();
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar categorias');
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
    setSlug('');
    setIsActive(true);
    setFile(null);
    setModalOpen(true);
  };

  const openEdit = (c: CommodityCategory) => {
    setEditing(c);
    setName(c.name);
    setSlug(c.slug);
    setIsActive(c.isActive);
    setFile(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let iconPath = editing?.iconPath || '';
      if (file) {
        iconPath = await uploadCommodityIcon(file);
      }
      const finalSlug = slug.trim() || slugifyCommodityName(name);

      if (editing) {
        await updateCommodity(editing.id, {
          name,
          slug: finalSlug,
          iconPath,
          isActive,
        });
      } else {
        // Novo: vai para o final da lista
        await createCommodity({
          name,
          slug: finalSlug,
          iconPath,
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

  const handleDelete = async (c: CommodityCategory) => {
    if (!confirm(`Excluir a categoria "${c.name}"?`)) return;
    try {
      await deleteCommodity(c.id, c.iconPath || undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  };

  const toggleActive = async (c: CommodityCategory) => {
    try {
      await updateCommodity(c.id, { isActive: !c.isActive });
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
      // Atualiza estado local imediato (otimista)
      setItems(next.map((it, i) => ({ ...it, sortOrder: i })));
      await reorderCommodities(next.map((it) => it.id));
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
          Categorias exibidas no carrossel do motorista. Reordene com as setas.
        </p>
        <button
          onClick={openNew}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold"
        >
          + Nova Categoria
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
        <p className="text-gray-400">Nenhuma categoria cadastrada.</p>
      ) : (
        <div className="overflow-x-auto bg-gray-800 border border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left w-16">Ordem</th>
                <th className="px-3 py-2 text-left w-16">Ícone</th>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Slug</th>
                <th className="px-3 py-2 text-left w-24">Status</th>
                <th className="px-3 py-2 text-right w-56">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, idx) => (
                <tr key={c.id} className="border-t border-gray-700">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0 || reordering}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Mover para cima"
                        title="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1 || reordering}
                        className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Mover para baixo"
                        title="Mover para baixo"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center overflow-hidden">
                      {c.iconUrl ? (
                        <img
                          src={c.iconUrl}
                          alt={c.name}
                          className="w-full h-full object-contain p-1"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-gray-400 text-xs font-bold">
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-100 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{c.slug}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        c.isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {c.isActive ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => openEdit(c)}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActive(c)}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
                      >
                        {c.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
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
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4"
          >
            <h2 className="text-lg font-bold text-gray-100">
              {editing ? 'Editar Categoria' : 'Nova Categoria'}
            </h2>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editing) setSlug(slugifyCommodityName(e.target.value));
                }}
                required
                maxLength={60}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                placeholder="Ex: Soja"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Slug (identificador interno, sem espacos)
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                maxLength={60}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono"
                placeholder="ex: soja"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Apenas letras minusculas, numeros e hifens.
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Ícone {editing && '(deixe vazio para manter)'}
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-300"
              />
              {editing?.iconUrl && !file && (
                <img
                  src={editing.iconUrl}
                  alt=""
                  className="mt-2 w-16 h-16 object-contain rounded bg-gray-800 p-1"
                />
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                Recomendado: PNG transparente, 128x128px. Limite: 5 MB.
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-300">Ativa (visível para o motorista)</span>
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

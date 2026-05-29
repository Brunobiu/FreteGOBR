import { useEffect, useState } from 'react';
import { listBroadcasts, type Broadcast, BroadcastError } from '../../../services/admin/broadcasts';
import BroadcastFormModal from '../broadcasts/BroadcastFormModal';
import { useAdminPermission } from '../../../hooks/useAdminPermission';

const PAGE_SIZE_OPTIONS = [10, 50, 100];

const AUDIENCE_LABEL: Record<string, string> = {
  motorista: 'Motoristas',
  embarcador: 'Embarcadores',
  empresa: 'Empresas',
};

const AUDIENCE_BADGE: Record<string, string> = {
  motorista: 'bg-blue-900/40 text-blue-300',
  embarcador: 'bg-purple-900/40 text-purple-300',
  empresa: 'bg-gray-700 text-gray-400',
};

/**
 * Painel admin de Comunicados — usado dentro da AdminAnunciosPage como
 * a 3ª aba (junto de Anúncios e Categorias).
 *
 * Permissão: `FINANCEIRO_EDIT` (mesma do módulo Anúncios).
 */
export default function AdminBroadcastPanel() {
  const { allowed: canEdit } = useAdminPermission('FINANCEIRO_EDIT');
  const [items, setItems] = useState<Broadcast[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBroadcasts({
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof BroadcastError ? err.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-gray-400">
          Avisos enviados aos usuários (motoristas, embarcadores, empresas).
        </p>
        {canEdit && (
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold"
          >
            + Novo comunicado
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 text-center">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-sm text-gray-400 text-center">Nenhum comunicado enviado ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Título</th>
                <th className="px-3 py-2 text-left">Audiência</th>
                <th className="px-3 py-2 text-left w-28">Destinatários</th>
                <th className="px-3 py-2 text-left w-40">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-t border-gray-700">
                  <td className="px-3 py-2">
                    <p className="text-gray-100 font-medium truncate max-w-md">{b.title}</p>
                    {b.link && (
                      <p className="text-[10px] text-gray-500 truncate max-w-md">→ {b.link}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {b.targetAudience.map((a) => (
                        <span
                          key={a}
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                            AUDIENCE_BADGE[a] ?? 'bg-gray-700 text-gray-400'
                          }`}
                        >
                          {AUDIENCE_LABEL[a] ?? a}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-300">{b.recipientsCount ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">
                    {b.dispatchedAt
                      ? new Date(b.dispatchedAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && items.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-900/40 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <span>Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-200"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
              </span>
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
              >
                ←
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      <BroadcastFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setPage(1);
          load();
        }}
      />
    </div>
  );
}

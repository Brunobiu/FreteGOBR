/**
 * EditFreteModal - editar frete com versionamento otimista.
 */

import { useState } from 'react';
import {
  editFrete,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type EditFretePayload,
  type FreteRow,
} from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  onClose: () => void;
  onSaved: (updated: FreteRow) => void;
  onReload: () => void;
}

export default function EditFreteModal({ frete, onClose, onSaved, onReload }: Props) {
  const [data, setData] = useState<EditFretePayload>({
    origin: frete.origin,
    origin_lat: 0,
    origin_lng: 0,
    destination: frete.destination,
    destination_lat: 0,
    destination_lng: 0,
    cargo_type: frete.cargo_type,
    vehicle_type: frete.vehicle_type,
    weight: frete.weight,
    value: frete.value,
    deadline: frete.deadline,
    loading_time: frete.loading_time,
    unloading_time: frete.unloading_time,
    specifications: frete.specifications,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleVersion, setStaleVersion] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await editFrete(frete.id, data, frete.updated_at);
      onSaved(updated);
    } catch (err) {
      if (err instanceof FretesServiceError) {
        if (err.code === 'STALE_VERSION') {
          setStaleVersion(true);
        } else {
          setError(FRETES_ERROR_MESSAGES[err.code]);
        }
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            Editar frete #{frete.id.slice(0, 8)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 hover:text-white"
          >
            ×
          </button>
        </div>

        {staleVersion ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-amber-300">Os dados foram alterados por outro admin.</p>
            <p className="text-xs text-gray-400">
              Recarregue antes de salvar para ver os dados atuais.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setStaleVersion(false);
                  onReload();
                  onClose();
                }}
                className="px-3 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 text-white"
              >
                Recarregar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <div className="text-xs text-gray-500">
              Embarcador (nao editavel):{' '}
              <span className="text-gray-300">{frete.embarcador_name ?? '—'}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Origem</label>
                <input
                  type="text"
                  value={data.origin}
                  onChange={(e) => setData({ ...data, origin: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Destino</label>
                <input
                  type="text"
                  value={data.destination}
                  onChange={(e) => setData({ ...data, destination: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tipo de carga</label>
                <input
                  type="text"
                  value={data.cargo_type}
                  onChange={(e) => setData({ ...data, cargo_type: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Veiculo</label>
                <input
                  type="text"
                  value={data.vehicle_type}
                  onChange={(e) => setData({ ...data, vehicle_type: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Peso (kg)</label>
                <input
                  type="number"
                  step="0.01"
                  value={data.weight}
                  onChange={(e) => setData({ ...data, weight: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={data.value}
                  onChange={(e) => setData({ ...data, value: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Prazo</label>
                <input
                  type="date"
                  value={data.deadline}
                  onChange={(e) => setData({ ...data, deadline: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Tempos (carga / descarga em min)
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={data.loading_time}
                    onChange={(e) =>
                      setData({ ...data, loading_time: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-1/2 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  />
                  <input
                    type="number"
                    value={data.unloading_time}
                    onChange={(e) =>
                      setData({ ...data, unloading_time: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-1/2 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Especificacoes ({(data.specifications ?? '').length}/2000)
              </label>
              <textarea
                value={data.specifications ?? ''}
                onChange={(e) =>
                  setData({
                    ...data,
                    specifications: e.target.value.slice(0, 2000) || null,
                  })
                }
                rows={3}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              />
            </div>

            {error && (
              <div className="text-sm text-red-400" role="alert">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                autoFocus
                className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white"
              >
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

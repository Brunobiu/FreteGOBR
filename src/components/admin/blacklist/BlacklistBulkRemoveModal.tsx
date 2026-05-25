/**
 * BlacklistBulkRemoveModal - confirmação de bulk remove (até 200).
 *
 * Não chama bulkRemove diretamente — delega via callback onConfirm
 * para que a página possa coordenar progresso e estado.
 */

import { useState } from 'react';

interface Props {
  selectedCount: number;
  onClose: () => void;
  onConfirm: (reason: string | null) => Promise<void>;
}

const REASON_MAX = 1000;
const BULK_LIMIT = 200;

export default function BlacklistBulkRemoveModal({ selectedCount, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overLimit = selectedCount > BULK_LIMIT;
  const canSubmit = !busy && !overLimit && selectedCount > 0 && reason.length <= REASON_MAX;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm(reason.trim() ? reason.trim() : null);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blacklist-bulk-remove-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-red-900/40 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="blacklist-bulk-remove-title" className="text-sm font-semibold text-red-300">
            Remover entradas em massa
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 hover:text-white"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
            Remover <span className="font-semibold">{selectedCount}</span> entradas da blacklist?
            {overLimit && (
              <div className="mt-1 text-xs text-red-200">Máximo de {BULK_LIMIT} por operação.</div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-bulk-remove-reason">
              Motivo aplicado a todas ({reason.length}/{REASON_MAX}) — opcional
            </label>
            <textarea
              id="bl-bulk-remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              rows={3}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              placeholder="Mesmo motivo para todas as entradas..."
              disabled={busy}
            />
          </div>

          {busy && (
            <div className="rounded bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 text-sm text-cyan-200">
              Processando... aguarde.
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400" role="alert">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              autoFocus
              disabled={busy}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-2.5 py-1 rounded text-xs bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              {busy ? 'Removendo...' : 'Confirmar remoção'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * BlacklistRemoveModal - confirmação de soft delete de uma entrada.
 *
 * Idempotente: se a entrada já estava removida (skipped:true,
 * reason:'ALREADY_REMOVED'), exibe toast neutro e fecha.
 */

import { useState } from 'react';
import {
  BLACKLIST_ERROR_MESSAGES,
  BlacklistServiceError,
  maskValueForList,
  removeEntry,
  type BlacklistEntry,
} from '../../../services/admin/blacklist';

interface Props {
  entry: BlacklistEntry;
  onClose: () => void;
  onRemoved: () => void;
}

const REASON_MAX = 1000;

export default function BlacklistRemoveModal({ entry, onClose, onRemoved }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await removeEntry(entry.id, {
        reason: reason.trim() ? reason.trim() : undefined,
      });
      if ('skipped' in result && result.skipped) {
        // eslint-disable-next-line no-alert
        window.alert('Esta entrada já estava removida.');
        onRemoved();
        onClose();
        return;
      }
      onRemoved();
      onClose();
    } catch (err) {
      if (err instanceof BlacklistServiceError) {
        setError(err.message || BLACKLIST_ERROR_MESSAGES[err.code]);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && reason.length <= REASON_MAX;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blacklist-remove-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-red-900/40 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="blacklist-remove-title" className="text-sm font-semibold text-red-300">
            Remover entrada da blacklist
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

        <div className="p-5 space-y-3">
          <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
            <div>
              Confirmar remoção (soft delete) de:{' '}
              <span className="font-mono">{maskValueForList(entry.type, entry.value)}</span>{' '}
              <span className="text-red-200/70">({entry.type})</span>
            </div>
            <div className="text-xs text-red-200/70 mt-1">
              A entrada deixará de bloquear logins/cadastros, mas o histórico permanece.
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-remove-reason">
              Motivo da remoção ({reason.length}/{REASON_MAX}) — opcional
            </label>
            <textarea
              id="bl-remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              rows={3}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              placeholder="Justifique se desejar..."
            />
          </div>

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
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white"
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

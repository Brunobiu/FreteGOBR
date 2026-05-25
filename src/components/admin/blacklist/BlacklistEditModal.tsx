/**
 * BlacklistEditModal - editar reason e expires_at de uma entrada ativa.
 *
 * Tipo e Valor em readonly (imutáveis após criação).
 * Versionamento otimista via expectedUpdatedAt:
 *   - STALE_VERSION   ⇒ banner com botão "Recarregar" que fecha o modal
 *   - ALREADY_REMOVED ⇒ banner "Esta entrada foi removida. Recarregue a página."
 *                       e desabilita salvar
 */

import { useState } from 'react';
import {
  BLACKLIST_ERROR_MESSAGES,
  BlacklistServiceError,
  maskValueForList,
  updateEntry,
  type BlacklistEntry,
} from '../../../services/admin/blacklist';

interface Props {
  entry: BlacklistEntry;
  expectedUpdatedAt: string;
  onClose: () => void;
  onSaved: (updatedAt: string) => void;
}

const REASON_MAX = 1000;

function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function BlacklistEditModal({ entry, expectedUpdatedAt, onClose, onSaved }: Props) {
  const [reason, setReason] = useState(entry.reason);
  const [expiresAt, setExpiresAt] = useState(isoToDateInput(entry.expires_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [alreadyRemoved, setAlreadyRemoved] = useState(false);

  const trimmedReason = reason.trim();
  const canSubmit =
    trimmedReason.length > 0 && trimmedReason.length <= REASON_MAX && !busy && !alreadyRemoved;

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const expiresIso = expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null;
      const result = await updateEntry(
        entry.id,
        { reason: trimmedReason, expiresAt: expiresIso },
        expectedUpdatedAt
      );
      onSaved(result.updated_at);
      onClose();
    } catch (err) {
      if (err instanceof BlacklistServiceError) {
        if (err.code === 'STALE_VERSION') {
          setStale(true);
        } else if (err.code === 'ALREADY_REMOVED') {
          setAlreadyRemoved(true);
        } else {
          setError(err.message || BLACKLIST_ERROR_MESSAGES[err.code]);
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
      aria-labelledby="blacklist-edit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="blacklist-edit-title" className="text-sm font-semibold text-gray-200">
            Editar entrada da blacklist
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

        {stale ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-amber-300" role="alert">
              Os dados foram alterados por outro admin. Recarregue antes de salvar.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 rounded text-xs bg-cyan-500 hover:bg-cyan-600 text-white"
              >
                Recarregar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tipo (somente leitura)</label>
                <input
                  type="text"
                  value={entry.type}
                  readOnly
                  className="w-full px-3 py-2 rounded bg-gray-800/50 border border-gray-700 text-sm text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Valor (somente leitura)</label>
                <input
                  type="text"
                  value={maskValueForList(entry.type, entry.value)}
                  readOnly
                  className="w-full px-3 py-2 rounded bg-gray-800/50 border border-gray-700 text-sm text-gray-400 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-edit-reason">
                Motivo ({reason.length}/{REASON_MAX})
              </label>
              <textarea
                id="bl-edit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
                rows={4}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-edit-expires">
                Expira em
              </label>
              <div className="flex gap-2">
                <input
                  id="bl-edit-expires"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => setExpiresAt('')}
                  className="px-2.5 py-1 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
                  title="Tornar permanente"
                >
                  Limpar
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Vazio = bloqueio permanente.</p>
            </div>

            {alreadyRemoved && (
              <div
                className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-200"
                role="alert"
              >
                Esta entrada foi removida. Recarregue a página.
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
                className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-2.5 py-1 rounded text-xs bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white"
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

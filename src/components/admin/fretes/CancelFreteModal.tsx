/**
 * CancelFreteModal - motivo obrigatorio 1..1000.
 */

import { useState } from 'react';
import {
  cancelFrete,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type FreteRow,
} from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  onClose: () => void;
  onCancelled: () => void;
}

const MAX = 1000;

export default function CancelFreteModal({ frete, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX && !busy;

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await cancelFrete(frete.id, reason);
      onCancelled();
    } catch (err) {
      if (err instanceof FretesServiceError) {
        setError(FRETES_ERROR_MESSAGES[err.code]);
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
      aria-labelledby="cancel-frete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="cancel-frete-title" className="text-sm font-semibold text-gray-200">
            Cancelar frete
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
          <p className="text-sm text-gray-400">Cancelar este frete? Esta acao requer um motivo.</p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Motivo ({reason.length}/{MAX})
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX))}
              rows={4}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              placeholder="Descreva o motivo do cancelamento..."
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
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              {busy ? 'Cancelando...' : 'Cancelar frete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

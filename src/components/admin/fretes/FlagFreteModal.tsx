/**
 * FlagFreteModal - sinalizar (com motivo) ou remover sinalizacao.
 */

import { useState } from 'react';
import {
  flagFrete,
  unflagFrete,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type FreteRow,
} from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  mode: 'flag' | 'unflag';
  onClose: () => void;
  onChanged: () => void;
}

const MAX = 500;

export default function FlagFreteModal({ frete, mode, onClose, onChanged }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFlag = mode === 'flag';
  const trimmed = reason.trim();
  const canSubmit = isFlag ? trimmed.length > 0 && trimmed.length <= MAX && !busy : !busy;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      if (isFlag) {
        await flagFrete(frete.id, reason);
      } else {
        await unflagFrete(frete.id);
      }
      onChanged();
      onClose();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            {isFlag ? 'Sinalizar frete para revisao' : 'Remover sinalizacao'}
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
          {isFlag ? (
            <>
              <p className="text-sm text-gray-400">
                Marque este frete para revisao por outros admins. Status do frete nao muda.
              </p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Motivo ({reason.length}/{MAX})
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, MAX))}
                  rows={3}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Remover sinalizacao deste frete?</p>
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
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white"
            >
              {busy ? 'Aplicando...' : isFlag ? 'Sinalizar' : 'Remover sinalizacao'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

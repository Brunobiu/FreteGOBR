/**
 * ModerateContentModal - confirma substituicao por placeholder.
 */

import { useState } from 'react';
import {
  moderateSpecifications,
  SPECIFICATIONS_PLACEHOLDER,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type FreteRow,
} from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  onClose: () => void;
  onModerated: () => void;
}

export default function ModerateContentModal({ frete, onClose, onModerated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await moderateSpecifications(frete.id);
      onModerated();
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
            Moderar conteudo de Especificacoes
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
          <p className="text-sm text-gray-400">
            Substituir o conteudo de Especificacoes por placeholder de moderacao?
          </p>

          <div>
            <div className="text-xs text-gray-500 mb-1">Conteudo atual:</div>
            <div className="rounded bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-gray-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {frete.specifications || '—'}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Sera substituido por:</div>
            <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200 font-mono">
              {SPECIFICATIONS_PLACEHOLDER}
            </div>
          </div>

          <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200">
            ⚠ O conteudo original ficara registrado no audit log.
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
              disabled={busy}
              className="px-4 py-1.5 rounded text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white"
            >
              {busy ? 'Aplicando...' : 'Moderar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * DeleteFreteModal - dupla confirmacao (digitar EXCLUIR).
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../services/supabase';
import {
  deleteFrete,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type FreteRow,
} from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  onClose: () => void;
  onDeleted: (clicksDeleted: number) => void;
}

export default function DeleteFreteModal({ frete, onClose, onDeleted }: Props) {
  const [keyword, setKeyword] = useState('');
  const [clicksCount, setClicksCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from('frete_clicks')
        .select('id', { count: 'exact', head: true })
        .eq('frete_id', frete.id);
      if (!cancelled) setClicksCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [frete.id]);

  const canSubmit = keyword === 'EXCLUIR' && !busy;

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      const r = await deleteFrete(frete.id, { confirmedKeyword: 'EXCLUIR' });
      onDeleted(r.clicksDeleted);
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
      aria-labelledby="delete-frete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-red-900/40 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="delete-frete-title" className="text-sm font-semibold text-red-300">
            ⚠ Excluir frete permanentemente
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
            Esta acao e IRREVERSIVEL. O frete e todos os <strong>{clicksCount}</strong> cliques de
            motoristas serao removidos permanentemente.
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Para confirmar, digite EXCLUIR no campo abaixo:
            </label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 font-mono"
              placeholder="EXCLUIR"
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
              onClick={() => void handleDelete()}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              {busy ? 'Excluindo...' : 'Confirmar exclusao'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

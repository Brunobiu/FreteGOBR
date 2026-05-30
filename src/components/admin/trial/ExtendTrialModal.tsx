/**
 * ExtendTrialModal - estende manualmente o `trial_ends_at` de um motorista.
 *
 * Padroes da casa (admin-patterns.md):
 *   - Modal controlado por `open` (early-return quando fechado), tema dark do
 *     AdminShell, estilo compacto (`text-xs px-2.5 py-1`).
 *   - Versionamento otimista: captura o `updated_at` da linha ao ABRIR e reenvia
 *     esse valor para `extendTrial` (Req 11.2). Se outro admin alterou o
 *     registro nesse meio-tempo, o servidor responde `STALE_VERSION` (Req 11.3):
 *     exibimos "Outro admin atualizou. Recarregando." e disparamos o refetch.
 *   - Master Admin imutavel (`admin_username === 'Nexus_Vortex99'`): botao de
 *     envio desabilitado (Req 11.5); o servidor tambem aborta antes do touch.
 *   - Validacao client-side de data futura (Req 11.1); o servidor reaplica
 *     (`INVALID_INPUT`).
 *
 * Em sucesso: feedback de sucesso + `onSuccess()` (refetch da pagina) + fecha.
 * Em erro mapeado (`TrialServiceError`): exibe a mensagem canonica
 * (`TRIAL_ERROR_MESSAGES`).
 */

import { useEffect, useRef, useState } from 'react';
import {
  extendTrial,
  TRIAL_ERROR_MESSAGES,
  TrialServiceError,
  type TrialMotoristaRow,
} from '../../../services/admin/trial';

interface Props {
  row: TrialMotoristaRow | null;
  open: boolean;
  onClose: () => void;
  /** Dispara o refetch da listagem na pagina (apos sucesso ou STALE_VERSION). */
  onSuccess: () => void;
}

const MASTER_ADMIN_USERNAME = 'Nexus_Vortex99';

/** Texto canonico de STALE_VERSION (admin-patterns.md §3). */
const STALE_VERSION_MESSAGE = 'Outro admin atualizou. Recarregando.';

/** Tempo que o feedback fica visivel antes de fechar o modal. */
const FEEDBACK_CLOSE_MS = 1400;

/** Converte ISO -> valor de `<input type="date">` (YYYY-MM-DD). */
function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD de hoje + N dias (para `min`/default do date picker). */
function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Constroi o ISO de expiracao (fim do dia UTC) a partir do valor do date input. */
function dateInputToIso(dateValue: string): string {
  return new Date(`${dateValue}T23:59:59Z`).toISOString();
}

type Feedback = { tone: 'success' | 'stale'; msg: string };

export default function ExtendTrialModal({ row, open, onClose, onSuccess }: Props) {
  const [dateValue, setDateValue] = useState('');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMaster = row?.admin_username === MASTER_ADMIN_USERNAME;
  const minDate = todayPlusDays(1);

  // Snapshot do estado ao abrir: captura `updated_at` (versionamento otimista)
  // e pre-preenche o date picker com a expiracao atual (ou amanha).
  useEffect(() => {
    if (open && row) {
      setExpectedUpdatedAt(row.updated_at);
      setDateValue(isoToDateInput(row.trial_ends_at) || todayPlusDays(30));
      setBusy(false);
      setError(null);
      setFeedback(null);
      setTimeout(() => dateRef.current?.focus(), 50);
    }
  }, [open, row]);

  // Limpa o timer de fechamento ao desmontar.
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (!open || !row) return null;

  const isFutureDate =
    dateValue !== '' && new Date(dateInputToIso(dateValue)).getTime() > Date.now();
  const canSubmit = isFutureDate && !busy && !isMaster && feedback === null;

  function scheduleClose() {
    closeTimer.current = setTimeout(() => {
      onClose();
    }, FEEDBACK_CLOSE_MS);
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!row) return;
    setError(null);

    if (!isFutureDate) {
      setError('A nova data deve ser futura.');
      return;
    }

    setBusy(true);
    try {
      await extendTrial(row.id, dateInputToIso(dateValue), expectedUpdatedAt);
      setFeedback({ tone: 'success', msg: 'Trial estendido com sucesso.' });
      onSuccess();
      scheduleClose();
    } catch (err) {
      if (err instanceof TrialServiceError) {
        if (err.code === 'STALE_VERSION') {
          // Outro admin alterou o registro: avisa, refetch e fecha.
          setFeedback({ tone: 'stale', msg: STALE_VERSION_MESSAGE });
          onSuccess();
          scheduleClose();
        } else {
          setError(TRIAL_ERROR_MESSAGES[err.code]);
          setBusy(false);
        }
      } else {
        setError((err as Error).message);
        setBusy(false);
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-trial-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="extend-trial-title" className="text-sm font-semibold text-gray-200">
            Estender trial
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

        {feedback ? (
          <div className="p-5">
            <div
              role="status"
              aria-live="polite"
              className={`rounded px-3 py-2 text-sm border ${
                feedback.tone === 'success'
                  ? 'bg-green-500/10 border-green-500/30 text-green-200'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}
            >
              {feedback.msg}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <div>
              <p className="text-xs text-gray-400">Motorista</p>
              <p className="text-sm text-gray-100 font-medium truncate">{row.name || '—'}</p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="extend-trial-date">
                Nova data de expiração
              </label>
              <input
                ref={dateRef}
                id="extend-trial-date"
                type="date"
                value={dateValue}
                min={minDate}
                onChange={(e) => setDateValue(e.target.value)}
                disabled={isMaster}
                required
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 disabled:opacity-50"
              />
              <p className="text-[10px] text-gray-500 mt-1">A nova data deve ser futura.</p>
            </div>

            {isMaster && (
              <div
                className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200"
                role="alert"
              >
                O Master Admin é imutável. Não é possível estender o trial.
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
                className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-2.5 py-1 rounded text-xs bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                title={isMaster ? 'Master Admin é imutável' : 'Estender trial'}
              >
                {busy ? 'Salvando...' : 'Estender'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * BlacklistAddModal - adicionar entrada manual à blacklist.
 *
 * Aplica blacklistNormalize + blacklistValidate antes de chamar addEntry.
 * Trata 3 casos especiais:
 *   - ALREADY_BLACKLISTED + extra.removed === false ⇒ banner com link "Ver entrada existente"
 *   - ALREADY_BLACKLISTED + extra.removed === true  ⇒ banner com botão "Reativar" (chama reactivateEntry)
 *   - MASTER_PROTECTED                              ⇒ erro inline
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addEntry,
  blacklistNormalize,
  blacklistValidate,
  BLACKLIST_ERROR_MESSAGES,
  BlacklistServiceError,
  getBlacklistDetail,
  reactivateEntry,
  type BlacklistAddPayload,
  type BlacklistType,
} from '../../../services/admin/blacklist';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string) => void;
}

const TYPE_OPTIONS: { value: BlacklistType; label: string; placeholder: string }[] = [
  { value: 'phone', label: 'Telefone', placeholder: '11999998888' },
  { value: 'cpf', label: 'CPF', placeholder: '00000000000' },
  { value: 'cnpj', label: 'CNPJ', placeholder: '00000000000000' },
  { value: 'email', label: 'E-mail', placeholder: 'exemplo@dominio.com' },
  { value: 'ip_address', label: 'IP', placeholder: '192.168.0.1' },
];

const REASON_MAX = 1000;

function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function BlacklistAddModal({ open, onClose, onAdded }: Props) {
  const navigate = useNavigate();

  const [type, setType] = useState<BlacklistType>('phone');
  const [valueRaw, setValueRaw] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState(''); // YYYY-MM-DD
  const [sourceUserId, setSourceUserId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateActive, setDuplicateActive] = useState<{ id: string } | null>(null);
  const [duplicateRemoved, setDuplicateRemoved] = useState<{ id: string } | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setType('phone');
      setValueRaw('');
      setReason('');
      setExpiresAt('');
      setSourceUserId('');
      setError(null);
      setDuplicateActive(null);
      setDuplicateRemoved(null);
      setBusy(false);
    }
  }, [open]);

  // Limpa valor ao trocar tipo
  useEffect(() => {
    setValueRaw('');
  }, [type]);

  if (!open) return null;

  const placeholder = TYPE_OPTIONS.find((t) => t.value === type)?.placeholder ?? '';

  const trimmedReason = reason.trim();
  const canSubmit = valueRaw.trim().length > 0 && trimmedReason.length > 0 && !busy;

  function buildPayload(): BlacklistAddPayload {
    return {
      type,
      valueRaw,
      reason: trimmedReason,
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null,
      sourceUserId: sourceUserId.trim() || null,
    };
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setDuplicateActive(null);
    setDuplicateRemoved(null);

    // Validação local
    const normalized = blacklistNormalize(type, valueRaw);
    const validation = blacklistValidate(type, normalized);
    if (!validation.ok) {
      setError(validation.detail);
      return;
    }

    setBusy(true);
    try {
      const payload = buildPayload();
      const { id } = await addEntry(payload);
      onAdded(id);
      onClose();
    } catch (err) {
      if (err instanceof BlacklistServiceError) {
        if (err.code === 'ALREADY_BLACKLISTED') {
          const existingId = (err.extra?.existingId as string | undefined) ?? null;
          const removed = Boolean(err.extra?.removed);
          if (existingId && removed) {
            setDuplicateRemoved({ id: existingId });
          } else if (existingId) {
            setDuplicateActive({ id: existingId });
          } else {
            setError(BLACKLIST_ERROR_MESSAGES[err.code]);
          }
        } else if (err.code === 'MASTER_PROTECTED') {
          setError(BLACKLIST_ERROR_MESSAGES.MASTER_PROTECTED);
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

  async function handleReactivate() {
    if (!duplicateRemoved) return;
    setBusy(true);
    setError(null);
    try {
      // Captura expectedUpdatedAt via fetch do detalhe
      const bundle = await getBlacklistDetail(duplicateRemoved.id);
      const payload = buildPayload();
      await reactivateEntry(
        duplicateRemoved.id,
        { reason: payload.reason, expiresAt: payload.expiresAt },
        bundle.entry.updated_at
      );
      onClose();
      // Toast simples via alert; a página pode exibir um toast melhor.
      // eslint-disable-next-line no-alert
      window.alert('Entrada reativada.');
      navigate(`/admin/blacklist/${duplicateRemoved.id}`);
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blacklist-add-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="blacklist-add-title" className="text-sm font-semibold text-gray-200">
            Adicionar entrada à blacklist
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

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-add-type">
                Tipo
              </label>
              <select
                id="bl-add-type"
                value={type}
                onChange={(e) => setType(e.target.value as BlacklistType)}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-add-value">
                Valor
              </label>
              <input
                id="bl-add-value"
                type="text"
                value={valueRaw}
                onChange={(e) => setValueRaw(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-add-reason">
              Motivo ({reason.length}/{REASON_MAX})
            </label>
            <textarea
              id="bl-add-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              rows={4}
              className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              placeholder="Descreva o motivo do bloqueio..."
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-add-expires">
                Expira em (opcional)
              </label>
              <input
                id="bl-add-expires"
                type="date"
                min={tomorrowIso()}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="bl-add-source">
                Identificador de origem (UUID)
              </label>
              <input
                id="bl-add-source"
                type="text"
                value={sourceUserId}
                onChange={(e) => setSourceUserId(e.target.value)}
                placeholder="opcional"
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 font-mono"
              />
            </div>
          </div>

          {duplicateActive && (
            <div
              className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-200"
              role="alert"
            >
              Já existe entrada ativa para este identificador.{' '}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/admin/blacklist/${duplicateActive.id}`);
                }}
                className="underline hover:text-amber-100"
              >
                Ver entrada existente
              </button>
            </div>
          )}

          {duplicateRemoved && (
            <div
              className="rounded bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 text-sm text-cyan-200 space-y-2"
              role="alert"
            >
              <div>
                Existe uma entrada anterior removida para este identificador. Deseja reativar?
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void handleReactivate()}
                  disabled={busy}
                  className="px-3 py-1 rounded text-xs bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white"
                >
                  {busy ? 'Reativando...' : 'Reativar'}
                </button>
              </div>
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
              {busy ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

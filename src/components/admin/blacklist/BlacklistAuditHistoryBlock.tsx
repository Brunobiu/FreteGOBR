/**
 * BlacklistAuditHistoryBlock - histórico de mudanças administrativas
 * (criação, edição, remoção, reativação) da entrada.
 *
 * Bloco inteiro gated por AUDIT_VIEW: se admin não tem essa permissão,
 * o componente não renderiza nada.
 *
 * Limite de 50 registros já é aplicado pelo service; sem paginação aqui.
 * Botão "Ver detalhes" abre modal interno com before_data/after_data
 * formatados em JSON.
 */

import { useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import type { BlacklistAuditEntry } from '../../../services/admin/blacklist';

interface Props {
  rows: BlacklistAuditEntry[];
  error?: string;
}

const ACTION_LABELS: Record<string, string> = {
  BLACKLIST_CREATED: 'Adicionada',
  BLACKLIST_UPDATED: 'Editada',
  BLACKLIST_REMOVED: 'Removida',
  BLACKLIST_REACTIVATED: 'Reativada',
  BLACKLIST_CREATED_SKIPPED: 'Adição pulada',
  BLACKLIST_REMOVED_SKIPPED: 'Remoção pulada',
  BLACKLIST_UPDATE_STALE_VERSION: 'Edição rejeitada (concorrência)',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface DetailsModalProps {
  entry: BlacklistAuditEntry;
  onClose: () => void;
}

function DetailsModal({ entry, onClose }: DetailsModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blacklist-audit-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="blacklist-audit-detail-title" className="text-sm font-semibold text-gray-200">
            {actionLabel(entry.action)} · {formatDateTime(entry.created_at)}
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

        <div className="p-5 overflow-y-auto space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Antes
            </h4>
            <pre className="text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {entry.before_data === null || entry.before_data === undefined
                ? '—'
                : safeStringify(entry.before_data)}
            </pre>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Depois
            </h4>
            <pre className="text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {entry.after_data === null || entry.after_data === undefined
                ? '—'
                : safeStringify(entry.after_data)}
            </pre>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BlacklistAuditHistoryBlock({ rows, error }: Props) {
  const { allowed: canViewAudit } = useAdminPermission('AUDIT_VIEW');
  const [selected, setSelected] = useState<BlacklistAuditEntry | null>(null);

  if (!canViewAudit) return null;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">
        Histórico de Mudanças ({rows.length})
      </h2>

      {error && (
        <div
          role="alert"
          className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300 mb-3"
        >
          {error}
        </div>
      )}

      {!error && rows.length === 0 && (
        <div className="text-xs text-gray-500" role="status">
          Sem mudanças registradas.
        </div>
      )}

      {!error && rows.length > 0 && (
        <ul className="space-y-2 text-sm">
          {rows.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 flex-wrap border-b border-gray-800/40 pb-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-cyan-300 text-xs font-medium">{actionLabel(e.action)}</span>
                  <span className="text-gray-500 text-xs">{formatDateTime(e.created_at)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">por {e.admin_name ?? '—'}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(e)}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                Ver detalhes
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <DetailsModal entry={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

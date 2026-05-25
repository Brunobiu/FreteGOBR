/**
 * BlacklistAttemptsBlock - tentativas bloqueadas (login/signup/email)
 * vinculadas à entrada. Bloco inteiro gated por AUDIT_VIEW: se o admin
 * não tem essa permissão, o componente não renderiza nada.
 *
 * Paginação controlada (server-side) via props page/total/onPageChange.
 */

import { useAdminPermission } from '../../../hooks/useAdminPermission';
import type { BlacklistAttempt } from '../../../services/admin/blacklist';

interface Props {
  rows: BlacklistAttempt[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  error?: string;
}

const ACTION_LABELS: Record<BlacklistAttempt['action'], string> = {
  BLACKLIST_LOGIN_BLOCKED: 'Login bloqueado',
  BLACKLIST_SIGNUP_BLOCKED: 'Cadastro bloqueado',
  BLACKLIST_EMAIL_BLOCKED: 'E-mail bloqueado',
};

const UA_TRUNC = 60;

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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export default function BlacklistAttemptsBlock({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  error,
}: Props) {
  const { allowed: canViewAudit } = useAdminPermission('AUDIT_VIEW');
  if (!canViewAudit) return null;

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4 mb-3">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Tentativas Bloqueadas ({total})</h2>

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
          Nenhuma tentativa registrada.
        </div>
      )}

      {!error && rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-3 py-2">
                    Data/hora
                  </th>
                  <th scope="col" className="text-left px-3 py-2">
                    Ação
                  </th>
                  <th scope="col" className="text-left px-3 py-2">
                    IP
                  </th>
                  <th scope="col" className="text-left px-3 py-2">
                    User-Agent
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-800">
                    <td className="px-3 py-2 text-gray-300 text-xs whitespace-nowrap">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-xs">{ACTION_LABELS[r.action]}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs font-mono">{r.ip ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">
                      {r.user_agent ? (
                        <span title={r.user_agent}>{truncate(r.user_agent, UA_TRUNC)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 mt-3 text-xs text-gray-400">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={!canPrev}
                className="px-2.5 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={!canNext}
                className="px-2.5 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Próximo
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

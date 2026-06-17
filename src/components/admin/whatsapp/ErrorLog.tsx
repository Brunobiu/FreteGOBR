/**
 * ErrorLog (task 20.14, Req 23.2, 23.3, 23.8)
 *
 * Lista os Dispatch_Recipients `FAILED` de um Dispatch_Job (Contact_Number +
 * `failure_reason` em pt-BR, sem segredos) via `getErrorLog`, e oferece
 * "Reenviar apenas os que falharam" (`resendFailed`) — que cria um novo job só
 * com os FAILED da origem, preservando os SENT. Componente reutilizável por job.
 *
 * Mutação (reenvio) exige `SETTINGS_EDIT`. Sem nenhum FAILED, o reenvio retorna
 * skip (`NO_FAILED_RECIPIENTS`) e exibimos um aviso neutro.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { getErrorLog, type ErrorLogEntry } from '../../../services/admin/whatsapp/errorLog';
import { resendFailed } from '../../../services/admin/whatsapp/dispatch';

interface Props {
  instanceId: string;
  jobId: string;
}

export default function ErrorLog({ instanceId, jobId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getErrorLog(instanceId, jobId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, jobId]);

  useEffect(() => load(), [load]);

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await resendFailed(instanceId, jobId);
      if ('skipped' in res) {
        setNotice('Nenhum contato falhou para reenviar.');
      } else {
        setNotice('Reenvio criado e enfileirado.');
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reenviar.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] uppercase tracking-wider text-gray-500">
          Falhas {entries.length > 0 && `(${entries.length})`}
        </h4>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {loading ? '...' : '↻'}
          </button>
          {canEdit && entries.length > 0 && (
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resending}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              {resending ? 'Reenviando...' : 'Reenviar apenas os que falharam'}
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-500" role="status">
          Nenhuma falha registrada.
        </div>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {entries.map((e) => (
            <li
              key={e.recipientId}
              className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px]"
            >
              <span className="font-mono text-gray-300">{e.contactNumber ?? '—'}</span>
              <span className="ml-2 text-red-300">{e.failureReason ?? 'Falha no envio.'}</span>
            </li>
          ))}
        </ul>
      )}

      {notice && <div className="text-[11px] text-green-300">{notice}</div>}
      {error && (
        <div className="text-[11px] text-red-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

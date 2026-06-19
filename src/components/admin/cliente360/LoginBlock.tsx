/**
 * LoginBlock — bloco Historico de login (Visao 360). SEMPRE visivel (nao gated;
 * USER_VIEW). Tentativas (sucesso/falha) por data desc; placeholder quando o
 * Cliente nao tem telefone; nota de retencao ~30 dias. Req 12.3, 12.5, 12.6, 12.7.
 */

import type { LoginHistory } from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { fmtDateTime } from './format';

interface Props {
  login: LoginHistory | null;
  error?: string;
  onRetry: () => void;
}

export default function LoginBlock({ login, error, onRetry }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Histórico de login</h3>
      <p className="text-[11px] text-gray-500 mb-3">
        Baseado em tentativas de login; retenção de aproximadamente {login?.retentionDays ?? 30} dias.
      </p>

      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : !login ? (
        <div className="text-xs text-gray-500">Sem dados de login.</div>
      ) : !login.hasPhone ? (
        <div className="text-xs text-gray-500">Sem telefone cadastrado para correlacionar logins.</div>
      ) : login.attempts.length === 0 ? (
        <div className="text-xs text-gray-500">
          Nenhuma tentativa registrada na janela de retenção.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left font-semibold py-1">Quando</th>
                <th className="text-left font-semibold py-1">Resultado</th>
                <th className="text-left font-semibold py-1">Motivo</th>
                <th className="text-left font-semibold py-1">IP</th>
                <th className="text-left font-semibold py-1">User-agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/40">
              {login.attempts.map((a, i) => (
                <tr key={`${a.created_at}-${i}`}>
                  <td className="py-1 text-gray-300 whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                  <td className="py-1">
                    <span className={a.success ? 'text-emerald-400' : 'text-red-400'}>
                      {a.success ? 'Sucesso' : 'Falha'}
                    </span>
                  </td>
                  <td className="py-1 text-gray-400">{a.failure_reason ?? '—'}</td>
                  <td className="py-1 text-gray-400 font-mono">{a.ip_address ?? '—'}</td>
                  <td className="py-1 text-gray-500 truncate max-w-[220px]" title={a.user_agent ?? ''}>
                    {a.user_agent ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

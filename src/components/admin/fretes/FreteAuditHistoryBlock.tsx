/**
 * FreteAuditHistoryBlock - histórico de mudanças (gated por AUDIT_VIEW).
 */

import type { FreteAuditEntry } from '../../../services/admin/fretes';

interface Props {
  entries: FreteAuditEntry[];
  error?: string;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

export default function FreteAuditHistoryBlock({ entries, error }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Historico de mudancas ({entries.length})
      </h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar historico.</div>}
      {entries.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhuma alteracao administrativa registrada.</div>
      )}
      <ul className="space-y-2 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="border-b border-gray-800/40 pb-2 last:border-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-cyan-300 font-mono text-xs">{e.action}</span>
              <span className="text-xs text-gray-500">{fmtDateTime(e.created_at)}</span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              por {e.admin_name ?? e.admin_id.slice(0, 8)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

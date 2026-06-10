/**
 * SubscriptionsTable — tabela de assinaturas do painel admin.
 *
 * Segue o padrão desktop-table + mobile-cards do projeto (`<768px` vira lista
 * de cards single-column). Estilo compacto (admin-patterns / project-conventions):
 * badges por status, estado vazio com role="status", skeleton no loading.
 *
 * Somente leitura — sem ações de mutação (transições são do webhook/cron).
 */

import {
  formatPlan,
  formatMethod,
  formatStatus,
  formatDate,
  type SubscriptionRow,
  type SubscriptionStatus,
} from '../../../services/admin/subscriptions';

const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  pending: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  active: 'bg-green-500/15 text-green-300 border-green-500/30',
  past_due: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  suspended: 'bg-red-500/15 text-red-300 border-red-500/30',
  canceled: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
};

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[status]}`}
    >
      {formatStatus(status)}
    </span>
  );
}

interface Props {
  rows: SubscriptionRow[];
  loading: boolean;
}

export default function SubscriptionsTable({ rows, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-gray-800/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="rounded border border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-500"
      >
        Nenhuma assinatura no filtro atual.
      </div>
    );
  }

  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden md:block overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Motorista</th>
              <th className="px-3 py-2 text-left font-medium">Plano</th>
              <th className="px-3 py-2 text-left font-medium">Pagamento</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Próx. cobrança</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-800/40">
                <td className="px-3 py-2">
                  <div className="text-gray-100">{r.user_name ?? '—'}</div>
                  <div className="text-[11px] text-gray-500">{r.user_phone ?? '—'}</div>
                </td>
                <td className="px-3 py-2 text-gray-300">
                  {formatPlan(r.plan)}
                  {r.auto_recurring && (
                    <span className="ml-1 text-[10px] text-cyan-300">· auto</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-300">{formatMethod(r.payment_method)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-gray-400 text-xs">{formatDate(r.next_charge_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded border border-gray-800 bg-gray-900/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-gray-100 truncate">{r.user_name ?? '—'}</div>
                <div className="text-[11px] text-gray-500">{r.user_phone ?? '—'}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-gray-400">
              <div>
                Plano: <span className="text-gray-300">{formatPlan(r.plan)}</span>
              </div>
              <div>
                Pgto: <span className="text-gray-300">{formatMethod(r.payment_method)}</span>
              </div>
              <div className="col-span-2">
                Próx. cobrança:{' '}
                <span className="text-gray-300">{formatDate(r.next_charge_at)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

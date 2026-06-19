/**
 * PlanoBlock — bloco Plano atual + Data de cadastro (Visao 360).
 * Rotulo derivado de users; enriquecido com subscriptions quando ha
 * FINANCEIRO_VIEW (o service injeta plan/payment_method/next_charge_at).
 * Req 8.2, 8.3, 8.4, 8.5, 8.6.
 */

import type { PlanoLabel } from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { fmtDate } from './format';

function planoLabel(p: PlanoLabel): string {
  if (p.is_subscribed) return 'Assinante';
  if (p.trial_ends_at && new Date(p.trial_ends_at).getTime() > Date.now()) return 'Em teste';
  if (p.subscription_status && p.subscription_status !== 'none') return `Status: ${p.subscription_status}`;
  return 'Sem plano';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-gray-800/40 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="text-sm text-gray-200 text-right">{value}</span>
    </div>
  );
}

interface Props {
  plano: PlanoLabel | null;
  createdAt: string;
  error?: string;
  onRetry: () => void;
}

export default function PlanoBlock({ plano, createdAt, error, onRetry }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Plano e cadastro</h3>
      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : !plano ? (
        <div className="text-xs text-gray-500">Sem dados de plano.</div>
      ) : (
        <div>
          <Row label="Cadastrado em" value={fmtDate(createdAt)} />
          <Row label="Plano" value={planoLabel(plano)} />
          {plano.plan ? (
            <>
              <Row label="Assinatura" value={plano.plan} />
              {plano.payment_method && <Row label="Pagamento" value={plano.payment_method} />}
              {plano.status && <Row label="Situação" value={plano.status} />}
              {plano.next_charge_at && <Row label="Próxima cobrança" value={fmtDate(plano.next_charge_at)} />}
              {plano.grace_ends_at && <Row label="Carência até" value={fmtDate(plano.grace_ends_at)} />}
            </>
          ) : (
            !plano.is_subscribed && (
              <div className="mt-2 text-xs text-gray-500">Sem assinatura paga registrada.</div>
            )
          )}
        </div>
      )}
    </section>
  );
}

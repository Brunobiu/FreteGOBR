/**
 * OperacaoKpiGrid — grid dos onze KPIs operacionais agrupados por fonte.
 *
 * Partial_Degradation: um grupo presente em `bundle.errors` renderiza um
 * DashboardBlockError isolado (com "Tentar novamente") sem derrubar os demais
 * grupos. Skeleton no primeiro carregamento; erro global quando não há bundle.
 */

import DashboardBlockError from '../dashboard/DashboardBlockError';
import DashboardBlockSkeleton from '../dashboard/DashboardBlockSkeleton';
import OperacaoKpiCard from './OperacaoKpiCard';
import type {
  OperationsMetricsBundle,
  OperationsGroupKey,
  OperationsKpiKey,
} from '../../../services/admin/operacao';

const GROUP_ORDER: OperationsGroupKey[] = ['users', 'subscriptions', 'tickets', 'messages'];

const GROUP_LABEL: Record<OperationsGroupKey, string> = {
  users: 'Usuários',
  subscriptions: 'Assinaturas',
  tickets: 'Suporte',
  messages: 'Mensagens (WhatsApp)',
};

const GROUP_KPIS: Record<OperationsGroupKey, OperationsKpiKey[]> = {
  users: ['USERS_TOTAL', 'USERS_ONLINE', 'SIGNUPS_TODAY'],
  subscriptions: ['SUBSCRIPTIONS_ACTIVE', 'SUBSCRIPTIONS_EXPIRED'],
  tickets: ['TICKETS_OPEN', 'TICKETS_IN_PROGRESS', 'TICKETS_RESOLVED'],
  messages: ['MESSAGES_SENT', 'MESSAGES_SCHEDULED', 'MESSAGES_ERROR'],
};

const KPI_LABEL: Record<OperationsKpiKey, string> = {
  USERS_TOTAL: 'Usuários totais',
  USERS_ONLINE: 'Usuários online',
  SIGNUPS_TODAY: 'Cadastros hoje',
  SUBSCRIPTIONS_ACTIVE: 'Assinaturas ativas',
  SUBSCRIPTIONS_EXPIRED: 'Assinaturas expiradas',
  TICKETS_OPEN: 'Tickets abertos',
  TICKETS_IN_PROGRESS: 'Tickets em andamento',
  TICKETS_RESOLVED: 'Tickets resolvidos',
  MESSAGES_SENT: 'Enviadas hoje',
  MESSAGES_SCHEDULED: 'Agendadas',
  MESSAGES_ERROR: 'Com erro hoje',
};

interface Props {
  bundle?: OperationsMetricsBundle;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}

export default function OperacaoKpiGrid({ bundle, loading, error, onRetry }: Props) {
  if (loading && !bundle) {
    return (
      <div
        data-testid="operacao-kpi-skeleton"
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <DashboardBlockSkeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (error || !bundle) {
    return <DashboardBlockError message={error} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      {GROUP_ORDER.map((group) => (
        <section key={group} data-group={group}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            {GROUP_LABEL[group]}
          </div>
          {bundle.errors[group] ? (
            <DashboardBlockError message={bundle.errors[group]} onRetry={onRetry} className="h-20" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {GROUP_KPIS[group].map((key) => (
                <OperacaoKpiCard key={key} label={KPI_LABEL[key]} kpi={bundle.kpis[key]} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

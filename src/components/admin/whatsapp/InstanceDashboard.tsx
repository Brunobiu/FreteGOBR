/**
 * InstanceDashboard (task 20.3, Req 19.1, 19.6, 19.7)
 *
 * Cards de KPI compactos da Active_Instance: conexão, enviadas hoje, em
 * andamento, agendadas, concluídos hoje, com erro, fila atual, respostas
 * recebidas e atendimentos ativos — todos por `instance_id` via `getDashboard`.
 * Oferece atualização manual (Req 19.7). O tempo real (Req 19.6) entra na
 * task 21 (hooks de realtime); aqui o refresh é manual/sob demanda.
 *
 * Estilo compacto do painel admin: cards label `text-[10px] uppercase`, valor
 * `text-base sm:text-lg font-semibold`. Em falha de leitura, exibe
 * `DashboardBlockError` com retry (degradação ao nível do bloco).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getDashboard,
  type InstanceDashboard as DashboardData,
  type WhatsAppConnectionStatus,
} from '../../../services/admin/whatsapp/dashboard';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { useRealtimeDispatch } from '../../../hooks/useRealtimeDispatch';

interface Props {
  instanceId: string;
}

const CONNECTION_LABEL: Record<WhatsAppConnectionStatus, { label: string; tone: string }> = {
  CONNECTED: { label: 'Conectado', tone: 'text-green-400' },
  CONNECTING: { label: 'Conectando', tone: 'text-yellow-400' },
  QR_PENDING: { label: 'Aguardando QR', tone: 'text-yellow-400' },
  EXPIRED: { label: 'Expirado', tone: 'text-orange-400' },
  DISCONNECTED: { label: 'Desconectado', tone: 'text-red-400' },
};

export default function InstanceDashboard({ instanceId }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getDashboard(instanceId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  // Tempo real (Req 19.6) + fallback de polling (Req 19.7): reflete mudanças
  // de jobs/recipients/sessão/conversas/mensagens da instância no dashboard.
  useRealtimeDispatch(instanceId, load);

  if (error) {
    return <DashboardBlockError message="Não foi possível carregar o painel." onRetry={load} />;
  }

  const conn = data ? CONNECTION_LABEL[data.connectionStatus] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-gray-500">Visão geral</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Atualizando...' : '↻ Atualizar'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-busy={loading}>
        <KpiCard label="Conexão" value={conn?.label ?? '—'} valueClass={conn?.tone} />
        <KpiCard label="Enviadas hoje" value={fmt(data?.sentToday)} />
        <KpiCard label="Em andamento" value={fmt(data?.inProgress)} />
        <KpiCard label="Agendadas" value={fmt(data?.scheduled)} />
        <KpiCard label="Concluídos hoje" value={fmt(data?.completedToday)} />
        <KpiCard label="Com erro" value={fmt(data?.errored)} tone={data && data.errored > 0 ? 'error' : undefined} />
        <KpiCard label="Na fila" value={fmt(data?.queueCurrent)} />
        <KpiCard label="Respostas hoje" value={fmt(data?.repliesReceived)} />
        <KpiCard label="Atendimentos ativos" value={fmt(data?.activeConversations)} />
      </div>
    </div>
  );
}

/** Formata um contador (— enquanto carrega). */
function fmt(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

function KpiCard({
  label,
  value,
  valueClass,
  tone,
}: {
  label: string;
  value: string;
  valueClass?: string;
  tone?: 'error';
}) {
  return (
    <div
      className={`rounded-lg border bg-gray-900 p-2.5 ${
        tone === 'error' ? 'border-red-900/40' : 'border-gray-800'
      }`}
      role="region"
      aria-label={`${label}: ${value}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p
        className={`mt-0.5 truncate text-base font-semibold sm:text-lg ${
          valueClass ?? (tone === 'error' ? 'text-red-300' : 'text-gray-100')
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * InstancePanel (task 20.1, Req 2.1-2.3, 29.2)
 *
 * Painel data-driven das WhatsApp_Instances: itera as instâncias CONFIGURADAS
 * (sem número fixo — Max_Instances é o COUNT de linhas habilitadas) e permite
 * selecionar a Active_Instance. Cada instância exibe o status de conexão
 * (🟢 Conectado / 🔴 Desconectado) derivado da sessão única.
 *
 * Componente PRESENTACIONAL: recebe a lista, a Active_Instance e o callback de
 * seleção; o carregamento fica na página (que compartilha a Active_Instance com
 * o ConnectionCard e o InstanceDashboard). Estilo compacto dark do painel admin.
 */

import type { WhatsAppInstance, WhatsAppInstanceStatus } from '../../../services/admin/whatsapp/instances';

interface Props {
  instances: WhatsAppInstance[];
  activeInstanceId: string | null;
  onSelect: (instanceId: string) => void;
  loading?: boolean;
}

/** Apresentação do status de conexão por instância (Req 2.2). */
const STATUS_PRESENTATION: Record<
  WhatsAppInstanceStatus,
  { label: string; dot: string; text: string }
> = {
  CONNECTED: { label: 'Conectado', dot: 'bg-green-400', text: 'text-green-400' },
  CONNECTING: { label: 'Conectando', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  QR_PENDING: { label: 'Aguardando QR', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  EXPIRED: { label: 'Expirado', dot: 'bg-orange-400', text: 'text-orange-400' },
  DISCONNECTED: { label: 'Desconectado', dot: 'bg-red-400', text: 'text-red-400' },
};

export default function InstancePanel({ instances, activeInstanceId, onSelect, loading }: Props) {
  if (loading && instances.length === 0) {
    return (
      <div className="flex gap-2" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 w-40 animate-pulse rounded-lg border border-gray-800 bg-gray-900" />
        ))}
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
        Nenhuma instância de WhatsApp configurada.
      </div>
    );
  }

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Instâncias de WhatsApp"
    >
      {instances.map((inst) => {
        const presentation = STATUS_PRESENTATION[inst.status] ?? STATUS_PRESENTATION.DISCONNECTED;
        const active = inst.id === activeInstanceId;
        return (
          <button
            key={inst.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(inst.id)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left transition ${
              active
                ? 'border-green-500/40 bg-green-500/10'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${presentation.dot}`} aria-hidden="true" />
              <span className="text-[13px] font-semibold text-gray-100">{inst.label}</span>
            </div>
            <div className={`mt-0.5 text-[10px] uppercase tracking-wider ${presentation.text}`}>
              {presentation.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

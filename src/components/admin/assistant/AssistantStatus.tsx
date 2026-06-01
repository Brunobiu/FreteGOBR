/**
 * AssistantStatus.tsx
 *
 * Painel de status em tempo real do modulo Assistente (Assistant_Status).
 * Exibe (Req 7.6):
 *   - se o assistente esta ativo ou inativo;
 *   - o Active_Provider e o modelo em uso;
 *   - os ultimos Critical_Event detectados.
 *
 * O assistente e considerado INATIVO quando o Active_Provider nao tem chave
 * de API definida (`is_set` falso / `active` falso). Nesse caso, exibe
 * orientacao para configurar a chave nas Configuracoes (Req 7.7).
 *
 * Padrao compacto pos-cleanup: sem <h1> grande; `text-xs`; coluna unica.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getStatus,
  type AssistantStatus as AssistantStatusView,
  type CriticalEvent,
  type Severity,
} from '../../../services/admin/assistant';

/** Rotulos pt-BR de severidade. */
const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  warning: 'Atenção',
  critical: 'Crítico',
};

/** Classes de badge por severidade. */
const SEVERITY_BADGE: Record<Severity, string> = {
  info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Rotulos pt-BR por tipo de evento critico. */
const EVENT_TYPE_LABEL: Record<CriticalEvent['eventType'], string> = {
  page_error_rate: 'Erros de página',
  request_failure_rate: 'Falhas de requisição',
  unauthorized_access_attempt: 'Acesso não autorizado',
  failed_login_burst: 'Rajada de falhas de login',
  payment_failure: 'Falha de pagamento',
  db_performance_drop: 'Queda de desempenho do banco',
};

/** Formata timestamp ISO como `dd/MM HH:mm`; invalido => '—'. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AssistantStatus() {
  const [status, setStatus] = useState<AssistantStatusView | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await getStatus();
      setStatus(data);
    } catch {
      setLoadError(true);
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <section
        data-block="assistant_status"
        aria-label="Status do assistente"
        className="rounded-lg border border-gray-800 bg-gray-900 p-3"
      >
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Status</h3>
        <div role="alert" className="text-xs text-red-300 py-2">
          Não foi possível carregar o status do assistente.
        </div>
      </section>
    );
  }

  if (!status) {
    return (
      <section
        data-block="assistant_status"
        aria-label="Status do assistente"
        className="rounded-lg border border-gray-800 bg-gray-900 p-3"
      >
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Status</h3>
        <div role="status" className="text-xs text-gray-500 py-2">
          Carregando status…
        </div>
      </section>
    );
  }

  const events = status.recentCriticalEvents ?? [];

  return (
    <section
      data-block="assistant_status"
      aria-label="Status do assistente"
      className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-3"
    >
      <h3 className="text-xs font-semibold text-gray-300">Status</h3>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${
            status.active
              ? 'bg-green-500/15 text-green-300 border-green-500/30'
              : 'bg-gray-500/15 text-gray-300 border-gray-500/30'
          }`}
        >
          <span aria-hidden="true">{status.active ? '●' : '○'}</span>
          {status.active ? 'Ativo' : 'Inativo'}
        </span>
        <span className="text-[11px] text-gray-400">
          Provedor: <span className="text-gray-200">{status.activeProvider}</span>
        </span>
        <span className="text-[11px] text-gray-400">
          Modelo: <span className="text-gray-200">{status.model || '—'}</span>
        </span>
      </div>

      {/* Orientacao quando inativo por ausencia de chave (Req 7.7). */}
      {!status.active && (
        <div
          role="status"
          className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200 leading-snug"
        >
          O assistente está inativo porque o provedor ativo (
          <span className="font-semibold">{status.activeProvider}</span>) não possui chave de API
          configurada. Defina a chave na seção Configurações para ativá-lo.
        </div>
      )}

      <div className="space-y-1.5">
        <span className="block text-[10px] uppercase tracking-wider text-gray-500">
          Últimos eventos críticos
        </span>
        {events.length === 0 ? (
          <div role="status" className="text-xs text-gray-500 py-1">
            Nenhum evento crítico recente.
          </div>
        ) : (
          <ul className="space-y-1">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center gap-2 px-2 py-1 rounded bg-gray-950/60 border border-gray-800"
              >
                <span
                  className={`inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${SEVERITY_BADGE[ev.severity]}`}
                >
                  {SEVERITY_LABEL[ev.severity]}
                </span>
                <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate">
                  {EVENT_TYPE_LABEL[ev.eventType] ?? ev.eventType}
                </span>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">
                  {formatTimestamp(ev.detectedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

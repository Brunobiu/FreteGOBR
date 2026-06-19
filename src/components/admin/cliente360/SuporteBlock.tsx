/**
 * SuporteBlock — bloco Historico de suporte (Visao 360). Renderizado APENAS com
 * SUPORTE_VIEW. Tickets com assunto/status/prioridade/datas + contagem de
 * mensagens; link /admin/suporte/<ticket_id>. Req 10.1, 10.2, 10.4, 10.5, 10.6.
 */

import { Link } from 'react-router-dom';
import type { SupportHistory } from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { fmtDate } from './format';

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting_customer: 'Aguardando cliente',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

const PRIORITY_LABEL: Record<number, string> = { 1: 'Baixa', 2: 'Média', 3: 'Crítica' };

interface Props {
  suporte: SupportHistory | undefined;
  error?: string;
  onRetry: () => void;
}

export default function SuporteBlock({ suporte, error, onRetry }: Props) {
  const tickets = suporte?.tickets ?? [];

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Histórico de suporte</h3>

      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : tickets.length === 0 ? (
        <div className="text-xs text-gray-500">Nenhum atendimento registrado.</div>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id} className="py-1 border-b border-gray-800/40 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/admin/suporte/${t.id}`}
                  className="text-sm text-cyan-400 hover:underline truncate"
                >
                  {t.subject}
                </Link>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <div className="text-[11px] text-gray-500">
                Prioridade {PRIORITY_LABEL[t.priority_level] ?? t.priority_level} · {t.message_count}{' '}
                msg · aberto {fmtDate(t.created_at)} · atualizado {fmtDate(t.updated_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

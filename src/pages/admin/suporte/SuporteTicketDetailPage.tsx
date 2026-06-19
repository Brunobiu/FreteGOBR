/**
 * SuporteTicketDetailPage — detalhe do atendimento (/admin/suporte/:id).
 *
 * Thread + seletor de status (transições válidas) + resposta humana (flip
 * atômico ai→human) + botão "Retornar para IA" (visível só com SUPORTE_REPLY e
 * responder_mode='human'). Source_Block NOT_FOUND ⇒ Stealth404 (Req 7.5).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import {
  SuporteStatusBadge,
  SuportePriorityBadge,
  SuporteModeBadge,
} from '../../../components/admin/suporte/SuporteBadges';
import {
  getTicketDetail,
  changeStatus,
  returnToAi,
  insertHumanReply,
  SuporteError,
  type SupportTicketDetail,
} from '../../../services/admin/suporte';
import {
  isValidTransition,
  STATUS_DISPLAY_MAP,
  TICKET_STATUSES,
  type TicketStatus,
} from '../../../services/admin/suporte/statusMachine';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function SuporteTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { allowed: canView } = useAdminPermission('SUPORTE_VIEW');
  const { allowed: canReply } = useAdminPermission('SUPORTE_REPLY');

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getTicketDetail(id)
      .then(setTicket)
      .catch((err) => {
        if (err instanceof SuporteError && err.code === 'NOT_FOUND') setNotFound(true);
        else setError(err instanceof SuporteError ? err.message : 'Erro ao carregar o atendimento.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  if (!canView || notFound) return <Stealth404 />;

  async function runAction(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = (await fn()) as { skipped?: boolean };
      setNotice(res && res.skipped ? 'Nenhuma alteração: já estava nesse estado.' : successMsg);
      load();
    } catch (err) {
      if (err instanceof SuporteError && err.code === 'STALE_VERSION') {
        setNotice('Outro admin atualizou. Recarregando.');
        load();
      } else {
        setNotice(err instanceof SuporteError ? err.message : 'Não foi possível concluir.');
      }
    } finally {
      setBusy(false);
    }
  }

  function onChangeStatus(target: TicketStatus) {
    if (!ticket) return;
    void runAction(() => changeStatus(ticket.id, target, ticket.updatedAt), 'Status atualizado.');
  }

  function onReturnToAi() {
    if (!ticket) return;
    void runAction(() => returnToAi(ticket.id, ticket.updatedAt), 'Atendimento devolvido à IA.');
  }

  async function onSendReply() {
    if (!ticket || reply.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await insertHumanReply(ticket.id, reply.trim(), ticket.updatedAt);
      setReply('');
      setNotice('Resposta enviada.');
      load();
    } catch (err) {
      if (err instanceof SuporteError && err.code === 'STALE_VERSION') {
        setNotice('Outro admin atualizou. Recarregando.');
        load();
      } else {
        setNotice(err instanceof SuporteError ? err.message : 'Não foi possível enviar a resposta.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (error) return <DashboardBlockError message={error} onRetry={load} />;
  if (loading && !ticket) return <div className="text-center text-gray-500 text-sm py-6">Carregando...</div>;
  if (!ticket) return null;

  const validTargets = TICKET_STATUSES.filter((s) => isValidTransition(ticket.status, s));

  return (
    <div className="space-y-3 max-w-3xl">
      <Link to="/admin/suporte" className="text-xs text-cyan-400 hover:underline">
        ← Voltar aos atendimentos
      </Link>

      {/* Cabeçalho */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-100 truncate">{ticket.subject}</p>
            <p className="text-[11px] text-gray-500 truncate">
              {ticket.clientName ?? '—'}
              {ticket.clientEmail ? ` · ${ticket.clientEmail}` : ''}
              {ticket.clientWhatsapp ? ` · ${ticket.clientWhatsapp}` : ''}
              {ticket.isGuest ? ' · visitante' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <SuportePriorityBadge level={ticket.priorityLevel} />
            <SuporteModeBadge mode={ticket.responderMode} />
            <SuporteStatusBadge status={ticket.status} />
          </div>
        </div>

        {canReply && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-800">
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Mudar status</label>
            <select
              value=""
              disabled={busy || validTargets.length === 0}
              onChange={(e) => {
                if (e.target.value) onChangeStatus(e.target.value as TicketStatus);
              }}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 disabled:opacity-50"
            >
              <option value="">Selecionar...</option>
              {validTargets.map((s) => (
                <option key={s} value={s}>
                  {STATUS_DISPLAY_MAP[s].label}
                </option>
              ))}
            </select>

            {ticket.responderMode === 'human' && (
              <button
                type="button"
                disabled={busy}
                onClick={onReturnToAi}
                className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                Retornar para IA
              </button>
            )}
          </div>
        )}
      </div>

      {notice && (
        <div className="text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1">
          {notice}
        </div>
      )}

      {/* Thread */}
      <div className="space-y-2">
        {ticket.messages.map((m) => {
          const fromClient = m.authorKind === 'user';
          return (
            <div key={m.id} className={`flex ${fromClient ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  fromClient
                    ? 'bg-gray-800 text-gray-100'
                    : m.authorKind === 'ai'
                      ? 'bg-cyan-500/15 text-cyan-100 border border-cyan-500/30'
                      : 'bg-purple-500/15 text-purple-100 border border-purple-500/30'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">
                  {m.authorKind === 'user' ? 'Cliente' : m.authorKind === 'ai' ? 'IA' : 'Atendente'} ·{' '}
                  {formatDateTime(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </div>
          );
        })}
        {ticket.messages.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-4">Nenhuma mensagem ainda.</p>
        )}
      </div>

      {/* Resposta humana */}
      {canReply && ticket.status !== 'closed' && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Escreva uma resposta ao cliente..."
            className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              {ticket.responderMode === 'ai' ? 'Ao responder, a IA será bloqueada (handoff).' : ''}
            </span>
            <button
              type="button"
              disabled={busy || reply.trim().length === 0}
              onClick={onSendReply}
              className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              Enviar resposta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

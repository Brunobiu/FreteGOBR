import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getAdminTicketDetail,
  replyToTicket,
  resolveTicket,
  sendPublicTicketReplyEmail,
  markEmailSent,
  TicketError,
  type SupportTicket,
  type TicketMessage,
  type TicketStatus,
} from '../../services/admin/tickets';
import { useAdminPermission } from '../../hooks/useAdminPermission';
import { useAuth } from '../../hooks/useAuth';

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: 'bg-blue-900/40 text-blue-300',
  in_progress: 'bg-yellow-900/40 text-yellow-300',
  resolved: 'bg-green-900/40 text-green-300',
};

/**
 * Página admin `/admin/suporte/tickets/:id`. Permissão SUPORTE_VIEW para
 * ler, SUPORTE_REPLY para responder/resolver.
 *
 * Para tickets públicos: após replyToTicket retornar isPublic=true,
 * dispara a Edge Function send-public-ticket-reply e marca email_sent_at
 * em sucesso.
 */
export default function AdminTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allowed: canReply } = useAdminPermission('SUPORTE_REPLY');

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    msg: string;
  } | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTicketDetail(id);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof TicketError ? err.message : 'Nao foi possivel carregar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || !replyBody.trim()) return;
    setPosting(true);
    setFeedback(null);
    try {
      const result = await replyToTicket(ticket.id, replyBody.trim(), ticket.updatedAt);

      // Se ticket é público, dispara email
      if (result.isPublic && result.guestEmail && result.guestName) {
        const adminName = user?.name ?? 'Suporte FreteGO';
        const emailResult = await sendPublicTicketReplyEmail({
          ticketId: ticket.id,
          guestName: result.guestName,
          guestEmail: result.guestEmail,
          subject: result.subject,
          body: replyBody.trim(),
          adminName,
        });

        if (emailResult.ok && emailResult.messageId) {
          // Marca email_sent_at na mensagem recém criada
          try {
            await markEmailSent(result.messageId, new Date().toISOString());
          } catch {
            /* falha em marcar não bloqueia — mensagem ja foi enviada */
          }
          setFeedback({
            type: 'success',
            msg: `Resposta enviada por email para ${result.guestEmail}.`,
          });
        } else {
          setFeedback({
            type: 'warning',
            msg: `Resposta salva mas email nao enviou. ${emailResult.error ?? ''}`,
          });
        }
      } else {
        setFeedback({ type: 'success', msg: 'Resposta enviada.' });
      }

      setReplyBody('');
      await load();
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof TicketError ? err.message : 'Nao foi possivel enviar.',
      });
      // Em STALE_VERSION, recarrega para o admin pegar versão nova
      if (err instanceof TicketError && err.code === 'STALE_VERSION') {
        await load();
      }
    } finally {
      setPosting(false);
    }
  };

  const handleResolve = async () => {
    if (!ticket) return;
    if (!confirm(`Marcar este ticket como resolvido?`)) return;
    setResolving(true);
    setFeedback(null);
    try {
      const result = await resolveTicket(ticket.id, ticket.updatedAt);
      if ('skipped' in result) {
        setFeedback({ type: 'warning', msg: 'Ticket ja estava resolvido.' });
      } else {
        setFeedback({ type: 'success', msg: 'Ticket marcado como resolvido.' });
      }
      await load();
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof TicketError ? err.message : 'Nao foi possivel resolver.',
      });
      if (err instanceof TicketError && err.code === 'STALE_VERSION') {
        await load();
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate('/admin/suporte/tickets')}
        className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 mb-3"
      >
        ← Voltar para a lista
      </button>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">Carregando...</p>
      ) : !ticket ? (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-300">{error ?? 'Ticket nao encontrado.'}</p>
        </div>
      ) : (
        <>
          {/* Header do ticket */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-3">
            <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
              <h1 className="text-lg font-semibold text-gray-100 flex-1 min-w-0">
                {ticket.subject}
              </h1>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[ticket.status]}`}
              >
                {STATUS_LABEL[ticket.status]}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
              {ticket.userId ? (
                <span>
                  De:{' '}
                  <span className="text-gray-200">Usuário (ID {ticket.userId.slice(0, 8)})</span>
                </span>
              ) : (
                <span>
                  De: <span className="text-yellow-300 font-medium">Visitante</span>{' '}
                  <span className="text-gray-200">{ticket.guestName}</span>{' '}
                  <span className="text-gray-500">({ticket.guestEmail})</span>
                </span>
              )}
              <span>•</span>
              <span>Aberto {new Date(ticket.createdAt).toLocaleString('pt-BR')}</span>
              {ticket.resolvedAt && (
                <>
                  <span>•</span>
                  <span>Resolvido {new Date(ticket.resolvedAt).toLocaleString('pt-BR')}</span>
                </>
              )}
            </div>
          </div>

          {/* Aviso de ticket público */}
          {!ticket.userId && (
            <div className="mb-3 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg text-xs text-yellow-300">
              Ticket de visitante anônimo. Suas respostas são <strong>enviadas por email</strong>{' '}
              para <strong>{ticket.guestEmail}</strong>.
            </div>
          )}

          {/* Mensagens */}
          <div className="space-y-2 mb-3">
            {messages.map((m) => {
              const showEmailWarning = m.isAdmin && !ticket.userId && !m.emailSentAt;
              return (
                <div key={m.id} className={`flex ${m.isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 border ${
                      m.isAdmin
                        ? 'bg-blue-900/20 border-blue-500/30 text-gray-100'
                        : 'bg-gray-800 border-gray-700 text-gray-100'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 font-medium">
                      {m.isAdmin ? 'Admin' : ticket.userId ? 'Usuário' : 'Visitante'}
                    </p>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-[10px] text-gray-500">
                        {new Date(m.createdAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      {showEmailWarning && (
                        <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 text-[9px] font-medium rounded">
                          Email não enviado
                        </span>
                      )}
                      {m.isAdmin && !ticket.userId && m.emailSentAt && (
                        <span className="px-1.5 py-0.5 bg-green-900/30 text-green-300 text-[9px] font-medium rounded">
                          ✓ Email enviado
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {feedback && (
            <div
              className={`mb-3 p-3 rounded-lg text-sm border ${
                feedback.type === 'success'
                  ? 'bg-green-900/20 border-green-500/30 text-green-300'
                  : feedback.type === 'warning'
                    ? 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300'
                    : 'bg-red-900/20 border-red-500/30 text-red-300'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {/* Caixa de resposta */}
          {ticket.status !== 'resolved' && canReply && (
            <form
              onSubmit={handleReply}
              className="bg-gray-800 border border-gray-700 rounded-lg p-3"
            >
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={4}
                maxLength={5000}
                required
                placeholder={
                  !ticket.userId
                    ? 'Sua resposta será enviada por email...'
                    : 'Escreva sua resposta...'
                }
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                <span className="text-[10px] text-gray-500">{replyBody.length} / 5000</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResolve}
                    disabled={resolving || posting}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    {resolving ? 'Resolvendo...' : 'Marcar como resolvido'}
                  </button>
                  <button
                    type="submit"
                    disabled={posting || resolving || replyBody.trim().length === 0}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    {posting ? 'Enviando...' : 'Responder'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {ticket.status === 'resolved' && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3 text-center">
              <p className="text-sm text-green-300">
                Ticket marcado como <strong>resolvido</strong>.
              </p>
            </div>
          )}

          {ticket.status !== 'resolved' && !canReply && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center text-xs text-gray-400">
              Você não tem permissão para responder (precisa de SUPORTE_REPLY).
            </div>
          )}
        </>
      )}
    </div>
  );
}

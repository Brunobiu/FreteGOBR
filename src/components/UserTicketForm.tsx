import { useState } from 'react';
import {
  submitUserTicket,
  TicketError,
  type TicketPriority,
  type SupportTicket,
} from '../services/admin/tickets';

interface UserTicketFormProps {
  /** Disparado em sucesso com o ticket criado. */
  onSuccess?: (ticket: SupportTicket) => void;
  /** Cancelar (fechar modal/voltar). */
  onCancel?: () => void;
}

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string; hint: string }> = [
  { value: 'low', label: 'Baixa', hint: 'Duvida geral, sem urgencia.' },
  { value: 'normal', label: 'Normal', hint: 'Padrao.' },
  { value: 'high', label: 'Alta', hint: 'Bloqueando uso do app.' },
];

/**
 * Formulário de criação de ticket pelo usuário logado. Submete via RPC
 * `submit_user_ticket` que cria ticket + primeira mensagem em transação.
 */
export default function UserTicketForm({ onSuccess, onCancel }: UserTicketFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'subject' | 'body', string>>>({});

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!subject.trim() || subject.trim().length < 3)
      e.subject = 'Assunto deve ter pelo menos 3 caracteres.';
    if (!body.trim() || body.trim().length < 10)
      e.body = 'Mensagem deve ter pelo menos 10 caracteres.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const ticket = await submitUserTicket({
        subject: subject.trim(),
        body: body.trim(),
        priority,
      });
      setFeedback({ type: 'success', msg: 'Ticket enviado. Voce recebera resposta em breve.' });
      setSubject('');
      setBody('');
      setPriority('normal');
      setErrors({});
      onSuccess?.(ticket);
    } catch (err) {
      const msg =
        err instanceof TicketError
          ? err.message
          : 'Nao foi possivel enviar agora. Tente novamente.';
      setFeedback({ type: 'error', msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div>
        <label
          htmlFor="user-ticket-subject"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Assunto
        </label>
        <input
          id="user-ticket-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.subject ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="Ex: Erro ao publicar frete"
          autoFocus
        />
        {errors.subject && <p className="mt-1 text-[11px] text-red-600">{errors.subject}</p>}
      </div>

      <div>
        <label
          htmlFor="user-ticket-priority"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Prioridade
        </label>
        <div className="grid grid-cols-3 gap-2">
          {PRIORITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`relative flex flex-col items-center justify-center px-2 py-2 border rounded-lg cursor-pointer text-xs transition-colors ${
                priority === opt.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title={opt.hint}
            >
              <input
                type="radio"
                name="priority"
                value={opt.value}
                checked={priority === opt.value}
                onChange={() => setPriority(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="user-ticket-body" className="block text-xs font-medium text-gray-700 mb-1">
          Descreva o que aconteceu
        </label>
        <textarea
          id="user-ticket-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={6}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.body ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="Inclua passos para reproduzir, mensagens de erro e qualquer detalhe que ajude."
        />
        <div className="flex items-center justify-between mt-1">
          {errors.body ? (
            <p className="text-[11px] text-red-600">{errors.body}</p>
          ) : (
            <span className="text-[10px] text-gray-400">{body.length} / 5000</span>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
          role="status"
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Enviando...' : 'Enviar ticket'}
        </button>
      </div>
    </form>
  );
}

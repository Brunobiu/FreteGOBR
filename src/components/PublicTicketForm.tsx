import { useState } from 'react';
import { submitPublicTicket, TicketError } from '../services/admin/tickets';

interface PublicTicketFormProps {
  /** Quando true, mostra hint visual de "Fale conosco" no topo. */
  withHeader?: boolean;
  /** Callback opcional após sucesso. */
  onSuccess?: () => void;
}

/**
 * Formulário público de ticket de suporte. Acessível por visitantes
 * anônimos (sem login). Submete via RPC `submit_public_ticket` que aceita
 * role `anon`.
 *
 * Anti-bot:
 *   - Honeypot `website_url` invisível por CSS. Bots tendem a preencher
 *     campos ocultos automaticamente.
 *   - Rate-limit por IP no servidor (5 tentativas/hora).
 *
 * Resposta sempre opaca (anti-enumeration): mostra a mesma mensagem de
 * sucesso em qualquer caminho (sucesso real, honeypot detectado, erro
 * interno) — exceto rate-limit que tem mensagem própria.
 */
export default function PublicTicketForm({ withHeader = true, onSuccess }: PublicTicketFormProps) {
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Honeypot: campo com display none. Humanos não preenchem.
  const [websiteUrl, setWebsiteUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success'; msg: string } | { type: 'error'; msg: string } | null
  >(null);
  const [errors, setErrors] = useState<
    Partial<Record<'guestName' | 'guestEmail' | 'subject' | 'body', string>>
  >({});

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!guestName.trim() || guestName.trim().length < 2)
      e.guestName = 'Informe seu nome (minimo 2 caracteres).';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail.trim()))
      e.guestEmail = 'Informe um e-mail valido.';
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
      await submitPublicTicket({
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        subject: subject.trim(),
        body: body.trim(),
        websiteUrl: websiteUrl, // sempre vazio em uso real
      });
      // Resposta sempre opaca. Limpa o form e avisa.
      setFeedback({
        type: 'success',
        msg: 'Recebemos sua mensagem. Entraremos em contato pelo e-mail informado.',
      });
      setGuestName('');
      setGuestEmail('');
      setSubject('');
      setBody('');
      setErrors({});
      onSuccess?.();
    } catch (err) {
      if (err instanceof TicketError && err.code === 'PUBLIC_TICKET_RATE_LIMITED') {
        setFeedback({
          type: 'error',
          msg: 'Nao foi possivel enviar agora. Tente novamente mais tarde.',
        });
      } else if (err instanceof TicketError && err.code === 'INVALID_INPUT') {
        setFeedback({
          type: 'error',
          msg: 'Dados invalidos. Verifique os campos.',
        });
      } else {
        // Anti-enumeration: erros desconhecidos viram a mesma mensagem genérica
        setFeedback({
          type: 'error',
          msg: 'Nao foi possivel enviar agora. Tente novamente mais tarde.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto space-y-4">
      {withHeader && (
        <div className="text-center mb-2">
          <h2 className="text-xl font-bold text-gray-800">Fale conosco</h2>
          <p className="text-sm text-gray-600 mt-1">
            Tire duvidas ou envie sugestoes para nossa equipe.
          </p>
        </div>
      )}

      {/* Honeypot — escondido visualmente. Bots preenchem, humanos nao. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        }}
      >
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </label>
      </div>

      <div>
        <label htmlFor="ticket-name" className="block text-xs font-medium text-gray-700 mb-1">
          Seu nome
        </label>
        <input
          id="ticket-name"
          type="text"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          maxLength={80}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
            errors.guestName ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="Como podemos te chamar?"
          autoComplete="name"
        />
        {errors.guestName && <p className="mt-1 text-[11px] text-red-600">{errors.guestName}</p>}
      </div>

      <div>
        <label htmlFor="ticket-email" className="block text-xs font-medium text-gray-700 mb-1">
          Seu e-mail
        </label>
        <input
          id="ticket-email"
          type="email"
          value={guestEmail}
          onChange={(e) => setGuestEmail(e.target.value)}
          maxLength={120}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
            errors.guestEmail ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="seu@email.com"
          autoComplete="email"
        />
        {errors.guestEmail && <p className="mt-1 text-[11px] text-red-600">{errors.guestEmail}</p>}
      </div>

      <div>
        <label htmlFor="ticket-subject" className="block text-xs font-medium text-gray-700 mb-1">
          Assunto
        </label>
        <input
          id="ticket-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
            errors.subject ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="Sobre o que voce quer falar?"
        />
        {errors.subject && <p className="mt-1 text-[11px] text-red-600">{errors.subject}</p>}
      </div>

      <div>
        <label htmlFor="ticket-body" className="block text-xs font-medium text-gray-700 mb-1">
          Mensagem
        </label>
        <textarea
          id="ticket-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={5}
          required
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
            errors.body ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder="Descreva sua duvida ou pedido com detalhes."
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

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Enviando...' : 'Enviar mensagem'}
      </button>
    </form>
  );
}

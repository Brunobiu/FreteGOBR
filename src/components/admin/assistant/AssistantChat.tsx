/**
 * AssistantChat.tsx
 *
 * Chat do modulo Assistente — conversa entre o Master_Admin e a IA. Carrega
 * o historico persistido em ordem cronologica CRESCENTE (Req 5.7; a service
 * `loadConversation` ja normaliza ASC) e envia novas mensagens via
 * `sendMessage`, que monta o contexto server-side e invoca a AI_Edge_Function.
 *
 * Acessibilidade e resiliencia (Req 5.3, 5.4, 5.6, 16.1, 16.3):
 *   - Input rotulado com `aria-label` (Req 16.1).
 *   - Novas mensagens do assistente sao anunciadas por uma live region
 *     `role="status"` `aria-live="polite"` (Req 16.3).
 *   - Falha do provedor exibe mensagem amigavel em `role="alert"` e PRESERVA
 *     a mensagem do usuario ja persistida (Req 5.6); a conversa em curso nao
 *     e perdida.
 *   - Quando a persistencia da resposta `assistant` falha (indisponibilidade
 *     temporaria do banco), a resposta ainda e entregue ao usuario com um
 *     aviso de degradacao, sem nova tentativa automatica (Req 5.4).
 *
 * Padrao compacto pos-cleanup: sem <h1> grande; controles `text-xs`; coluna
 * unica responsiva.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadConversation,
  sendMessage,
  type ChatMessage,
  type ChatRole,
  type SendErrorReason,
} from '../../../services/admin/assistant';

interface Props {
  /** Conversa selecionada; `null` inicia uma nova conversa (criada no 1o envio). */
  conversationId?: string | null;
  /** Notifica o pai quando uma nova conversa e criada pelo primeiro envio. */
  onConversationCreated?: (conversationId: string) => void;
}

/** Rotulos pt-BR por papel de mensagem, para exibicao e leitores de tela. */
const ROLE_LABEL: Record<ChatRole, string> = {
  user: 'Você',
  assistant: 'Assistente',
  system: 'Sistema',
};

/** Mensagens amigaveis pt-BR por razao de falha de envio (Req 5.6). */
const SEND_ERROR_MESSAGE: Record<SendErrorReason, string> = {
  provider_unavailable:
    'O provedor de IA está indisponível no momento. Tente novamente em instantes.',
  provider_call_failed:
    'Não foi possível obter a resposta do provedor de IA. Sua mensagem foi preservada.',
  provider_not_implemented:
    'O provedor selecionado ainda não está disponível. Selecione Claude nas configurações.',
  missing_api_key:
    'Nenhuma chave de API configurada para o provedor ativo. Configure a chave nas configurações.',
  permission_denied: 'Você não tem permissão para enviar mensagens ao assistente.',
  unknown: 'Não foi possível concluir o envio. Sua mensagem foi preservada.',
};

/** Formata timestamp ISO como `HH:mm` no fuso pt-BR; invalido => ''. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function AssistantChat({ conversationId = null, onConversationCreated }: Props) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const listEndRef = useRef<HTMLDivElement | null>(null);

  // Carrega o historico ASC ao trocar de conversa selecionada (Req 5.7).
  useEffect(() => {
    setActiveConversationId(conversationId);
    if (conversationId === null) {
      setMessages([]);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoadError(false);
    loadConversation(conversationId)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Rola para a ultima mensagem quando a lista muda.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  /** Cria uma mensagem `assistant` sintetica para exibir a resposta nao persistida. */
  const buildEphemeralAssistant = useCallback(
    (convId: string, content: string): ChatMessage => ({
      id: `ephemeral-${Date.now()}`,
      conversationId: convId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    }),
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (text.length === 0 || sending) return;

      setSending(true);
      setSendError(null);
      setNotice(null);

      const result = await sendMessage(activeConversationId, text);

      if (result.ok) {
        const next: ChatMessage[] = [...messages, result.userMessage];
        const assistantMsg =
          result.assistantMessage ??
          buildEphemeralAssistant(result.conversationId, result.assistantContent);
        next.push(assistantMsg);
        setMessages(next);
        setInput('');

        if (result.conversationId !== activeConversationId) {
          setActiveConversationId(result.conversationId);
          if (activeConversationId === null) {
            onConversationCreated?.(result.conversationId);
          }
        }

        // Degradacao: resposta entregue mas nao persistida no historico (Req 5.4).
        if (!result.persistedAssistant) {
          setNotice(
            'Resposta entregue, mas não foi salva no histórico (indisponibilidade temporária).'
          );
        }
        setAnnounce('Nova mensagem do assistente recebida.');
      } else {
        // Falha do provedor: preserva a mensagem do usuario (Req 5.6).
        if (result.userMessage) {
          setMessages([...messages, result.userMessage]);
          setInput('');
          if (result.conversationId !== null && result.conversationId !== activeConversationId) {
            setActiveConversationId(result.conversationId);
            if (activeConversationId === null) {
              onConversationCreated?.(result.conversationId);
            }
          }
        }
        // Mensagem do usuario nao persistiu: mantem o texto no input para nao perder.
        setSendError(SEND_ERROR_MESSAGE[result.error]);
      }

      setSending(false);
    },
    [input, sending, activeConversationId, messages, buildEphemeralAssistant, onConversationCreated]
  );

  return (
    <section
      data-block="assistant_chat"
      aria-label="Chat do assistente"
      className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex flex-col"
    >
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Chat</h3>

      {/* Live region: anuncia novas mensagens do assistente (Req 16.3). */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      <div
        className="flex-1 min-h-[12rem] max-h-[28rem] overflow-y-auto space-y-2 pr-1"
        aria-label="Histórico da conversa"
      >
        {loadError ? (
          <div role="alert" className="text-xs text-red-300 py-2">
            Não foi possível carregar o histórico desta conversa.
          </div>
        ) : messages.length === 0 ? (
          <div role="status" className="text-xs text-gray-500 py-3">
            Inicie a conversa enviando uma mensagem ao assistente.
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-snug whitespace-pre-wrap break-words ${
                    isUser
                      ? 'bg-cyan-500/10 text-cyan-100 border border-cyan-500/20'
                      : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                    {ROLE_LABEL[m.role]}
                    {formatTime(m.createdAt) ? ` · ${formatTime(m.createdAt)}` : ''}
                  </span>
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Aviso de degradacao da persistencia (Req 5.4). */}
      {notice && (
        <div role="status" className="mt-2 text-[11px] text-amber-300">
          {notice}
        </div>
      )}

      {/* Falha amigavel do provedor (Req 5.6). */}
      {sendError && (
        <div
          role="alert"
          className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300"
        >
          {sendError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-2 flex items-end gap-2">
        <textarea
          aria-label="Mensagem para o assistente"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          rows={2}
          placeholder="Pergunte algo ao assistente…"
          disabled={sending}
          className="flex-1 resize-none rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </section>
  );
}

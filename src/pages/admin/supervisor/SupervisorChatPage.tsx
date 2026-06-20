/**
 * SupervisorChatPage (/admin/supervisor) — Painel Inteligente (chat read-only)
 * com HISTÓRICO de conversas (supervisor-chat-history / 119).
 *
 * Lista lateral de conversas (do próprio admin); reabrir/continuar; nova
 * conversa; renomear/excluir. Ao perguntar, persiste a mensagem do usuário e a
 * resposta da IA na sessão ativa (criando a sessão na 1ª pergunta). A IA segue
 * READ-ONLY e degrada para "IA indisponível" quando o provider falha. A
 * persistência é best-effort: falha de gravação NÃO quebra o chat.
 *
 * Gating: SUPERVISOR_VIEW ⇒ senão Stealth_404. Padrão compacto (sem <h1>).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import SupervisorNav from '../../../components/admin/supervisor/SupervisorNav';
import {
  askSupervisor,
  createChatSession,
  listChatSessions,
  listChatMessages,
  appendChatMessage,
  renameChatSession,
  deleteChatSession,
  type SupervisorChatSession,
} from '../../../services/admin/supervisor';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
  degraded?: boolean;
}

export default function SupervisorChatPage() {
  const { allowed: canView } = useAdminPermission('SUPERVISOR_VIEW');
  const [sessions, setSessions] = useState<SupervisorChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const list = await listChatSessions();
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      /* lista vazia em falha — não quebra o chat */
    }
  }, []);

  useEffect(() => {
    if (canView) void loadSessions();
  }, [canView, loadSessions]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setMessages([]);
    try {
      const msgs = await listChatMessages(id);
      setMessages((Array.isArray(msgs) ? msgs : []).map((m) => ({ role: m.role, text: m.content })));
    } catch {
      /* mantém vazio */
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setInput('');
  }, []);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);

    // Garante uma sessão (cria na 1ª pergunta, com título derivado).
    let sid = activeId;
    try {
      if (!sid) {
        const created = await createChatSession(q);
        sid = created.id;
        setActiveId(sid);
      }
    } catch {
      sid = null; // sem sessão: segue o chat sem persistir
    }

    if (sid) void appendChatMessage(sid, 'user', q);

    try {
      const res = await askSupervisor(q);
      setMessages((m) => [...m, { role: 'ai', text: res.answer, degraded: res.degraded }]);
      if (sid) void appendChatMessage(sid, 'ai', res.answer);
    } finally {
      setSending(false);
      void loadSessions(); // atualiza ordem/títulos da lista
    }
  }, [input, sending, activeId, loadSessions]);

  const onRename = useCallback(
    async (s: SupervisorChatSession) => {
      const next = window.prompt('Renomear conversa:', s.title);
      if (next == null) return;
      const title = next.trim();
      if (!title) return;
      try {
        await renameChatSession(s.id, title);
      } finally {
        void loadSessions();
      }
    },
    [loadSessions]
  );

  const onDelete = useCallback(
    async (s: SupervisorChatSession) => {
      if (!window.confirm('Excluir esta conversa?')) return;
      try {
        await deleteChatSession(s.id);
      } finally {
        if (activeId === s.id) newConversation();
        void loadSessions();
      }
    },
    [activeId, newConversation, loadSessions]
  );

  if (!canView) return <Stealth404 />;

  return (
    <div className="space-y-3">
      <SupervisorNav />

      <div className="flex gap-3">
        {/* Sidebar de conversas */}
        <aside className="w-56 shrink-0 space-y-2">
          <button
            type="button"
            onClick={newConversation}
            className="w-full text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700"
          >
            + Nova conversa
          </button>
          <ul className="space-y-1" aria-label="Conversas">
            {sessions.length === 0 && (
              <li className="text-[11px] text-gray-500 px-1">Nenhuma conversa salva ainda.</li>
            )}
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`group flex items-center gap-1 rounded px-2 py-1 text-xs cursor-pointer ${
                  activeId === s.id ? 'bg-gray-800 text-cyan-200' : 'text-gray-300 hover:bg-gray-800/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void openSession(s.id)}
                  className="flex-1 text-left truncate"
                  title={s.title}
                >
                  {s.title}
                </button>
                <button
                  type="button"
                  onClick={() => void onRename(s)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-gray-200"
                  aria-label={`Renomear ${s.title}`}
                >
                  editar
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(s)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300"
                  aria-label={`Excluir ${s.title}`}
                >
                  excluir
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Painel de chat */}
        <div className="flex-1 space-y-3">
          <div className="text-xs text-gray-500">
            Pergunte sobre a saúde e a operação do sistema. A IA é somente leitura — observa,
            responde e sugere, mas não executa ações.
          </div>

          <div className="rounded border border-gray-800 bg-gray-900 p-3 min-h-[220px] space-y-2">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm">
                Faça uma pergunta, por exemplo: &ldquo;Como está o sistema hoje?&rdquo;
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <span
                  className={`inline-block max-w-[85%] rounded px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-cyan-500/15 text-cyan-100' : 'bg-gray-800 text-gray-200'
                  }`}
                >
                  {m.text}
                </span>
                {m.degraded && (
                  <div className="text-[10px] text-amber-400 mt-0.5">IA indisponível</div>
                )}
              </div>
            ))}
            {sending && <p className="text-gray-500 text-xs">Consultando…</p>}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="Sua pergunta…"
              className="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {sending ? 'Enviando…' : 'Perguntar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

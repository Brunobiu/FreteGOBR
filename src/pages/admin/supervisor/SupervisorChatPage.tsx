/**
 * SupervisorChatPage (/admin/supervisor) — Painel Inteligente (chat read-only).
 *
 * O admin pergunta em linguagem natural; a IA Supervisora responde com base em
 * agregados do sistema (sem PII). READ-ONLY: a IA nunca executa ação. Provider
 * indisponível ⇒ resposta de indisponibilidade (degradação controlada).
 *
 * Gating: SUPERVISOR_VIEW ⇒ senão Stealth_404. Padrão compacto (sem <h1>).
 */

import { useCallback, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import SupervisorNav from '../../../components/admin/supervisor/SupervisorNav';
import { askSupervisor } from '../../../services/admin/supervisor';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
  degraded?: boolean;
}

export default function SupervisorChatPage() {
  const { allowed: canView } = useAdminPermission('SUPERVISOR_VIEW');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setSending(true);
    try {
      const res = await askSupervisor(q);
      setMessages((m) => [...m, { role: 'ai', text: res.answer, degraded: res.degraded }]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  if (!canView) return <Stealth404 />;

  return (
    <div className="space-y-3">
      <SupervisorNav />

      <div className="text-xs text-gray-500">
        Pergunte sobre a saúde e a operação do sistema. A IA é somente leitura — observa, responde e
        sugere, mas não executa ações.
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
            {m.degraded && <div className="text-[10px] text-amber-400 mt-0.5">IA indisponível</div>}
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
  );
}

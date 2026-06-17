/**
 * AssistentePage — Assistente IA do motorista.
 *
 * Layout (revisao 2 — estilo Siri dark):
 *   - Tela inicial: Saudação por horário + Star_Icon animado + Quick_Cards
 *   - Chat: bolhas estilo WhatsApp com input fixo na base
 *   - Sidebar: lista de conversas anteriores (Supabase)
 *   - Integração com Edge Function motorista-ai-chat (quando disponível)
 *   - Fallback heurístico local enquanto a Edge Function não existir
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useEffectiveLocation } from '../hooks/useEffectiveLocation';
import { getActiveFretes, type Frete } from '../services/fretes';
import { getMotoristaCalcContext, type MotoristaCalcContext } from '../services/motorista';
import { calculateFreteFinanceiro, formatCurrencyBRL } from '../utils/calculoFrete';
import { calculateDistance } from '../services/geolocation';
import { getGreeting } from '../utils/greeting';
import { inferTitle } from '../utils/inferTitle';
import { capitalizeName } from '../utils/textCase';
import {
  listMotoristaConversations,
  createMotoristaConversation,
  getConversationMessages,
  addMessage,
  updateConversationTitle,
  deleteMotoristaConversation,
  type MotoristaConversation,
  type MotoristaMessage,
} from '../services/motoristaAiConversations';
import { supabase } from '../services/supabase';
import AssistantStarIcon from '../components/AssistantStarIcon';

const QUICK_CARDS = [
  { id: 'region', text: 'Quais fretes tem na minha região?' },
  { id: 'lucro', text: 'Qual o frete mais lucrativo pra mim?' },
  { id: 'curto', text: 'Tem frete curto perto de mim?' },
];

export default function AssistentePage() {
  useDocumentTitle('Assistente IA');
  const { user } = useAuth();
  const navigate = useNavigate();
  const effectiveLoc = useEffectiveLocation();

  // State
  const [conversations, setConversations] = useState<MotoristaConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MotoristaMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);

  // Contexto para heurística local (fallback)
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [calc, setCalc] = useState<MotoristaCalcContext | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  // Saudação
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const firstName = user?.name ? capitalizeName(user.name).split(' ')[0] : null;
    return getGreeting(hour, firstName);
  }, [user?.name]);

  // Carrega conversas ao montar
  useEffect(() => {
    if (!user) return;
    setLoadingConvs(true);
    listMotoristaConversations()
      .then((list) => {
        setConversations(list);
        setLoadingConvs(false);
      })
      .catch(() => setLoadingConvs(false));
  }, [user]);

  // Carrega contexto para heurística
  useEffect(() => {
    if (!user) return;
    getActiveFretes({})
      .then(setFretes)
      .catch(() => {});
    if (user.userType === 'motorista') {
      getMotoristaCalcContext(user.id)
        .then(setCalc)
        .catch(() => {});
    }
  }, [user]);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Operações de conversa
  const openConversation = useCallback(async (id: string) => {
    setActiveConvId(id);
    setSidebarOpen(false);
    try {
      const msgs = await getConversationMessages(id);
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setSidebarOpen(false);
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      if (!confirm('Apagar essa conversa?')) return;
      try {
        await deleteMotoristaConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConvId === id) {
          setActiveConvId(null);
          setMessages([]);
        }
      } catch {
        /* ignore */
      }
    },
    [activeConvId]
  );

  // Envio de mensagem
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;
      setInput('');

      let convId = activeConvId;

      // Se não tem conversa ativa, cria uma nova
      if (!convId) {
        try {
          const title = inferTitle(trimmed);
          const conv = await createMotoristaConversation(title);
          convId = conv.id;
          setActiveConvId(conv.id);
          setConversations((prev) => [conv, ...prev]);
        } catch {
          return;
        }
      } else {
        // Atualiza título se for "Nova conversa" e é a primeira mensagem user
        const conv = conversations.find((c) => c.id === convId);
        if (
          conv &&
          conv.title === 'Nova conversa' &&
          messages.filter((m) => m.role === 'user').length === 0
        ) {
          const title = inferTitle(trimmed);
          updateConversationTitle(convId, title).catch(() => {});
          setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
        }
      }

      // Adiciona mensagem do usuário
      try {
        const userMsg = await addMessage(convId, 'user', trimmed);
        setMessages((prev) => [...prev, userMsg]);
      } catch {
        return;
      }

      // Chama a IA (tenta Edge Function, fallback heurístico)
      setIsThinking(true);
      try {
        const response = await callAi(convId, trimmed);
        const aiMsg = await addMessage(convId, 'assistant', response);
        setMessages((prev) => [...prev, aiMsg]);
      } catch {
        const fallback = await addMessage(
          convId,
          'assistant',
          'Desculpe, não consegui processar sua pergunta. Tente novamente.'
        );
        setMessages((prev) => [...prev, fallback]);
      } finally {
        setIsThinking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConvId, isThinking, conversations, messages, fretes, calc, effectiveLoc]
  );

  // Chamada à Edge Function (com fallback heurístico)
  const callAi = async (conversationId: string, message: string): Promise<string> => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('no_session');

      const res = await supabase.functions.invoke('motorista-ai-chat', {
        body: { conversationId, message },
      });

      if (res.error) throw res.error;
      const body = res.data as { ok: boolean; content?: string; error?: string };
      if (body.ok && body.content) return body.content;
      if (body.error === 'missing_api_key') {
        return 'O assistente está indisponível no momento. O administrador precisa configurar a chave de API.';
      }
      throw new Error(body.error ?? 'unknown');
    } catch {
      // Fallback: heurística local
      return generateLocalReply(message);
    }
  };

  // Heurística local (mesmo padrão da versão anterior)
  const generateLocalReply = (_prompt: string): string => {
    const point = effectiveLoc.point;
    if (!calc?.kmPerLiter || !calc?.dieselPrice) {
      return 'Pra fazer uma boa sugestão preciso conhecer seu caminhão. Configure consumo (km/L) e preço do diesel no seu perfil e me chame de novo.';
    }

    const filtered = point
      ? fretes.filter((f) => {
          if (!f.originLocation) return false;
          const dist = calculateDistance(point, f.originLocation);
          return dist <= 500;
        })
      : fretes;

    if (filtered.length === 0) {
      return 'Não encontrei fretes ativos na sua região no momento. Tente aumentar o raio na home ou volte mais tarde.';
    }

    // Encontra o melhor frete por lucro/km
    let best: { frete: Frete; lucro: number; lucroKm: number } | null = null;
    for (const f of filtered) {
      if (!f.distanceKm || f.distanceKm <= 0) continue;
      const c = calculateFreteFinanceiro({
        distanceKm: f.distanceKm,
        kmPerLiter: calc.kmPerLiter,
        dieselPrice: calc.dieselPrice,
        freteValue: f.value,
        cargoCapacityTon: calc.cargoCapacityTon ?? 1,
        pricingMode: 'closed',
      });
      if (c.lucroLiquido <= 0) continue;
      const lkm = c.lucroLiquido / f.distanceKm;
      if (!best || lkm > best.lucroKm) {
        best = { frete: f, lucro: c.lucroLiquido, lucroKm: lkm };
      }
    }

    if (!best) {
      return 'Analisei os fretes disponíveis mas nenhum apresenta lucro positivo com seu consumo atual. Confira se o valor do diesel está atualizado.';
    }

    const distInfo = point
      ? ` (${Math.round(calculateDistance(point, best.frete.originLocation))} km de você)`
      : '';

    return (
      `Achei uma boa opção: ${best.frete.origin} → ${best.frete.destination}${distInfo}.\n\n` +
      `• Valor: ${formatCurrencyBRL(best.frete.value)}\n` +
      `• Distância: ${best.frete.distanceKm} km\n` +
      `• Lucro estimado: ${formatCurrencyBRL(best.lucro)}\n` +
      `• Lucro por km: ${formatCurrencyBRL(best.lucroKm)}/km\n\n` +
      `Quer que eu busque mais opções ou analise outra coisa?`
    );
  };

  const isConversationActive = activeConvId !== null && messages.length > 0;

  return (
    <div className="h-[100dvh] bg-slate-950 text-white flex flex-col overflow-hidden">
      {/* Header compacto */}
      <header className="shrink-0 flex items-center px-4 py-3 border-b border-slate-800/50">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 mr-3"
          aria-label="Voltar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">Assistente IA</h1>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700"
          aria-label="Histórico"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={newConversation}
          className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 ml-2"
          aria-label="Nova conversa"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </header>

      {/* Conteúdo principal */}
      <main className="flex-1 overflow-y-auto">
        {!isConversationActive ? (
          /* ─── Tela inicial (Welcome) ─── */
          <div className="flex flex-col items-center justify-center min-h-full px-4 py-8">
            {/* Saudação */}
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-1">{greeting}</h2>
            <p className="text-sm text-slate-400 mb-8">Como posso te ajudar com fretes?</p>

            {/* Estrela animada */}
            <AssistantStarIcon size={96} className="mb-10" />

            {/* Quick Cards */}
            <div className="w-full max-w-sm space-y-2.5">
              {QUICK_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => send(card.text)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-900/80 border border-slate-800 rounded-xl hover:bg-slate-800 hover:border-slate-700 transition-colors text-left group"
                >
                  <span className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-slate-700">
                    <svg
                      className="w-4 h-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                      />
                    </svg>
                  </span>
                  <span className="text-sm text-slate-200 flex-1">{card.text}</span>
                  <svg
                    className="w-4 h-4 text-slate-500 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ─── Chat View ─── */
          <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-slate-800">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                    <span
                      className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"
                      style={{ animationDelay: '0.15s' }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"
                      style={{ animationDelay: '0.3s' }}
                    />
                  </span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* Input fixo na base */}
      <footer className="shrink-0 border-t border-slate-800/50 px-3 py-3 bg-slate-950/95 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Pergunte qualquer coisa..."
            disabled={isThinking}
            className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 focus:border-yellow-500 rounded-full text-sm text-white placeholder-slate-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || isThinking}
            className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label="Enviar"
          >
            <svg
              className="w-5 h-5 text-blue-900"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18"
              />
            </svg>
          </button>
        </div>
      </footer>

      {/* Sidebar de histórico */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 right-0 w-72 bg-slate-900 border-l border-slate-800 z-50 flex flex-col animate-slide-in-left">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Conversas</h3>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Fechar"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {loadingConvs ? (
                <p className="text-xs text-slate-500 text-center py-4">Carregando...</p>
              ) : conversations.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4 px-3">
                  Suas conversas aparecerão aqui.
                </p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-1 px-3 ${
                      activeConvId === conv.id ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openConversation(conv.id)}
                      className="flex-1 min-w-0 py-2.5 text-left"
                    >
                      <p className="text-sm text-slate-200 truncate">{conv.title}</p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(conv.updatedAt).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeConversation(conv.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Apagar"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                newConversation();
                setSidebarOpen(false);
              }}
              className="m-3 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-slate-900 text-sm font-semibold rounded-xl transition-colors"
            >
              + Nova conversa
            </button>
          </aside>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useGeolocation } from '../hooks/useGeolocation';
import { getActiveFretes, type Frete } from '../services/fretes';
import {
  getMotoristaCalcContext,
  type MotoristaCalcContext,
} from '../services/motorista';
import {
  calculateFreteFinanceiro,
  formatCurrencyBRL,
} from '../utils/calculoFrete';
import { calculateDistance } from '../services/geolocation';
import {
  createConversation,
  deleteConversation,
  getConversation,
  inferTitle,
  listConversations,
  saveConversation,
  type AiConversation,
  type AiMessage,
} from '../services/aiConversations';
import AskAiAvatar from '../components/AskAiAvatar';

const QUICK_PROMPTS = [
  'Sugira o melhor frete pra mim agora',
  'Quanto eu lucro com R$ 6,20 de diesel e 2,5 km/L?',
  'Me ajude a escolher entre frete curto e longo',
  'Quais fretes ativos rendem mais por km?',
];

const SUGGESTION_KEYWORDS = [
  'sugira',
  'sugerir',
  'sugestao',
  'sugestão',
  'melhor',
  'rende',
  'rendem',
  'lucro',
  'lucrativo',
  'recomenda',
  'frete',
  'viagem',
  'pegar',
  'aceitar',
];

interface PendingState {
  prompt: string;
}

export default function AssistentePage() {
  useDocumentTitle('Pergunte à IA');
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetConvId = searchParams.get('c');
  const wantsNew = searchParams.get('new') === '1';

  // ── Estado da conversa atual ────────────────────────────────────────────
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Quando o usuário pede sugestão sem localização, guardamos o prompt
   *  pra retomar assim que a localização chegar. */
  const [pending, setPending] = useState<PendingState | null>(null);

  // ── Contexto pra heurística ─────────────────────────────────────────────
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [calc, setCalc] = useState<MotoristaCalcContext | null>(null);
  const geo = useGeolocation();

  const endRef = useRef<HTMLDivElement>(null);

  // ── Carrega conversas ao montar ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const list = listConversations(user.id);

    // Sempre que vier `?new=1`, abre uma conversa em branco — mesmo se
    // existirem conversas anteriores no histórico.
    if (wantsNew) {
      const conv = createConversation(user.id);
      setConversations([conv, ...list]);
      setActiveId(conv.id);
      setMessages([]);
      setSearchParams({ c: conv.id }, { replace: true });
      return;
    }

    setConversations(list);

    if (targetConvId && list.find((c) => c.id === targetConvId)) {
      openConversation(targetConvId);
    } else if (list.length > 0) {
      openConversation(list[0].id);
    } else {
      const conv = createConversation(user.id);
      setConversations([conv]);
      setActiveId(conv.id);
      setMessages([]);
      setSearchParams({ c: conv.id }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Carrega contexto pra heurística ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getActiveFretes({}).then(setFretes).catch(() => {});
    if (user.userType === 'motorista') {
      getMotoristaCalcContext(user.id).then(setCalc).catch(() => {});
    }
  }, [user]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // ── Quando localização chega, retoma o prompt pendente ──────────────────
  useEffect(() => {
    if (!pending) return;
    if (geo.status === 'success') {
      const p = pending;
      setPending(null);
      // Pequeno delay pra dar feedback visual
      setTimeout(() => generateReply(p.prompt), 300);
    } else if (
      geo.status === 'error' ||
      geo.status === 'denied' ||
      geo.status === 'insecure'
    ) {
      // Mantém pending null e responde sem localização
      setPending(null);
      generateReply(pending.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status]);

  // ── Persiste conversa ativa quando muda ─────────────────────────────────
  useEffect(() => {
    if (!user || !activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const updated: AiConversation = { ...conv, messages };
    if (messages.length > 0 && updated.title === 'Nova conversa') {
      const firstUser = messages.find((m) => m.role === 'user');
      if (firstUser) updated.title = inferTitle(firstUser.content);
    }
    saveConversation(user.id, updated);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updated : c))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ── Operações ───────────────────────────────────────────────────────────

  const openConversation = (id: string) => {
    if (!user) return;
    const conv = getConversation(user.id, id);
    if (!conv) return;
    setActiveId(id);
    setMessages(conv.messages);
    setSearchParams({ c: id }, { replace: true });
    setSidebarOpen(false);
  };

  const newConversation = () => {
    if (!user) return;
    const conv = createConversation(user.id);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setMessages([]);
    setSearchParams({ c: conv.id }, { replace: true });
    setSidebarOpen(false);
  };

  const removeConversation = (id: string) => {
    if (!user) return;
    if (!confirm('Apagar essa conversa?')) return;
    deleteConversation(user.id, id);
    const list = listConversations(user.id);
    setConversations(list);
    if (activeId === id) {
      if (list.length > 0) openConversation(list[0].id);
      else newConversation();
    }
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: AiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Detecta se quer sugestão
    const lower = trimmed.toLowerCase();
    const wantsSuggestion = SUGGESTION_KEYWORDS.some((kw) => lower.includes(kw));

    if (wantsSuggestion && geo.status !== 'success') {
      // Pede localização
      const askMsg: AiMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content:
          'Pra sugerir o melhor frete preciso saber onde você está agora. Toque no botão abaixo pra ativar a localização — eu uso ela só pra calcular qual frete tá mais perto de você.',
        requestsLocation: true,
      };
      setMessages((prev) => [...prev, askMsg]);
      setPending({ prompt: trimmed });
      // Dispara request se ainda não foi feito
      if (geo.status === 'idle') {
        geo.requestLocation();
      }
      return;
    }

    generateReply(trimmed);
  };

  const generateReply = (prompt: string) => {
    setThinking(true);
    setTimeout(() => {
      const reply = respondLocal(
        prompt,
        fretes,
        calc,
        geo.status === 'success' && geo.point ? geo.point : null
      );
      setMessages((prev) => [...prev, reply]);
      setThinking(false);
    }, 800);
  };

  const handleSuggestionClick = (freteId: string) => {
    localStorage.setItem('fretego-open-frete', freteId);
    navigate(user?.userType === 'embarcador' ? '/embarcador' : '/');
  };

  const activeTitle = useMemo(() => {
    const conv = conversations.find((c) => c.id === activeId);
    return conv?.title ?? 'Nova conversa';
  }, [conversations, activeId]);

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      {/* Sidebar (desktop fixo, mobile drawer) */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="px-3 py-3 border-b border-slate-800 flex items-center gap-2">
          <button
            onClick={newConversation}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:brightness-110 rounded-lg text-sm font-semibold transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Nova conversa
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-slate-400 hover:text-white p-1.5"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {conversations.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6 px-3">
              Suas conversas aparecem aqui.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 px-2 ${
                  activeId === c.id ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                }`}
              >
                <button
                  onClick={() => openConversation(c.id)}
                  className="flex-1 min-w-0 py-2 text-left"
                >
                  <p className="text-sm text-slate-200 truncate">{c.title}</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {new Date(c.updatedAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </button>
                <button
                  onClick={() => removeConversation(c.id)}
                  className="p-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Apagar"
                  title="Apagar conversa"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        <button
          onClick={() => navigate(-1)}
          className="px-3 py-2.5 border-t border-slate-800 text-xs text-slate-400 hover:text-white text-left"
        >
          ← Voltar pro app
        </button>
      </aside>

      {/* Área da conversa */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-slate-800 px-3 sm:px-5 py-3 flex items-center gap-3 shrink-0 bg-slate-950/95 backdrop-blur">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-slate-400 hover:text-white p-1"
            aria-label="Histórico"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <AskAiAvatar size={32} />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm sm:text-base font-semibold leading-tight truncate">
              {activeTitle}
            </h1>
            <p className="text-[11px] text-slate-400 leading-tight">
              FreteGO IA
              {geo.status === 'success' && (
                <span className="ml-2 text-emerald-400">📍 localização ativa</span>
              )}
            </p>
          </div>
        </header>

        {/* Mensagens */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-3 sm:px-5 py-4 space-y-4">
            {messages.length === 0 && (
              <WelcomeScreen onPick={send} />
            )}
            {messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                fretes={fretes}
                onSuggestionClick={handleSuggestionClick}
                onRequestLocation={() => geo.requestLocation()}
                geoStatus={geo.status}
              />
            ))}
            {thinking && (
              <div className="flex gap-3">
                <AskAiAvatar size={28} />
                <div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-slate-800/70">
                  <ThinkingDots />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </main>

        {/* Input */}
        <footer className="border-t border-slate-800 p-3 shrink-0 bg-slate-950/95 backdrop-blur">
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder={
                isAuthenticated
                  ? 'Pergunte qualquer coisa sobre fretes...'
                  : 'Faça login para conversar com a IA'
              }
              disabled={!isAuthenticated || thinking}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 focus:border-purple-500 rounded-lg text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || thinking || !isAuthenticated}
              className="p-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="Enviar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
          <p className="max-w-2xl mx-auto text-center text-[10px] text-slate-500 mt-1.5">
            Respostas geradas com base nos seus dados — confira sempre antes de decidir.
          </p>
        </footer>
      </div>

      {/* Backdrop sidebar mobile */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Welcome ────────────────────────────────────────────────────────────────

function WelcomeScreen({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="text-center py-10">
      <div className="inline-flex items-center justify-center mb-3">
        <AskAiAvatar size={56} />
      </div>
      <h2 className="text-xl font-semibold text-slate-200">Como posso te ajudar?</h2>
      <p className="text-sm text-slate-500 mt-1">
        Pergunte sobre fretes, lucro, rotas ou peça uma sugestão.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="text-xs px-3 py-2 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-full text-slate-300 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message ────────────────────────────────────────────────────────────────

function Message({
  message,
  fretes,
  onSuggestionClick,
  onRequestLocation,
  geoStatus,
}: {
  message: AiMessage;
  fretes: Frete[];
  onSuggestionClick: (id: string) => void;
  onRequestLocation: () => void;
  geoStatus: string;
}) {
  const isUser = message.role === 'user';
  const suggested = message.suggestionFreteId
    ? fretes.find((f) => f.id === message.suggestionFreteId)
    : null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && <AskAiAvatar size={28} className="shrink-0 mt-0.5" />}
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : 'bg-slate-800/70 text-slate-100 rounded-tl-sm'
        }`}
      >
        <p>{message.content}</p>

        {message.requestsLocation && !isUser && (
          <button
            onClick={onRequestLocation}
            disabled={geoStatus === 'loading' || geoStatus === 'success'}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-md text-xs font-medium text-emerald-300 transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {geoStatus === 'loading'
              ? 'Buscando localização...'
              : geoStatus === 'success'
                ? 'Localização ativa'
                : geoStatus === 'error'
                  ? 'Tentar novamente'
                  : 'Ativar localização'}
          </button>
        )}

        {suggested && message.suggestionLucroLiquido !== undefined && (
          <button
            onClick={() => onSuggestionClick(suggested.id)}
            className="mt-2 w-full text-left bg-slate-900/60 hover:bg-slate-900 border border-purple-500/50 rounded-lg p-2.5 transition-colors"
          >
            <p className="text-xs font-bold text-purple-300">
              {suggested.origin} → {suggested.destination}
            </p>
            <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] text-slate-300">
              <span>{suggested.distanceKm ?? '—'} km</span>
              <span className="text-green-400 font-semibold">
                {formatCurrencyBRL(message.suggestionLucroLiquido)}
              </span>
              <span>
                {message.suggestionLucroPorKm !== undefined
                  ? `${formatCurrencyBRL(message.suggestionLucroPorKm)}/km`
                  : ''}
              </span>
            </div>
            <p className="text-[10px] text-purple-300 mt-1">Toque pra ver detalhes →</p>
          </button>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" style={{ animationDelay: '0.15s' }} />
      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" style={{ animationDelay: '0.3s' }} />
    </span>
  );
}

// ─── Heurística (placeholder) ───────────────────────────────────────────────

function respondLocal(
  prompt: string,
  fretes: Frete[],
  ctx: MotoristaCalcContext | null,
  motoristaPoint: { latitude: number; longitude: number } | null
): AiMessage {
  const id = `a-${Date.now()}`;
  const lower = prompt.toLowerCase();
  const wantsSuggestion = SUGGESTION_KEYWORDS.some((kw) => lower.includes(kw));

  if (!wantsSuggestion) {
    return {
      id,
      role: 'assistant',
      content:
        'Obrigado pela pergunta. Estou em desenvolvimento — em breve uma IA real responderá tudo. Por enquanto posso te sugerir o melhor frete pra você. Tente: "Sugira o melhor frete pra mim".',
    };
  }

  if (!ctx || !ctx.kmPerLiter || !ctx.dieselPrice) {
    return {
      id,
      role: 'assistant',
      content:
        'Pra fazer uma boa sugestão preciso conhecer seu caminhão. Configure consumo (km/L), preço do diesel e capacidade no seu perfil e me chame de novo.',
    };
  }

  const best = pickBest(fretes, ctx, motoristaPoint);
  if (!best) {
    return {
      id,
      role: 'assistant',
      content:
        'Não encontrei nenhum frete ativo com retorno positivo no momento. Tente aumentar o raio na home ou volte mais tarde — fretes novos aparecem direto na lista.',
    };
  }

  const distInfo =
    motoristaPoint && best.distanciaAteOrigem !== null
      ? ` Está a cerca de ${best.distanciaAteOrigem} km de você.`
      : '';

  const reasonByDist =
    best.frete.distanceKm && best.frete.distanceKm < 100
      ? 'curta distância com excelente retorno por km'
      : best.frete.distanceKm && best.frete.distanceKm < 500
        ? 'um equilíbrio ótimo entre distância e lucro'
        : 'uma viagem longa com retorno acima da média';

  return {
    id,
    role: 'assistant',
    content: `Olha o que achei pra você: a viagem ${best.frete.origin} → ${best.frete.destination}.${distInfo} É ${reasonByDist}. Estimei lucro líquido de ${formatCurrencyBRL(best.lucroLiquido)} (${formatCurrencyBRL(best.lucroPorKm)}/km), considerando seu consumo e o diesel atual.`,
    suggestionFreteId: best.frete.id,
    suggestionLucroLiquido: best.lucroLiquido,
    suggestionLucroPorKm: best.lucroPorKm,
  };
}

interface PickResult {
  frete: Frete;
  lucroLiquido: number;
  lucroPorKm: number;
  distanciaAteOrigem: number | null;
}

function pickBest(
  fretes: Frete[],
  ctx: MotoristaCalcContext,
  motoristaPoint: { latitude: number; longitude: number } | null
): PickResult | null {
  if (!ctx.kmPerLiter || !ctx.dieselPrice) return null;

  const candidates: PickResult[] = [];

  for (const f of fretes) {
    if (!f.distanceKm || f.distanceKm <= 0) continue;
    if (f.status !== 'ativo') continue;

    const isPerTon = f.priceCalculation === 'toneladas' || f.priceCalculation === 'quilos';
    const cap = ctx.cargoCapacityTon ?? null;
    const usePerTon = isPerTon && cap !== null && cap > 0;

    const calc = calculateFreteFinanceiro({
      distanceKm: f.distanceKm,
      kmPerLiter: ctx.kmPerLiter,
      dieselPrice: ctx.dieselPrice,
      freteValue: f.value,
      cargoCapacityTon: usePerTon ? (cap as number) : 1,
      pricingMode: usePerTon ? 'per_ton' : 'closed',
    });

    if (calc.lucroLiquido <= 0) continue;
    const lucroPorKm = calc.lucroLiquido / f.distanceKm;

    let dist: number | null = null;
    if (motoristaPoint && f.originLocation) {
      dist = Math.round(calculateDistance(motoristaPoint, f.originLocation));
    }

    candidates.push({
      frete: f,
      lucroLiquido: calc.lucroLiquido,
      lucroPorKm,
      distanciaAteOrigem: dist,
    });
  }

  if (candidates.length === 0) return null;

  // Critério: se temos localização, escolhemos o melhor compromisso entre
  // distância de aproximação e lucro/km. Usamos um score:
  //   score = lucroPorKm - 0.05 * distanciaAteOrigem
  // (cada km de aproximação custa R$ 0,05 do lucro/km equivalente)
  if (motoristaPoint) {
    candidates.sort((a, b) => {
      const sa = a.lucroPorKm - 0.05 * (a.distanciaAteOrigem ?? 9999);
      const sb = b.lucroPorKm - 0.05 * (b.distanciaAteOrigem ?? 9999);
      return sb - sa;
    });
  } else {
    candidates.sort((a, b) => b.lucroPorKm - a.lucroPorKm);
  }

  return candidates[0];
}

/**
 * HighlightsFeed.tsx
 *
 * Mural de Destaques (Highlights_Feed) do modulo Assistente — feed
 * somente-leitura, glanceavel, no topo da Assistant_Page. Lista os
 * Highlight derivados de Critical_Event em ordem cronologica DECRESCENTE
 * (a service ja ordena via sortHighlights), exibindo categoria, resumo,
 * severidade e timestamp de cada item.
 *
 * Comportamento (Req 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.5):
 *   - Read-only: o unico controle e a navegacao para a conversa de detalhe.
 *   - Clique em um Highlight com conversa referenciada chama
 *     `onSelectConversation(conversationId)` (a Assistant_Page seleciona a
 *     conversa no Chat in-page). Highlight com conversa ausente
 *     (`conversationId === null`) e renderizado SEM link, sem gerar erro.
 *   - Estado vazio informativo quando nao ha destaques.
 *   - Falha de carga e ISOLADA neste bloco: renderiza `DashboardBlockError`
 *     com botao "Tentar novamente" (refetch), sem afetar as demais secoes
 *     da pagina.
 *
 * Padrao compacto pos-cleanup: sem <h1> grande; controles `text-xs`;
 * coluna unica responsiva.
 */

import { useCallback, useEffect, useState } from 'react';
import { listHighlights, type Highlight, type Severity } from '../../../services/admin/assistant';
import DashboardBlockError from '../dashboard/DashboardBlockError';

interface Props {
  /**
   * Callback de navegacao para a conversa referenciada por um Highlight.
   * A Assistant_Page (task 9.5) liga isto a selecao de conversa no Chat.
   * Quando ausente, os itens permanecem read-only sem acao de clique.
   */
  onSelectConversation?: (conversationId: string) => void;
}

/** Classes de badge por severidade (tema escuro do painel admin). */
const SEVERITY_BADGE: Record<Severity, string> = {
  info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Rotulos pt-BR de severidade. */
const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  warning: 'Atenção',
  critical: 'Crítico',
};

/** Formata timestamp ISO como `dd/MM HH:mm` no fuso pt-BR; invalido => '—'. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Conteudo interno de um item do mural (reusado por item clicavel e estatico). */
function HighlightBody({ highlight }: { highlight: Highlight }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={`inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${SEVERITY_BADGE[highlight.severity]}`}
        >
          {SEVERITY_LABEL[highlight.severity]}
        </span>
        <span className="text-[11px] text-gray-400 truncate">{highlight.category}</span>
        <span className="ml-auto text-[10px] text-gray-500 whitespace-nowrap">
          {formatTimestamp(highlight.timestamp)}
        </span>
      </div>
      <p className="text-xs text-gray-200 leading-snug break-words">{highlight.summary}</p>
    </>
  );
}

export default function HighlightsFeed({ onSelectConversation }: Props) {
  const [items, setItems] = useState<Highlight[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await listHighlights();
      setItems(data);
    } catch {
      // Falha isolada do Mural; demais secoes seguem normais (Req 4.7).
      setError(true);
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      data-block="highlights_feed"
      aria-label="Mural de destaques"
      className="rounded-lg border border-gray-800 bg-gray-900 p-3"
    >
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Mural de destaques</h3>

      {error ? (
        <DashboardBlockError message="Não foi possível carregar o mural." onRetry={load} />
      ) : loading ? (
        <div role="status" className="text-xs text-gray-500 py-3">
          Carregando destaques…
        </div>
      ) : items && items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((h) => {
            const canNavigate = h.conversationId !== null && onSelectConversation !== undefined;
            return (
              <li key={h.id}>
                {canNavigate ? (
                  <button
                    type="button"
                    onClick={() => onSelectConversation?.(h.conversationId as string)}
                    aria-label={`Abrir conversa do destaque: ${h.summary}`}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-800/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition"
                  >
                    <HighlightBody highlight={h} />
                  </button>
                ) : (
                  <div className="px-2 py-1.5 rounded">
                    <HighlightBody highlight={h} />
                    {h.conversationId === null && (
                      <span className="text-[10px] text-gray-600">Conversa indisponível</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div role="status" className="text-xs text-gray-500 py-3">
          Nenhum destaque ainda. O assistente publicará aqui erros detectados, melhorias sugeridas e
          eventos críticos.
        </div>
      )}
    </section>
  );
}

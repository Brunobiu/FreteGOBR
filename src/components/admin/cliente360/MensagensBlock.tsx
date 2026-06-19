/**
 * MensagensBlock — bloco Historico de mensagens (Visao 360). SEMPRE visivel
 * (nao gated). Metadados de conversas de frete + chat de suporte, SEM conteudo.
 * Link "abrir conversa" so com SUPORTE_REPLY. Req 11.1, 11.2, 11.3, 11.4, 11.5, 11.6.
 */

import { Link } from 'react-router-dom';
import type { MessageHistory } from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { fmtDate } from './format';

interface Props {
  mensagens: MessageHistory | null;
  suporteReply: boolean;
  error?: string;
  onRetry: () => void;
}

export default function MensagensBlock({ mensagens, suporteReply, error, onRetry }: Props) {
  const frete = mensagens?.frete ?? [];
  const suporteChat = mensagens?.suporteChat ?? [];
  const isEmpty = frete.length === 0 && suporteChat.length === 0;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Mensagens</h3>

      {/* O erro afeta apenas o sub-bloco de frete; o chat de suporte vem do
          bundle base e segue exibido. */}
      {error && <DashboardBlockError message={error} onRetry={onRetry} className="mb-3 h-auto" />}

      {!error && isEmpty ? (
        <div className="text-xs text-gray-500">Nenhuma conversa registrada.</div>
      ) : (
        <div className="space-y-4">
          {frete.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                Conversas de frete
              </div>
              <ul className="space-y-1">
                {frete.map((c) => (
                  <li
                    key={c.conversation_id}
                    className="flex items-center justify-between gap-3 text-xs py-1 border-b border-gray-800/40 last:border-0"
                  >
                    <span className="font-mono text-gray-400">
                      {c.conversation_id.slice(0, 8)}
                    </span>
                    <span className="text-gray-500">
                      {c.total_messages} msgs · com {c.counterpart} · última {fmtDate(c.last_message_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {suporteChat.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                Conversas de suporte
              </div>
              <ul className="space-y-1">
                {suporteChat.map((c) => (
                  <li
                    key={c.conversation_id}
                    className="flex items-center justify-between gap-3 text-xs py-1 border-b border-gray-800/40 last:border-0"
                  >
                    <span className="font-mono text-gray-400">
                      {c.conversation_id.slice(0, 8)}
                    </span>
                    <span className="text-gray-500">
                      {c.total_messages} msgs · última {fmtDate(c.last_message_at)}
                      {suporteReply ? (
                        <Link to="/admin/suporte/chat" className="ml-2 text-cyan-400 hover:underline">
                          abrir conversa
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * UserChatMetadataBlock - metadados de conversas (sem conteudo).
 *
 * Conteudo das mensagens fica para a spec admin-suporte.
 */

import type { UserChatMetadata } from '../../../services/admin/users';

interface Props {
  chat: UserChatMetadata[];
  error?: string;
}

export default function UserChatMetadataBlock({ chat, error }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Mensagens ({chat.length} conversas)
      </h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar conversas.</div>}
      {chat.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhuma conversa registrada.</div>
      )}
      <ul className="space-y-2 text-sm">
        {chat.map((c) => (
          <li
            key={c.conversation_id}
            className="flex items-center justify-between gap-3 py-1 border-b border-gray-800/40 last:border-0"
          >
            <div className="min-w-0">
              <div className="text-gray-300 font-mono text-xs">{c.conversation_id.slice(0, 8)}</div>
              <div className="text-xs text-gray-500">
                {c.total_messages} msgs · ultima{' '}
                {c.last_message_at ? new Date(c.last_message_at).toLocaleDateString('pt-BR') : '—'}
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Disponivel na spec admin-suporte"
              className="text-xs text-gray-600 cursor-not-allowed"
            >
              Abrir conversa
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

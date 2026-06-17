/**
 * GroupSelector (suporte às tasks 20.6/20.10, Req 12.1, 12.2)
 *
 * Seleção múltipla de WhatsApp_Groups da Active_Instance. Lista os grupos via
 * `listInstanceGroups` (proxy Evolution → cache `whatsapp_groups`), que exige a
 * sessão `CONNECTED`. Componente controlado: o parent mantém os JIDs
 * selecionados e recebe as mudanças por `onChange`.
 *
 * Sessão não conectada / indisponibilidade ⇒ mostra a mensagem retornada (ex.:
 * `Conecte o WhatsApp antes de iniciar o disparo.`) e lista vazia.
 */

import { useCallback, useEffect, useState } from 'react';
import { listInstanceGroups, type WhatsAppGroup } from '../../../services/admin/whatsapp/connection';

interface Props {
  instanceId: string;
  selected: string[];
  onChange: (groupJids: string[]) => void;
}

export default function GroupSelector({ instanceId, selected, onChange }: Props) {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    listInstanceGroups(instanceId)
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups);
        if (!res.ok || res.groups.length === 0) {
          setMessage(res.message ?? (res.groups.length === 0 ? 'Nenhum grupo encontrado.' : null));
        }
      })
      .catch(() => {
        if (!cancelled) setMessage('Não foi possível carregar os grupos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  const toggle = (jid: string) => {
    onChange(selected.includes(jid) ? selected.filter((j) => j !== jid) : [...selected, jid]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500">
          Grupos {selected.length > 0 && `(${selected.length} selecionados)`}
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Carregando...' : '↻ Atualizar grupos'}
        </button>
      </div>

      {groups.length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900 p-1.5">
          {groups.map((g) => {
            const checked = selected.includes(g.groupJid);
            return (
              <li key={g.groupJid}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                    checked ? 'bg-green-500/10' : 'hover:bg-gray-800/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(g.groupJid)}
                    className="rounded border-gray-600 bg-gray-700"
                  />
                  <span className="flex-1 truncate text-gray-100">
                    {g.name ?? g.groupJid}
                  </span>
                  {typeof g.participantCount === 'number' && (
                    <span className="shrink-0 text-[11px] text-gray-500">{g.participantCount}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        message && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
            {message}
          </div>
        )
      )}
    </div>
  );
}

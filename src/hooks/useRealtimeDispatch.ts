/**
 * useRealtimeDispatch (tasks 21.1, 21.3 — Req 11.2, 19.6, 22.3, 28.5, 30.5)
 *
 * Assina o Supabase Realtime (`postgres_changes`) das tabelas do WhatsApp_Module
 * FILTRADAS por `instance_id` (jobs, recipients, sessions, conversations,
 * messages) e dispara um `onChange` (debounced) a cada mudança — para que as
 * superfícies (Dashboard, Fila, Inbox, progresso) reflitam o estado sem reload
 * manual. Inclui um FALLBACK de polling leve (~10s, task 21.3) que reexecuta o
 * `onChange` periodicamente caso o realtime atrase/caia.
 *
 * Espelha o padrão do projeto (`useNotificationsRealtime`): um canal por
 * instância, `removeChannel` no cleanup. O `onChange` é mantido em ref para não
 * re-assinar o canal a cada render.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

/** Tabelas `whatsapp_*` (todas chaveadas por `instance_id`) observadas. */
const REALTIME_TABLES = [
  'whatsapp_dispatch_jobs',
  'whatsapp_dispatch_recipients',
  'whatsapp_sessions',
  'whatsapp_conversations',
  'whatsapp_messages',
] as const;

export interface RealtimeDispatchOptions {
  /** Habilita a assinatura/polling (default `true`). */
  enabled?: boolean;
  /** Intervalo do fallback de polling em ms (default 10000; `0` desabilita). */
  pollMs?: number;
  /** Janela de debounce do realtime em ms (default 500). */
  debounceMs?: number;
}

/**
 * Reflete em tempo real as mudanças da Active_Instance chamando `onChange`.
 *
 * @param instanceId Active_Instance a observar (null/undefined desabilita).
 * @param onChange   Callback de atualização (ex.: recarregar do estado persistido).
 * @param options    `enabled`, `pollMs` (fallback) e `debounceMs`.
 */
export function useRealtimeDispatch(
  instanceId: string | null | undefined,
  onChange: () => void,
  options: RealtimeDispatchOptions = {}
): void {
  const { enabled = true, pollMs = 10000, debounceMs = 500 } = options;

  // Mantém o callback mais recente sem re-assinar o canal a cada render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !instanceId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerDebounced = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChangeRef.current(), debounceMs);
    };

    // Um canal por instância, com um handler por tabela (todas por instance_id).
    let channel = supabase.channel(`whatsapp-rt-${instanceId}`);
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `instance_id=eq.${instanceId}` },
        triggerDebounced
      );
    }
    channel.subscribe();

    // Fallback de polling leve (task 21.3): reexecuta o onChange periodicamente.
    const pollTimer =
      pollMs > 0 ? setInterval(() => onChangeRef.current(), pollMs) : null;

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [instanceId, enabled, pollMs, debounceMs]);
}

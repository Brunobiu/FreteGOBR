/**
 * useWhatsAppInstance (task 21.1 — Req 2.4)
 *
 * Carrega as WhatsApp_Instances habilitadas (data-driven) e gerencia a
 * Active_Instance selecionada, compartilhada por todas as abas do
 * `AdminWhatsAppPage`. A primeira instância é selecionada por padrão. Encapsula
 * o carregamento (loading/erro) e expõe `reload` para releitura manual.
 *
 * `enabled` deve refletir a permissão de leitura (SETTINGS_VIEW) — quando
 * `false`, o hook não busca nada (a página renderiza Stealth404).
 */

import { useCallback, useEffect, useState } from 'react';
import { listInstances, type WhatsAppInstance } from '../services/admin/whatsapp/instances';

export interface UseWhatsAppInstanceResult {
  instances: WhatsAppInstance[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useWhatsAppInstance(enabled: boolean): UseWhatsAppInstanceResult {
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listInstances()
      .then((rows) => {
        if (cancelled) return;
        setInstances(rows);
        // Seleciona a primeira instância como Active_Instance por padrão,
        // preservando a seleção atual se ela ainda existir.
        setActiveId((prev) =>
          prev && rows.some((r) => r.id === prev) ? prev : (rows[0]?.id ?? null)
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar instâncias.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  return { instances, activeId, setActiveId, loading, error, reload };
}

/**
 * useDocRevalidation
 *
 * Carrega o estado de revalidação periódica (30 dias) do motorista logado e
 * expõe a ação de confirmar tudo. Usado pelo modal central (App) e pelos selos
 * amarelos "?" dos tiles do menu.
 *
 * Ao montar para um motorista, chama `get_my_doc_revalidation` — que, no
 * servidor, cria a notificação do sistema de forma idempotente quando há grupo
 * vencido. Não-motoristas saem cedo (`applicable: false`).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import {
  getMyDocRevalidation,
  confirmMyDocRevalidation,
  type DocRevalidationState,
} from '../services/docRevalidation';
import type { RevalidationGroup } from '../utils/docRevalidation';

export interface UseDocRevalidation {
  loading: boolean;
  /** Há pelo menos um grupo vencido (motorista precisa confirmar). */
  needsRevalidation: boolean;
  /** Grupos vencidos (na ordem canônica). */
  expiredGroups: RevalidationGroup[];
  /** Confirma tudo (+30 dias) e recarrega o estado. */
  confirm: () => Promise<void>;
  confirming: boolean;
  /** Recarrega o estado manualmente. */
  refresh: () => void;
}

export function useDocRevalidation(): UseDocRevalidation {
  const { user } = useAuth();
  const [state, setState] = useState<DocRevalidationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!user || user.userType !== 'motorista') {
      setState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await getMyDocRevalidation();
        if (!cancelled) setState(next);
      } catch {
        // Falha de rede não deve bloquear o motorista — trata como sem pendência.
        if (!cancelled) setState(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  const confirm = useCallback(async () => {
    setConfirming(true);
    try {
      await confirmMyDocRevalidation();
      refresh();
    } finally {
      setConfirming(false);
    }
  }, [refresh]);

  return {
    loading,
    needsRevalidation: (state?.expiredGroups.length ?? 0) > 0,
    expiredGroups: state?.expiredGroups ?? [],
    confirm,
    confirming,
    refresh,
  };
}

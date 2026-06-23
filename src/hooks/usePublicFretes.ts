/**
 * usePublicFretes — busca os fretes ativos públicos (vitrine "tempo real") e
 * mantém atualizado: assina o Realtime do Supabase (qualquer mudança em
 * `fretes` agenda um refetch com debounce) e ainda revalida a cada 30s como
 * rede de segurança.
 *
 * Usado tanto na seção da landing quanto na página dedicada (/fretes-ao-vivo).
 * Estado: `fretes` = null (carregando) | [] (vazio/erro tratado) | array.
 */

import { useEffect, useId, useState } from 'react';
import { supabase } from '../services/supabase';
import { getPublicRecentFretes, type PublicFrete } from '../services/publicFretes';

export function usePublicFretes(limit = 60) {
  const [fretes, setFretes] = useState<PublicFrete[] | null>(null);
  const [error, setError] = useState(false);
  // Nome de canal único por instância — evita colisão se duas telas que usam
  // o hook coexistirem por um instante durante a transição de rota.
  const channelId = useId();

  useEffect(() => {
    let alive = true;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const data = await getPublicRecentFretes(limit);
        if (!alive) return;
        setFretes(data);
        setError(false);
      } catch {
        if (!alive) return;
        setError(true);
        setFretes((prev) => prev ?? []);
      }
    };

    load();

    const scheduleRefetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(load, 800);
    };
    const channel = supabase
      .channel(`public-fretes-live-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fretes' }, scheduleRefetch)
      .subscribe();

    const poll = window.setInterval(load, 30_000);

    return () => {
      alive = false;
      if (debounce) clearTimeout(debounce);
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [limit, channelId]);

  return { fretes, error };
}

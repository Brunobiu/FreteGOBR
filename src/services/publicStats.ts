/**
 * publicStats — números públicos exibidos na landing ("Nossos números").
 *
 * Lê contagens agregadas via RPC `public_stats` (migration 120), que é
 * liberada para o role `anon` (a landing é pré-login). A RPC retorna apenas
 * totais — nenhum dado individual/PII trafega.
 *
 * Tolerante a falha: se a RPC não existir ainda (migration não aplicada) ou
 * der erro, retorna `null` e a UI simplesmente não mostra a seção.
 */
import { supabase } from './supabase';

export interface PublicStats {
  fretes: number;
  motoristas: number;
  embarcadores: number;
}

/** Converte valor cru da RPC em contagem inteira não-negativa (fallback 0). */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Busca as contagens públicas. Retorna `null` em qualquer falha (RPC ausente,
 * erro de rede, payload inesperado) para a UI degradar sem quebrar.
 */
export async function getPublicStats(): Promise<PublicStats | null> {
  try {
    const { data, error } = await supabase.rpc('public_stats');
    if (error) throw error;
    if (!data || typeof data !== 'object') return null;

    const d = data as Record<string, unknown>;
    return {
      fretes: toCount(d.fretes),
      motoristas: toCount(d.motoristas),
      embarcadores: toCount(d.embarcadores),
    };
  } catch {
    return null;
  }
}

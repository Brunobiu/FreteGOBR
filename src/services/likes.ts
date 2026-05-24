/**
 * Likes Service — sistema de "curtidas" de fretes pelo motorista.
 *
 * Toda mutação passa pelo RPC `toggle_frete_like` (atomicidade +
 * criação automática de notificação). Listagem de quem curtiu um
 * frete passa pelo RPC `get_likers_of_frete` (defensivo: só o
 * embarcador dono enxerga). Hidratar o estado dos corações na home
 * é um simples SELECT direto na tabela `frete_likes`.
 */

import { supabase } from './supabase';

export interface ToggleLikeResult {
  liked: boolean;
  total: number;
}

export interface FreteLiker {
  motoristaId: string;
  likedAt: Date;
  name: string;
  phone: string | null;
  profilePhoto: string | null;
  vehicleType: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
  trailerAxles: number | null;
  cargoCapacity: number | null;
  rntrcType: 'fisica' | 'juridica' | null;
}

/**
 * Toggle de curtida no frete. Cria/remove a curtida e (no caso de criar)
 * dispara uma notificação para o embarcador. Retorna o estado novo.
 */
export async function toggleFreteLike(freteId: string): Promise<ToggleLikeResult> {
  const { data, error } = await supabase.rpc('toggle_frete_like', { p_frete_id: freteId });
  if (error) throw new Error(`Erro ao curtir frete: ${error.message}`);
  return {
    liked: !!data?.liked,
    total: typeof data?.total === 'number' ? data.total : 0,
  };
}

/**
 * Lista motoristas que curtiram um frete específico. Apenas o
 * embarcador dono do frete consegue ver — checagem é feita no banco.
 */
export async function getLikersOfFrete(freteId: string): Promise<FreteLiker[]> {
  const { data, error } = await supabase.rpc('get_likers_of_frete', { p_frete_id: freteId });
  if (error) throw new Error(`Erro ao listar interessados: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    motoristaId: r.motorista_id as string,
    likedAt: new Date(r.liked_at as string),
    name: (r.name as string) ?? '',
    phone: (r.phone as string) ?? null,
    profilePhoto: (r.profile_photo as string) ?? null,
    vehicleType: (r.vehicle_type as string) ?? null,
    vehicleModel: (r.vehicle_model as string) ?? null,
    vehiclePlate: (r.vehicle_plate as string) ?? null,
    trailerAxles: r.trailer_axles !== null ? (r.trailer_axles as number) : null,
    cargoCapacity: r.cargo_capacity !== null ? Number(r.cargo_capacity) : null,
    rntrcType: (r.rntrc_type as 'fisica' | 'juridica') ?? null,
  }));
}

/**
 * Lista os IDs de fretes que o motorista logado curtiu. Usado para
 * hidratar o estado dos corações na home (filled vs outlined).
 */
export async function getLikedFreteIds(motoristaId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('frete_likes')
    .select('frete_id')
    .eq('motorista_id', motoristaId);
  if (error) {
    // Não é fatal — sem hidratação, todos aparecem como não-curtidos
    console.warn('Erro ao buscar curtidas do motorista:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.frete_id as string));
}

/**
 * Conta total de curtidas de um frete. Útil para hidratação por demanda
 * sem custo de chamar o RPC.
 */
export async function getFreteLikeCount(freteId: string): Promise<number> {
  const { count, error } = await supabase
    .from('frete_likes')
    .select('id', { count: 'exact', head: true })
    .eq('frete_id', freteId);
  if (error) return 0;
  return count ?? 0;
}

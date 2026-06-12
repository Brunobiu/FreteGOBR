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
import { dataCache } from './cache/dataCache';
import { deriveKey } from './cache/cacheKey';

/**
 * Namespace do Data_Cache para os IDs de fretes curtidos por usuário
 * (`getLikedFreteIds`). Ver tabela de namespaces do design (Req 6, 12).
 */
const LIKES_IDS_NAMESPACE = 'likes:idsByUser';

/**
 * TTL médio (5 min) do conjunto de IDs curtidos. O estado dos corações muda
 * apenas quando o próprio motorista curte/descurte — e nesses casos invalidamos
 * a chave explicitamente no toggle. O TTL médio cobre mudanças externas raras
 * sem custo de refetch a cada navegação (Req 6.3, 6.5, 12.6).
 */
const LIKES_TTL_MS = 5 * 60_000;

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

  // Invalidação por escrita (Req 6.4): o conjunto de IDs curtidos do motorista
  // mudou. Invalidamos a chave do usuário afetado (auth.uid() — o mesmo que o
  // RPC usou) para que o próximo `getLikedFreteIds` reflita o estado correto.
  // A HomePage também atualiza `likedFreteIds` de forma otimista no toggle; a
  // invalidação garante consistência num refetch posterior (best-effort: uma
  // falha ao obter o usuário não pode derrubar o toggle bem-sucedido).
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      dataCache.invalidate(deriveKey(LIKES_IDS_NAMESPACE, { userId: user.id }));
    }
  } catch {
    // Best-effort: o cache expira pelo TTL médio mesmo sem invalidação explícita.
  }

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
 *
 * Envolve a leitura no Data_Cache (Req 6, 12): coalesce requisições
 * concorrentes do mesmo usuário, reutiliza o resultado entre navegações curtas
 * e expira por TTL médio (`LIKES_TTL_MS`). A invalidação explícita em
 * `toggleFreteLike` mantém o conjunto consistente após uma curtida/descurtida.
 *
 * Segurança de mutação: o `Data_Cache` armazena a **referência** do `Set`. Hoje
 * a HomePage não muta o objeto retornado (ela cria um novo `Set` no toggle),
 * mas como a referência cacheada é compartilhada com o estado do React,
 * retornamos uma **cópia** (`new Set(...)`) a cada leitura para blindar contra
 * mutação acidental do valor cacheado por qualquer consumidor presente ou
 * futuro. A assinatura observável (`Promise<Set<string>>`) é preservada.
 *
 * Fail-safe (preservado): em erro de query, o fetcher loga e retorna `Set`
 * vazio — sem hidratação, todos aparecem como não-curtidos (igual ao baseline).
 */
export async function getLikedFreteIds(motoristaId: string): Promise<Set<string>> {
  const cached = await dataCache.getOrFetch(
    deriveKey(LIKES_IDS_NAMESPACE, { userId: motoristaId }),
    () => fetchLikedFreteIdsFromSupabase(motoristaId),
    { ttlMs: LIKES_TTL_MS }
  );
  // Cópia defensiva: não exponha a referência cacheada diretamente.
  return new Set(cached);
}

/**
 * Implementação direta da leitura dos IDs curtidos no Supabase (fonte).
 * Extraída de `getLikedFreteIds` para ser envolvida pelo Data_Cache sem alterar
 * o comportamento observável.
 */
async function fetchLikedFreteIdsFromSupabase(motoristaId: string): Promise<Set<string>> {
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

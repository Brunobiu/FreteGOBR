/**
 * Leitura pública do perfil Frete Comunidade (foto + nome) para o feed do
 * motorista. A tabela community_profile tem RLS de leitura pública (migration
 * 061) — sem PII, é só a marca. spec frete-comunidade (Fase 6 / Req 10.1).
 *
 * Cache (startup-performance-optimization, Req 6.1/6.4/6.5/12.6): a leitura é
 * envolvida pelo Data_Cache em memória (namespace `community:publicProfile`,
 * TTL longo) — o perfil público muda raramente. A assinatura observável de
 * `getCommunityPublicProfile()` e o formato de `CommunityPublicProfile`
 * permanecem inalterados (não-regressão). A invalidação na escrita ocorre em
 * `src/services/admin/comunidade.ts` (`upsertCommunityProfile`), único ponto
 * acessível no client que altera o perfil público (painel admin).
 */

import { supabase } from './supabase';
import { dataCache } from './cache/dataCache';
import { deriveKey } from './cache/cacheKey';

export interface CommunityPublicProfile {
  name: string;
  photoUrl: string | null;
}

/** Namespace do Data_Cache para o perfil público da comunidade. */
export const COMMUNITY_PUBLIC_PROFILE_NAMESPACE = 'community:publicProfile';

/** TTL longo: o perfil público da comunidade muda raramente (30 min). */
const COMMUNITY_PROFILE_TTL_MS = 30 * 60_000;

/** Chave estável do perfil público (sem parâmetros: perfil global único). */
const COMMUNITY_PUBLIC_PROFILE_KEY = deriveKey(COMMUNITY_PUBLIC_PROFILE_NAMESPACE, undefined);

/** Busca o perfil comunidade vigente diretamente da fonte (Supabase). */
async function fetchCommunityPublicProfile(): Promise<CommunityPublicProfile | null> {
  const { data, error } = await supabase
    .from('community_profile')
    .select('name, photo_path')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const photoPath = (data as { photo_path: string | null }).photo_path;
  const photoUrl = photoPath
    ? (supabase.storage.from('community_profile').getPublicUrl(photoPath).data.publicUrl ?? null)
    : null;
  return { name: (data as { name: string }).name ?? '', photoUrl };
}

/** Lê o perfil comunidade vigente (cacheado em memória por sessão). */
export async function getCommunityPublicProfile(): Promise<CommunityPublicProfile | null> {
  return dataCache.getOrFetch(COMMUNITY_PUBLIC_PROFILE_KEY, fetchCommunityPublicProfile, {
    ttlMs: COMMUNITY_PROFILE_TTL_MS,
  });
}

/**
 * Invalida o Cache_Entry do perfil público da comunidade. Deve ser chamada
 * após qualquer escrita bem-sucedida do perfil público (Req 6.4).
 */
export function invalidateCommunityPublicProfile(): void {
  dataCache.invalidateNamespace(COMMUNITY_PUBLIC_PROFILE_NAMESPACE);
}

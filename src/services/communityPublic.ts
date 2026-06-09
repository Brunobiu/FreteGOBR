/**
 * Leitura pública do perfil Frete Comunidade (foto + nome) para o feed do
 * motorista. A tabela community_profile tem RLS de leitura pública (migration
 * 061) — sem PII, é só a marca. spec frete-comunidade (Fase 6 / Req 10.1).
 */

import { supabase } from './supabase';

export interface CommunityPublicProfile {
  name: string;
  photoUrl: string | null;
}

let cache: CommunityPublicProfile | null = null;
let cachePromise: Promise<CommunityPublicProfile | null> | null = null;

/** Lê o perfil comunidade vigente (cacheado em memória por sessão). */
export async function getCommunityPublicProfile(): Promise<CommunityPublicProfile | null> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
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
    cache = { name: (data as { name: string }).name ?? '', photoUrl };
    return cache;
  })();

  return cachePromise;
}

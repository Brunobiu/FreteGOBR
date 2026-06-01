/**
 * marketing/pixelId.ts
 *
 * Fonte PUBLICA do `pixel_id` do Meta Pixel para o site publico do FreteGO
 * (admin-marketing 048/049, Epico 7 — task 7.4). Alimenta o `getPixelId` do
 * `Pixel_Loader`.
 *
 * FONTE PRIMARIA — `marketing_config` via RPC publica:
 *   O `pixel_id` vigente vem da config administrada em `marketing_config`,
 *   lido pela RPC `marketing_public_pixel_id()` (migration 049). Essa RPC e
 *   `SECURITY DEFINER` e exposta ao role `anon` (mesmo padrao anon-seguro de
 *   `is_blacklisted` da 035): ela devolve EXCLUSIVAMENTE o `pixel_id`
 *   (nao-sensivel), nunca o Meta_Access_Token (que vive so no Vault — CP-7),
 *   nem `ad_account_id` ou demais campos administrativos. Assim o painel admin
 *   controla o `pixel_id` do site publico em runtime, sem novo deploy.
 *
 * Como a RPC e assincrona e o contrato `getPixelId` do `Pixel_Loader` e
 * SINCRONO (`() => string | null`), a leitura do banco e feita uma vez por
 * `fetchPublicPixelId()` (chamada pelo `PixelProvider` no mount) e o valor e
 * memoizado em modulo. `getPublicPixelId()` retorna esse valor memoizado de
 * forma sincrona.
 *
 * FALLBACK DE BUILD — `VITE_META_PIXEL_ID`:
 *   Enquanto a RPC ainda nao respondeu (ou falha por rede), `getPublicPixelId()`
 *   recai sobre a env publica de build `VITE_META_PIXEL_ID`, quando definida.
 *   Permite que o Pixel funcione em ambientes sem a config no banco e cobre o
 *   intervalo ate o primeiro fetch resolver. O valor do banco, quando presente,
 *   tem precedencia.
 *
 * Sem `pixel_id` no banco e sem `VITE_META_PIXEL_ID`, `getPublicPixelId()`
 * retorna `null` e o `Pixel_Loader` simplesmente nao injeta o script (Req 8.7).
 *
 * O `pixel_id` e SEMPRE validado contra o dominio numerico (mesmo CHECK de
 * `marketing_config.pixel_id`); valores fora do formato sao tratados como
 * ausentes (`null`).
 */

import { supabase } from '../supabase';

/** Dominio do `pixel_id` (espelha o CHECK `^[0-9]+$` de `marketing_config`). */
const PIXEL_ID_REGEX = /^[0-9]+$/;

/**
 * `pixel_id` memoizado lido de `marketing_config` via RPC. `null` ate o
 * primeiro fetch resolver com sucesso, ou quando a config nao tem `pixel_id`.
 */
let cachedPixelId: string | null = null;

/** Normaliza e valida um `pixel_id` bruto; fora do dominio numerico ⇒ `null`. */
function normalizePixelId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return PIXEL_ID_REGEX.test(trimmed) ? trimmed : null;
}

/** Le o `pixel_id` da env publica de build (fallback). Invalido/ausente ⇒ `null`. */
function getEnvPixelId(): string | null {
  return normalizePixelId(import.meta.env.VITE_META_PIXEL_ID);
}

/**
 * Le o `pixel_id` publico de forma SINCRONA, para o `getPixelId` do
 * `Pixel_Loader`. Precedencia: valor de `marketing_config` ja memoizado (via
 * `fetchPublicPixelId`) e, na ausencia dele, o fallback de build
 * (`VITE_META_PIXEL_ID`). `null` quando nenhuma fonte tem um `pixel_id` valido
 * (Req 8.7).
 */
export function getPublicPixelId(): string | null {
  return cachedPixelId ?? getEnvPixelId();
}

/**
 * Busca o `pixel_id` vigente de `marketing_config` via a RPC publica
 * `marketing_public_pixel_id()` (anon-segura) e o memoiza para leituras
 * sincronas subsequentes de `getPublicPixelId()`. Idempotente e tolerante a
 * falhas: erro de rede/RPC mantem o valor memoizado anterior (ou o fallback de
 * build via `getPublicPixelId`), sem lancar.
 *
 * Chamada pelo `PixelProvider` no mount do site publico. Retorna o `pixel_id`
 * efetivo apos a tentativa (banco ⇒ env ⇒ null), permitindo ao chamador
 * re-sincronizar o consentimento caso o `pixel_id` tenha se tornado disponivel.
 */
export async function fetchPublicPixelId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('marketing_public_pixel_id');
    if (!error) {
      const resolved = normalizePixelId(data);
      if (resolved) cachedPixelId = resolved;
    }
  } catch {
    // Degradacao segura: mantem o valor memoizado / fallback de build.
  }
  return getPublicPixelId();
}

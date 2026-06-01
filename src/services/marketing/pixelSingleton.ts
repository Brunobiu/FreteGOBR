/**
 * marketing/pixelSingleton.ts
 *
 * Acesso singleton ao `Pixel_Loader` do site publico (admin-marketing 048,
 * Epico 7 — task 7.4). Garante que o loader seja criado UMA UNICA VEZ por
 * sessao do navegador e sobreviva a navegacao (SPA) e a remontagens de
 * componentes (ex.: React StrictMode em dev), preservando a flag idempotente de
 * injecao do script (CP-5).
 *
 * Liga as dependencias publicas do loader:
 *   - getConsent  -> `getConsentState` (estado LGPD; default `denied`).
 *   - getPixelId  -> `getPublicPixelId` (pixel_id de `marketing_config` via RPC
 *                    publica `marketing_public_pixel_id`, memoizado por
 *                    `fetchPublicPixelId`; fallback de build
 *                    `VITE_META_PIXEL_ID`).
 *
 * NAO e gated por permissoes administrativas — e um modulo PUBLICO (Req 8.8).
 */

import { createPixelLoader, type PixelLoader } from './pixelLoader';
import { getConsentState } from './consent';
import { getPublicPixelId } from './pixelId';

/** Instancia unica, criada sob demanda no primeiro acesso. */
let instance: PixelLoader | null = null;

/**
 * Retorna o `Pixel_Loader` singleton, criando-o na primeira chamada. As deps
 * publicas (consentimento + pixel_id) sao lidas em tempo de execucao pelo
 * proprio loader, entao a porta de consentimento (CP-5) reflete sempre o estado
 * vigente.
 */
export function getPixelLoader(): PixelLoader {
  if (!instance) {
    instance = createPixelLoader({
      getConsent: getConsentState,
      getPixelId: getPublicPixelId,
    });
  }
  return instance;
}

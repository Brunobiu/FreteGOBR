import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getPixelLoader } from '../../services/marketing/pixelSingleton';
import { getConsentState, subscribeConsent } from '../../services/marketing/consent';
import { fetchPublicPixelId } from '../../services/marketing/pixelId';
import { forwardCapiEvent } from '../../services/marketing/capiForward';
import { generateEventId } from '../../services/admin/marketing';
import { PixelContext, type PixelContextValue } from './pixelContext';

/**
 * components/marketing/PixelProvider.tsx
 *
 * Monta o `Pixel_Loader` no shell do site PUBLICO do FreteGO (admin-marketing
 * 048/049, Epico 7 — task 7.4). Responsabilidades:
 *   - Ligar o loader ao estado de consentimento LGPD (`consent.ts`) e ao
 *     `pixel_id` publico (`pixelId.ts`) via o singleton `pixelSingleton.ts`.
 *   - Carregar o `pixel_id` de `marketing_config` (RPC publica anon-segura
 *     `marketing_public_pixel_id`) no mount e re-sincronizar o consentimento
 *     quando ele resolver, de modo que um consentimento ja `granted` injete o
 *     script assim que o `pixel_id` ficar disponivel (CP-5, Req 8.7).
 *   - Sincronizar o consentimento inicial e reagir a transicoes
 *     (`subscribeConsent` -> `loader.syncConsent`), de modo que o `granted`
 *     injete o script no maximo uma vez (CP-5).
 *   - Disparar `page_view` a cada navegacao (mudanca de rota na SPA), com um
 *     `event_id` gerado UMA vez por ocorrencia (CP-4).
 *
 * NAO e gated por permissoes administrativas — modulo PUBLICO (Req 8.8). O
 * loader e um singleton que sobrevive a navegacao e a remontagens.
 *
 * O contexto/hook (`usePixel`) vive em `pixelContext.ts` para que este arquivo
 * exporte somente o componente.
 */
export function PixelProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const loader = getPixelLoader();

  // Sincroniza o consentimento inicial e assina transicoes futuras. Em
  // `granted`, o loader injeta o script no maximo uma vez (idempotente — CP-5).
  useEffect(() => {
    loader.syncConsent(getConsentState());
    const unsubscribe = subscribeConsent((state) => loader.syncConsent(state));
    return unsubscribe;
  }, [loader]);

  // Carrega o `pixel_id` de `marketing_config` (RPC publica) no mount. Quando
  // resolver, re-sincroniza o consentimento vigente: se ja for `granted`, o
  // loader injeta o script (antes ele nao injetava por falta de `pixel_id`).
  // Tolerante a falhas — `fetchPublicPixelId` nunca lanca (degrada para o
  // fallback de build / null).
  useEffect(() => {
    let active = true;
    void fetchPublicPixelId().then(() => {
      if (active) loader.syncConsent(getConsentState());
    });
    return () => {
      active = false;
    };
  }, [loader]);

  // Dispara `page_view` a cada navegacao. A chave e `pathname + search` para
  // capturar mudancas de rota e de query. O loader ignora o disparo quando o
  // consentimento nao e `granted` ou o Pixel nao esta inicializado (CP-5).
  const pageKey = `${location.pathname}${location.search}`;
  useEffect(() => {
    // CP-4: event_id gerado uma unica vez por ocorrencia do `page_view`.
    loader.track('page_view', generateEventId(), { page_path: pageKey });
  }, [loader, pageKey]);

  const contextValue = useRef<PixelContextValue>({
    trackEvent: (event, params) => {
      const eventId = generateEventId();
      loader.track(event, eventId, params);
      return eventId;
    },
    // CP-4: gera o event_id UMA UNICA vez e propaga o MESMO id aos dois canais —
    // Pixel (browser, gated por consentimento) e Edge meta-capi-forward (CAPI
    // server-side, fire-and-forget). A Meta deduplica pelo event_id compartilhado.
    trackBusinessEvent: (event, options) => {
      const eventId = generateEventId();
      // 1) Browser (Pixel): respeita consentimento/init dentro do loader (CP-5).
      loader.track(event, eventId, options?.params);
      // 2) Server (CAPI): mesmo event_id + PII disponivel. Fire-and-forget —
      // nunca lanca nem bloqueia o fluxo do usuario; independe do consentimento
      // do navegador (Req 9.3). A Edge hasheia a PII (CP-6) e le o token do
      // Vault (CP-7).
      void forwardCapiEvent({
        eventName: event,
        eventId,
        email: options?.email ?? null,
        phone: options?.phone ?? null,
        userId: options?.userId ?? null,
        visitorId: options?.visitorId ?? null,
      });
      return eventId;
    },
  });

  return <PixelContext.Provider value={contextValue.current}>{children}</PixelContext.Provider>;
}

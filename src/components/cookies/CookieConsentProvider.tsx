/**
 * components/cookies/CookieConsentProvider.tsx
 *
 * Provider do consentimento de cookies (Feature 3 — legal-banner-cookies).
 * Mantém o `ConsentState` em estado React, persiste via `services/cookieConsent`
 * e faz a PONTE com o Pixel: encaminha a categoria `marketing` para
 * `setConsentState` (services/marketing/consent.ts), de modo que o
 * `PixelProvider` existente carregue o Pixel se e somente se o visitante
 * consentiu marketing (LGPD por construção — Req 4.1, 4.2, 4.5).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readConsent,
  writeConsent,
  type CookieCategory,
  type ConsentState,
} from '../../services/cookieConsent';
import { setConsentState } from '../../services/marketing/consent';
import { CookieConsentContext, type CookieConsentContextValue } from './cookieConsentContext';

/** Encaminha o estado de `marketing` para a porta de consentimento do Pixel. */
function syncPixelConsent(state: ConsentState | null): void {
  setConsentState(state?.categories.marketing === true ? 'granted' : 'denied');
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState | null>(() => readConsent());

  // Sincroniza o Pixel com o consentimento inicial (e em qualquer mudança).
  useEffect(() => {
    syncPixelConsent(consent);
  }, [consent]);

  const acceptAll = useCallback(() => {
    setConsent(writeConsent({ analytics: true, marketing: true }));
  }, []);

  const savePreferences = useCallback((prefs: Partial<Record<CookieCategory, boolean>>) => {
    setConsent(writeConsent(prefs));
  }, []);

  const has = useCallback(
    (category: CookieCategory): boolean => {
      if (category === 'necessary') return true;
      return consent?.categories[category] === true;
    },
    [consent]
  );

  const value = useMemo<CookieConsentContextValue>(
    () => ({
      consent,
      needsDecision: consent === null,
      acceptAll,
      savePreferences,
      has,
    }),
    [consent, acceptAll, savePreferences, has]
  );

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>;
}

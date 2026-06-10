/**
 * components/cookies/cookieConsentContext.ts
 *
 * Context + hook do consentimento de cookies (Feature 3). Mantido fora do
 * arquivo do Provider para que o módulo do Provider exporte apenas o componente
 * (regra react-refresh / fast-refresh do projeto).
 */

import { createContext, useContext } from 'react';
import type { CookieCategory, ConsentState } from '../../services/cookieConsent';

export interface CookieConsentContextValue {
  /** Estado vigente; `null` enquanto o visitante não decidiu. */
  consent: ConsentState | null;
  /** `true` ⇒ o banner deve aparecer. */
  needsDecision: boolean;
  /** Concede todas as categorias (necessary + analytics + marketing). */
  acceptAll(): void;
  /** Persiste exatamente as categorias escolhidas (necessary sempre on). */
  savePreferences(prefs: Partial<Record<CookieCategory, boolean>>): void;
  /** Consulta se uma categoria está concedida. `necessary` sempre `true`. */
  has(category: CookieCategory): boolean;
}

export const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

/** Hook de acesso ao consentimento. Lança fora do Provider (erro de montagem). */
export function useCookieConsent(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (ctx === null) {
    throw new Error('useCookieConsent deve ser usado dentro de <CookieConsentProvider>.');
  }
  return ctx;
}

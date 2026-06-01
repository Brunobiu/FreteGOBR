/**
 * marketing/consent.ts
 *
 * Fonte de verdade do estado de consentimento de cookies (LGPD) do visitante
 * do site publico do FreteGO. Alimenta o `getConsent` do `Pixel_Loader`
 * (admin-marketing 048, Epico 7 — task 7.4).
 *
 * IMPORTANTE (CP-5 — porta de consentimento do Pixel):
 *   - O estado inicial e SEMPRE `denied`. Nada e disparado/injetado pelo Pixel
 *     enquanto o consentimento nao for explicitamente concedido. Isto e uma
 *     decisao de seguranca: NUNCA assumir consentimento por padrao.
 *
 * PONTO DE INTEGRACAO (banner de cookies LGPD):
 *   Ainda NAO existe um banner de consentimento de cookies no projeto (busca por
 *   "consent"/"lgpd"/"cookie" nao encontrou mecanismo previo). Este modulo e a
 *   fonte minima de consentimento. Quando o banner for implementado, ele deve:
 *     - chamar `setConsentState('granted')` quando o visitante ACEITAR cookies
 *       de marketing;
 *     - chamar `setConsentState('denied')` quando o visitante RECUSAR/revogar.
 *   O `Pixel_Loader` (via `subscribeConsent`) reage automaticamente a transicao
 *   para `granted` injetando o script no maximo uma vez (CP-5).
 *
 * O estado e persistido em `localStorage` para sobreviver a recargas de pagina;
 * falhas de acesso ao storage degradam de forma segura para `denied`.
 */

import type { ConsentState } from './pixelLoader';

export type { ConsentState };

/** Chave de persistencia do consentimento no `localStorage`. */
const STORAGE_KEY = 'fretego.cookie_consent';

/**
 * Le o estado inicial do `localStorage`. Qualquer valor diferente de `granted`
 * (ausente, invalido, ou erro de acesso) degrada para `denied` (CP-5 safety).
 */
function readInitialConsent(): ConsentState {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Ambiente sem `localStorage` (SSR/teste) ou bloqueado: default seguro.
    return 'denied';
  }
}

/** Estado vigente, lido de forma sincrona por `getConsentState`. */
let currentConsent: ConsentState = readInitialConsent();

/** Assinantes notificados a cada transicao de consentimento. */
const listeners = new Set<(state: ConsentState) => void>();

/**
 * Le o Consent_State VIGENTE de forma sincrona. Usado como `getConsent` do
 * `Pixel_Loader`, que reconsulta o consentimento no momento de cada disparo
 * (porta de consentimento — CP-5).
 */
export function getConsentState(): ConsentState {
  return currentConsent;
}

/**
 * Define o Consent_State e notifica os assinantes. Deve ser chamado pelo banner
 * de cookies LGPD (ver PONTO DE INTEGRACAO no cabecalho). Idempotente: definir o
 * mesmo estado novamente nao re-notifica.
 */
export function setConsentState(state: ConsentState): void {
  if (state === currentConsent) return;
  currentConsent = state;
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // Persistencia best-effort: o estado em memoria continua valido na sessao.
  }
  for (const listener of listeners) listener(state);
}

/**
 * Assina mudancas de consentimento. Retorna uma funcao de cancelamento. O
 * `PixelProvider` usa isto para encaminhar transicoes ao `Pixel_Loader`.
 */
export function subscribeConsent(listener: (state: ConsentState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

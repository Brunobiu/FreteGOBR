/**
 * services/cookieConsent.ts
 *
 * Store de consentimento de cookies (LGPD) do FreteGO — Feature 3
 * (legal-banner-cookies). Persiste a preferência do visitante por categoria
 * em `localStorage`, versionada por `CONSENT_VERSION`.
 *
 * Decisões de segurança (nunca assumir consentimento):
 *   - Estado ausente, corrompido ou de versão divergente ⇒ `needsDecision`
 *     true (banner reaparece).
 *   - `necessary` é SEMPRE concedido e imutável (sessão, segurança, tema).
 *   - Todo acesso ao `localStorage` é protegido por try/catch (modo privativo,
 *     SSR, storage bloqueado) e degrada para "sem decisão".
 *
 * Este módulo é a fonte de verdade das categorias. A ponte com o Pixel
 * (`services/marketing/consent.ts`) é feita pelo `CookieConsentProvider`, que
 * encaminha o estado de `marketing` para `setConsentState`.
 */

/** Categorias de cookies. `necessary` é sempre concedido. */
export type CookieCategory = 'necessary' | 'analytics' | 'marketing';

/** Estado de consentimento persistido. */
export interface ConsentState {
  /** Versão do esquema/política de consentimento. */
  version: number;
  /** Instante ISO da decisão do visitante. */
  decidedAt: string;
  /** Mapa categoria → concedida. `necessary` sempre `true`. */
  categories: Record<CookieCategory, boolean>;
}

/** Versão atual. Bump força re-pergunta sem migração. */
export const CONSENT_VERSION = 1;

/** Chave de persistência no `localStorage`. */
export const STORAGE_KEY = 'fretego-cookie-consent';

/** Categorias não-essenciais (toggláveis pelo visitante). */
export const TOGGLEABLE_CATEGORIES: ReadonlyArray<Exclude<CookieCategory, 'necessary'>> = [
  'analytics',
  'marketing',
];

/**
 * Normaliza um conjunto de categorias garantindo `necessary=true` e que
 * `analytics`/`marketing` sejam booleanos (default `false` quando ausente).
 */
function normalizeCategories(
  partial: Partial<Record<CookieCategory, boolean>>
): Record<CookieCategory, boolean> {
  return {
    necessary: true,
    analytics: partial.analytics === true,
    marketing: partial.marketing === true,
  };
}

/**
 * Lê o `ConsentState` persistido. Retorna `null` quando ausente, corrompido ou
 * de versão divergente (todos os casos ⇒ precisa decidir de novo).
 */
export function readConsent(): ConsentState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== CONSENT_VERSION
    ) {
      return null;
    }
    const obj = parsed as Partial<ConsentState> & { categories?: unknown };
    const cats = obj.categories;
    if (typeof cats !== 'object' || cats === null) return null;

    return {
      version: CONSENT_VERSION,
      decidedAt: typeof obj.decidedAt === 'string' ? obj.decidedAt : new Date().toISOString(),
      categories: normalizeCategories(cats as Partial<Record<CookieCategory, boolean>>),
    };
  } catch {
    // JSON corrompido ⇒ tratar como sem decisão (banner reaparece).
    return null;
  }
}

/**
 * Persiste a escolha do visitante. `necessary` é sempre forçado `true`. Retorna
 * o `ConsentState` efetivamente gravado (em memória mesmo se a persistência
 * falhar). Sempre carimba `version` corrente e `decidedAt` agora.
 */
export function writeConsent(partial: Partial<Record<CookieCategory, boolean>>): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    categories: normalizeCategories(partial),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistência best-effort: o estado em memória vale para a sessão.
  }
  return state;
}

/**
 * Indica se o banner deve ser exibido: `true` quando não há `ConsentState`
 * válido na versão corrente (ausente, corrompido ou versão divergente).
 */
export function needsDecision(): boolean {
  return readConsent() === null;
}

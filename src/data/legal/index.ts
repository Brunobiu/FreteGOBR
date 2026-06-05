/**
 * Metadados e versionamento dos documentos legais (Feature 1 — legal).
 *
 * Fonte única de verdade para versão e data de atualização dos documentos
 * legais. A `version` (data ISO) é consumida pela Feature 2 (aceite
 * obrigatório) para registrar qual versão o usuário aceitou.
 *
 * Ao alterar o conteúdo de um documento (termsContent / privacyContent),
 * SEMPRE atualizar `version` e `updatedAt` aqui (Requirement 3.2).
 */

export type LegalDocKey = 'terms' | 'privacy';

export interface LegalDocMeta {
  key: LegalDocKey;
  /** Título exibido no topo e no document.title. */
  title: string;
  /** Versão canônica (data ISO YYYY-MM-DD) — consumida pela Feature 2. */
  version: string;
  /** Data legível para exibição (pt-BR). */
  updatedAt: string;
  /** Rota pública do documento. */
  route: string;
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDocMeta> = {
  terms: {
    key: 'terms',
    title: 'Termos de Uso',
    version: '2026-06-05',
    updatedAt: '05 de junho de 2026',
    route: '/termos',
  },
  privacy: {
    key: 'privacy',
    title: 'Política de Privacidade',
    version: '2026-06-05',
    updatedAt: '05 de junho de 2026',
    route: '/privacidade',
  },
};

/**
 * Versão combinada dos documentos legais, usada pela Feature 2 ao registrar
 * o aceite. Formato determinístico: `terms@<v>|privacy@<v>`.
 */
export function currentLegalVersion(): string {
  return `terms@${LEGAL_DOCS.terms.version}|privacy@${LEGAL_DOCS.privacy.version}`;
}

import { TERMS_SECTIONS } from './termsContent';
import { PRIVACY_SECTIONS } from './privacyContent';
import type { LegalSection } from './types';

/** Seções de conteúdo por documento. */
export const LEGAL_SECTIONS: Record<LegalDocKey, LegalSection[]> = {
  terms: TERMS_SECTIONS,
  privacy: PRIVACY_SECTIONS,
};

export type { LegalSection } from './types';

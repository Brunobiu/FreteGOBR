/**
 * components/cookies/CookieBanner.tsx
 *
 * Banner de cookies LGPD (Feature 3 — Req 1, 5). Fixo no rodapé, exibido só
 * quando o visitante ainda não decidiu (`needsDecision`). Não bloqueia a
 * navegação. Botões "Aceitar" (acceptAll) e "Configurar" (abre o painel).
 * Responsivo e navegável por teclado.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCookieConsent } from './cookieConsentContext';
import { LEGAL_DOCS } from '../../data/legal';
import CookiePreferencesModal from './CookiePreferencesModal';

export default function CookieBanner() {
  const { needsDecision, acceptAll } = useCookieConsent();
  const [showPrefs, setShowPrefs] = useState(false);

  if (!needsDecision) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Aviso de cookies"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-600">
            Usamos cookies para operar a plataforma e, com seu consentimento, para análise e
            marketing. Veja a{' '}
            <Link
              to={LEGAL_DOCS.privacy.route}
              className="font-medium text-blue-600 underline hover:text-blue-700"
            >
              Política de Privacidade
            </Link>
            .
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPrefs(true)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Configurar
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Aceitar
            </button>
          </div>
        </div>
      </div>

      {showPrefs && <CookiePreferencesModal onClose={() => setShowPrefs(false)} />}
    </>
  );
}

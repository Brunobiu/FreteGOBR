/**
 * components/cookies/CookiePreferencesModal.tsx
 *
 * Painel de configuração de cookies por categoria (Feature 3 — Req 3).
 *  - `necessary`: sempre ativo, toggle desabilitado.
 *  - `analytics` e `marketing`: toggláveis.
 *  - "Salvar preferências" persiste exatamente o escolhido.
 *  - ESC fecha sem salvar; foco inicial no painel (acessibilidade — Req 5.4).
 */

import { useEffect, useRef, useState } from 'react';
import { useCookieConsent } from './cookieConsentContext';
import type { CookieCategory } from '../../services/cookieConsent';

interface CategoryInfo {
  key: CookieCategory;
  label: string;
  description: string;
  locked?: boolean;
}

const CATEGORIES: CategoryInfo[] = [
  {
    key: 'necessary',
    label: 'Essenciais',
    description:
      'Necessários para o funcionamento do site (sessão, segurança e preferências). Sempre ativos.',
    locked: true,
  },
  {
    key: 'analytics',
    label: 'Análise',
    description:
      'Ajudam a entender como o site é usado para melhorarmos a experiência. Dados agregados.',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    description:
      'Permitem medir campanhas e exibir conteúdo relevante. Habilitam o pixel de anúncios.',
  },
];

export default function CookiePreferencesModal({ onClose }: { onClose: () => void }) {
  const { consent, savePreferences } = useCookieConsent();
  const panelRef = useRef<HTMLDivElement>(null);

  const [analytics, setAnalytics] = useState<boolean>(consent?.categories.analytics === true);
  const [marketing, setMarketing] = useState<boolean>(consent?.categories.marketing === true);

  // Foco inicial no painel + ESC fecha sem salvar (Req 5.4).
  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleSave() {
    savePreferences({ analytics, marketing });
    onClose();
  }

  const toggleState: Record<string, boolean> = { analytics, marketing };
  const setToggle: Record<string, (v: boolean) => void> = {
    analytics: setAnalytics,
    marketing: setMarketing,
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-prefs-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cookie-prefs-title" className="text-base font-semibold text-gray-900">
          Preferências de cookies
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Escolha quais categorias deseja permitir. Você pode alterar isso a qualquer momento.
        </p>

        <ul className="mt-4 space-y-3">
          {CATEGORIES.map((cat) => (
            <li
              key={cat.key}
              className="flex items-start justify-between gap-3 rounded-md border border-gray-200 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{cat.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{cat.description}</p>
              </div>
              <label className="flex shrink-0 items-center">
                <span className="sr-only">{cat.label}</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={cat.locked ? true : toggleState[cat.key]}
                  disabled={cat.locked}
                  onChange={(e) => setToggle[cat.key]?.(e.target.checked)}
                  aria-label={cat.label}
                />
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Salvar preferências
          </button>
        </div>
      </div>
    </div>
  );
}

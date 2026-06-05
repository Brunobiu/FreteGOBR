/**
 * LegalPage — layout compartilhado das páginas legais (Feature 1 — legal).
 *
 * Renderiza Termos de Uso ou Política de Privacidade a partir do módulo
 * de conteúdo versionado. Header com título, data de atualização e versão;
 * corpo em coluna única (legível em mobile); rodapé global.
 */

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { LEGAL_DOCS, LEGAL_SECTIONS, type LegalDocKey } from '../../data/legal';
import SiteFooter from '../SiteFooter';

interface LegalPageProps {
  doc: LegalDocKey;
}

export default function LegalPage({ doc }: LegalPageProps) {
  const meta = LEGAL_DOCS[doc];
  const sections = LEGAL_SECTIONS[doc];
  useDocumentTitle(meta.title);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header simples com logo + voltar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" aria-label="FreteGO" className="flex items-center">
            <img
              src="/logo.png"
              alt="FreteGO"
              className="h-9 sm:h-10 w-auto object-contain select-none"
              draggable={false}
            />
          </Link>
          <Link to="/" className="text-sm font-medium text-gray-600 hover:text-gray-900">
            Voltar ao início
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-gray-900">{meta.title}</h1>
          <p className="mt-1 text-xs text-gray-500">
            Última atualização: {meta.updatedAt} · versão {meta.version}
          </p>

          {/* Índice de seções (âncoras) */}
          {sections.length > 1 && (
            <nav
              aria-label="Índice"
              className="mt-5 rounded-lg border border-gray-200 bg-white p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
                Conteúdo
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-xs text-blue-700 hover:underline leading-relaxed"
                    >
                      {s.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-6 space-y-7">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <h2 className="text-base font-semibold text-gray-800">{s.heading}</h2>
                <div className="mt-2 space-y-2">
                  {s.body.map((p, i) => (
                    <p key={i} className="text-sm text-gray-700 leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
                {s.bullets && s.bullets.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {s.bullets.map((b, i) => (
                      <li key={i} className="text-sm text-gray-700 leading-relaxed">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

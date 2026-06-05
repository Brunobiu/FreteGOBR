/**
 * SiteFooter — rodapé global com links legais (Feature 1 — legal).
 *
 * Usado nas páginas públicas (login, cadastro, home pública) e nas
 * páginas legais. Centraliza os links para Termos de Uso e Política de
 * Privacidade, evitando footers ad-hoc divergentes.
 */

import { Link } from 'react-router-dom';
import { LEGAL_DOCS } from '../data/legal';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-gray-200 px-4 py-4">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
        <p>© {year} FreteGO — Todos os direitos reservados.</p>
        <nav className="flex items-center gap-4" aria-label="Links legais">
          <Link to={LEGAL_DOCS.terms.route} className="hover:text-gray-800 hover:underline">
            {LEGAL_DOCS.terms.title}
          </Link>
          <Link to={LEGAL_DOCS.privacy.route} className="hover:text-gray-800 hover:underline">
            {LEGAL_DOCS.privacy.title}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

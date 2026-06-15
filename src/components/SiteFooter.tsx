/**
 * SiteFooter — rodapé global (Feature 1 — legal + identidade).
 *
 * Usado nas páginas públicas (landing, login, cadastro) e nas páginas
 * legais. Reúne:
 *   - Logo do FreteGO + tagline curta.
 *   - Links úteis (Termos, Privacidade, Contato).
 *   - Ícones de redes sociais (Facebook, Instagram, TikTok).
 *   - Barra inferior: direitos reservados (esquerda) e "Desenvolvido por"
 *     com a logo da Synova Sistemas (direita), clicável para o site dela.
 */

import { Link } from 'react-router-dom';
import { LEGAL_DOCS } from '../data/legal';

const SOCIALS = [
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/',
    icon: (
      <path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" />
    ),
  },
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/',
    icon: (
      <path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5.01-4.74.07-.9.04-1.39.19-1.71.32-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.13.32-.28.81-.32 1.71C3.21 8.5 3.2 8.85 3.2 12s.01 3.5.07 4.74c.04.9.19 1.39.32 1.71.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.13.81.28 1.71.32 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.9-.04 1.39-.19 1.71-.32.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.13-.32.28-.81.32-1.71.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.9-.19-1.39-.32-1.71a2.85 2.85 0 00-.69-1.06 2.85 2.85 0 00-1.06-.69c-.32-.13-.81-.28-1.71-.32C15.5 4.01 15.15 4 12 4zm0 3.06A4.94 4.94 0 1012 16.94 4.94 4.94 0 0012 7.06zm0 1.8a3.14 3.14 0 110 6.28 3.14 3.14 0 010-6.28zm5.14-.7a1.15 1.15 0 11-2.3 0 1.15 1.15 0 012.3 0z" />
    ),
  },
  {
    name: 'TikTok',
    href: 'https://www.tiktok.com/',
    icon: (
      <path d="M16.5 3c.3 2.1 1.5 3.4 3.5 3.6v2.4c-1.2.1-2.3-.2-3.5-.9v6.1c0 3.1-2.3 5.3-5.2 5.3A5.1 5.1 0 016 14.4c0-3 2.5-5.2 5.6-4.9v2.5c-.4-.1-.9-.2-1.3-.1-1.3.1-2.2 1.1-2.1 2.5.1 1.3 1.1 2.2 2.4 2.1 1.3 0 2.2-1 2.2-2.5V3h2.7z" />
    ),
  },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-gray-200">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Linha principal: marca + links + redes */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          {/* Marca */}
          <div className="flex flex-col items-center sm:items-start gap-2">
            <img
              src="/logo.png"
              alt="FreteGO"
              className="h-9 w-auto object-contain select-none"
              draggable={false}
            />
            <p className="text-xs text-gray-500 max-w-[16rem] text-center sm:text-left">
              Fretes de carga, logística e automações.
            </p>
          </div>

          {/* Links úteis */}
          <nav
            className="flex flex-col items-center sm:items-start gap-1.5 text-xs text-gray-600"
            aria-label="Links do rodapé"
          >
            <span className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
              Institucional
            </span>
            <Link to={LEGAL_DOCS.terms.route} className="hover:text-gray-900 hover:underline">
              {LEGAL_DOCS.terms.title}
            </Link>
            <Link to={LEGAL_DOCS.privacy.route} className="hover:text-gray-900 hover:underline">
              {LEGAL_DOCS.privacy.title}
            </Link>
            <a href="mailto:contato@fretego.com.br" className="hover:text-gray-900 hover:underline">
              Contato
            </a>
          </nav>

          {/* Redes sociais */}
          <div className="flex flex-col items-center sm:items-start gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">
              Redes sociais
            </span>
            <div className="flex items-center gap-2.5">
              {SOCIALS.map((s) => (
                <a
                  key={s.name}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.name}
                  title={s.name}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-brand-green hover:text-white transition-colors"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                    {s.icon}
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Barra inferior: direitos (esquerda) + desenvolvido por (direita) */}
        <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500 text-center sm:text-left">
            © {year} FreteGO — Todos os direitos reservados.
          </p>

          <a
            href="https://synovasistemas.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 justify-center sm:justify-end group"
            aria-label="Desenvolvido por Synova Sistemas"
          >
            <span className="text-[11px] text-gray-400 group-hover:text-gray-600 transition-colors">
              Desenvolvido por
            </span>
            <img
              src="/synova-sistemas.png"
              alt="Synova Sistemas"
              className="h-7 w-auto object-contain select-none"
              draggable={false}
              loading="lazy"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}

/**
 * PublicHeader — cabeçalho único das páginas públicas do FreteGO
 * (landing, páginas de público e páginas de detalhe "Saiba mais").
 *
 * Garante o MESMO cabeçalho em toda página: logo (esquerda), navegação
 * (Início, Como funciona, Vantagens), botão "Entrar" e menu hambúrguer no
 * mobile. Duas variantes:
 *   - variant="landing": fixo e translúcido sobre o hero; vira barra branca
 *     (frosted) mais opaca ao rolar. Usado só na landing (rota `/`).
 *   - variant="solid": barra branca sólida, sticky no topo. Usado nas demais
 *     páginas públicas (não têm hero de vídeo atrás).
 *
 * Navegação ciente da rota: na landing (`/`) os links rolam suavemente até a
 * seção; em qualquer outra página, navegam para `/#secao` (a landing rola até
 * a âncora ao montar — ver efeito de hash em LandingPage).
 *
 * Observação de testes: o markup do menu mobile (#mobile-menu,
 * aria-controls="mobile-menu", aria-expanded) e as âncoras `#id` são cobertos
 * por src/__tests__/landingPage.test.tsx — preservar ao alterar.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AccessButton } from './AccessChoice';

/**
 * Links de navegação do header. `id` casa com a âncora da seção na landing.
 * Sem "Planos": a landing não exibe planos/preços (estratégia de trial).
 */
export const NAV_LINKS = [
  { id: 'inicio', label: 'Início' },
  { id: 'vantagens', label: 'Vantagens' },
  { id: 'como-funciona', label: 'Como funciona' },
] as const;

type IconProps = { className?: string };

function MenuIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default function PublicHeader({ variant = 'solid' }: { variant?: 'landing' | 'solid' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const onLanding = location.pathname === '/';

  // Só a variante "landing" reage ao scroll (fica mais opaca/compacta).
  useEffect(() => {
    if (variant !== 'landing') return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll(); // estado inicial (ex.: reload já rolado)
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [variant]);

  /**
   * Clique num link de navegação. Sempre fecha o menu mobile. Na landing rola
   * suave até a seção; fora dela, navega para `/#secao` (SPA, sem reload — a
   * landing rola até a âncora ao montar).
   */
  function handleNav(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    setMenuOpen(false);
    if (onLanding) {
      const el = document.getElementById(id);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      navigate(`/#${id}`);
    }
  }

  const headerClass =
    variant === 'landing'
      ? `fixed inset-x-0 top-0 z-50 border-b px-4 backdrop-blur-md transition-all duration-300 ${
          scrolled
            ? 'border-gray-200 bg-white/90 py-2.5 shadow-sm sm:py-3'
            : 'border-white/40 bg-white/80 py-3 sm:py-4'
        }`
      : 'sticky inset-x-0 top-0 z-50 border-b border-gray-200 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur-md sm:py-3';

  // href semântico (SEO/click-do-meio): âncora local na landing, `/#id` fora.
  const hrefFor = (id: string) => (onLanding ? `#${id}` : `/#${id}`);

  return (
    <header className={headerClass}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        {/* Logo (esquerda) */}
        <Link to="/" aria-label="FreteGO" className="flex items-center">
          <img
            src="/logo.png"
            alt="FreteGO"
            className="h-8 w-auto select-none object-contain sm:h-9"
            draggable={false}
          />
        </Link>

        {/* Direita: navegação encostada no "Entrar" (desktop) + hambúrguer.
            No mobile a nav some (vira hambúrguer) — layout do celular igual. */}
        <div className="flex items-center gap-2 md:gap-5">
          {/* Navegação (desktop) — fica do lado, perto do botão Entrar */}
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={hrefFor(link.id)}
                onClick={(e) => handleNav(e, link.id)}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-900/5 hover:text-brand-green"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <AccessButton
            to="/login"
            className="rounded-full bg-brand-green px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-greenDark"
          >
            Entrar
          </AccessButton>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-gray-900/5 text-gray-700 backdrop-blur-sm transition-colors hover:bg-gray-900/10 md:hidden"
          >
            {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menu mobile (dropdown) */}
      {menuOpen && (
        <div
          id="mobile-menu"
          className="mx-auto mt-2 max-w-6xl rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-xl backdrop-blur-md md:hidden"
        >
          <nav className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={hrefFor(link.id)}
                onClick={(e) => handleNav(e, link.id)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-900/5"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

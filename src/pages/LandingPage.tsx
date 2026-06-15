/**
 * LandingPage — página de entrada pública do FreteGO (rota `/` para
 * visitantes não logados).
 *
 * Hero no estilo "marketplace": fundo verde escuro com imagem opcional e
 * overlay, headline em duas cores, pills de destaque e dois CTAs.
 *
 * Identidade visual (cores extraídas da logo):
 *  - Verde da marca: brand-green (#007848).
 *  - Azul-marinho: brand-navy (#0a2a40).
 *  - Acento lima: brand-lime (#c8cc1e).
 *  - Fundo do hero: gradiente marinho → verde da marca.
 *
 * Imagem de fundo (trocar depois sem mexer no código):
 *  - Basta colocar o arquivo `public/landing-hero.jpg`. Ele é aplicado
 *    por cima do gradiente com um overlay escuro para manter o texto
 *    legível. Enquanto o arquivo não existir, fica só o gradiente +
 *    textura de estrada (SVG inline), então nada quebra.
 *
 * Fluxo: Landing → "Ver fretes" (/fretes) → cadastro/login.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import SiteFooter from '../components/SiteFooter';
import WelcomeSplash, { hasSeenWelcome } from '../components/WelcomeSplash';

/* Ícones em SVG inline (convenção do projeto: não usar libs de ícone). */
type IconProps = { className?: string };

function Truck({ className }: IconProps) {
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
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </svg>
  );
}

function ArrowRight({ className }: IconProps) {
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
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function MapPin({ className }: IconProps) {
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
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function BadgeCheck({ className }: IconProps) {
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
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function Zap({ className }: IconProps) {
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
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

export default function LandingPage() {
  useDocumentTitle(null);
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(() => !hasSeenWelcome());

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {showSplash && <WelcomeSplash durationMs={4000} onDone={() => setShowSplash(false)} />}

      {/* ===================== HERO ===================== */}
      <section className="relative overflow-hidden">
        {/* Camada 1: gradiente da marca (marinho → verde da logo) */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navyDeep via-brand-navy to-brand-green" />

        {/* Camada 2: imagem de fundo opcional (public/landing-hero.jpg).
            Se o arquivo não existir, só não aparece nada e o gradiente
            continua valendo. */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40"
          style={{ backgroundImage: "url('/landing-hero.jpg')" }}
          aria-hidden="true"
        />

        {/* Camada 3: textura de estrada/rota em SVG (dá movimento ao fundo) */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.12]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="road" width="120" height="120" patternUnits="userSpaceOnUse">
              <path d="M0 60 H120" stroke="white" strokeWidth="2" strokeDasharray="18 14" />
              <path d="M60 0 V120" stroke="white" strokeWidth="1" strokeOpacity="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#road)" />
        </svg>

        {/* Camada 4: overlay escuro para legibilidade do texto */}
        <div className="absolute inset-0 bg-black/30" />

        {/* Conteúdo do hero */}
        <div className="relative">
          {/* Header flutuante: barra arredondada translúcida centralizada,
              estilo "pill" sobreposta ao hero (efeito glass). */}
          <header className="px-4 pt-4 sm:pt-6">
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 shadow-lg shadow-black/20 backdrop-blur-md">
              <Link to="/" aria-label="FreteGO" className="flex items-center pl-1">
                <img
                  src="/logo.png"
                  alt="FreteGO"
                  className="h-8 sm:h-10 w-auto object-contain select-none"
                  draggable={false}
                />
              </Link>

              <nav className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/fretes')}
                  className="px-3 sm:px-4 py-1.5 text-sm font-semibold bg-brand-green text-white rounded-full hover:bg-brand-greenDark transition-colors shadow-sm"
                >
                  Ver fretes
                </button>
              </nav>
            </div>
          </header>

          {/* Bloco principal */}
          <div className="max-w-6xl mx-auto px-4 pt-8 pb-14 sm:pt-16 sm:pb-28">
            <div className="max-w-2xl">
              <h1 className="text-[1.6rem] leading-tight sm:text-4xl lg:text-5xl font-extrabold text-white">
                Fretes que cabem
                <br className="hidden sm:block" /> na sua rota.
                <span className="block text-brand-lime mt-1">Sem intermediário.</span>
              </h1>

              <p className="mt-4 text-sm sm:text-base lg:text-lg text-white/80 max-w-xl">
                O FreteGO conecta caminhoneiros e embarcadores em todo o Brasil. Encontre cargas
                perto de você e negocie direto, do jeito mais simples.
              </p>

              {/* Pills de destaque */}
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-2.5 py-1 text-[11px] sm:text-xs font-medium text-white backdrop-blur-sm">
                  <BadgeCheck className="h-3.5 w-3.5 text-brand-lime" />
                  100% gratuito para começar
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-2.5 py-1 text-[11px] sm:text-xs font-medium text-white backdrop-blur-sm">
                  <Zap className="h-3.5 w-3.5 text-brand-lime" />
                  Sem burocracia
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-2.5 py-1 text-[11px] sm:text-xs font-medium text-white backdrop-blur-sm">
                  <MapPin className="h-3.5 w-3.5 text-brand-lime" />
                  Cargas perto de você
                </span>
              </div>

              {/* CTAs */}
              <div className="mt-7 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/fretes')}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 sm:px-6 sm:py-3 text-sm sm:text-base font-semibold bg-brand-green text-white rounded-xl hover:bg-brand-greenDark transition-colors shadow-lg shadow-black/30"
                >
                  <Truck className="h-4 w-4 sm:h-5 sm:w-5" />
                  Ver fretes
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <p className="mt-4 text-xs text-white/70">
                Já tem conta?{' '}
                <Link to="/login" className="text-brand-lime font-medium hover:underline">
                  Entrar
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== VITRINE DO APP ===================== */}
      {/* Seção para mostrar passo a passo / vantagens do app. Os "celulares"
          são placeholders: troque o conteúdo de cada PhoneMock (ou coloque
          uma <img> da screenshot real) quando tiver as telas finais. */}
      <section className="bg-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-12 sm:py-20 text-center">
          {/* Pill */}
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-green/10 border border-brand-green/20 px-3 py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-brand-green">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
            Aplicativo
          </span>

          {/* Título em duas fontes */}
          <h2 className="mt-4 text-2xl leading-tight sm:text-4xl lg:text-5xl font-extrabold text-gray-900">
            Seu frete na palma
            <span className="block font-serif italic font-medium text-brand-green">da sua mão</span>
          </h2>

          <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-xl mx-auto">
            Encontre cargas, acompanhe sua rota e fale com o embarcador direto pelo app. Tudo
            simples, rápido e pensado pra estrada.
          </p>

          {/* Vitrine de celulares */}
          <div className="mt-8 sm:mt-12 flex items-end justify-center gap-2.5 sm:gap-5 overflow-x-auto pb-4 -mx-4 px-4">
            <PhoneMock className="hidden sm:block scale-90 opacity-70" label="Mapa" />
            <PhoneMock className="scale-95" label="Detalhe do frete" />
            <PhoneMock className="z-10 shadow-2xl" label="Lista de fretes" highlight />
            <PhoneMock className="scale-95" label="Mensagens" />
            <PhoneMock className="hidden sm:block scale-90 opacity-70" label="Perfil" />
          </div>

          {/* Indicadores (decorativos por enquanto) */}
          <div className="mt-6 flex items-center justify-center gap-1.5">
            <span className="h-1.5 w-6 rounded-full bg-brand-green" />
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/**
 * PhoneMock — moldura de celular placeholder para a vitrine do app.
 * Troque o conteúdo interno por uma <img src="/app-xxx.png" /> quando
 * tiver as screenshots reais.
 */
function PhoneMock({
  className = '',
  label,
  highlight = false,
}: {
  className?: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative shrink-0 w-28 sm:w-44 aspect-[9/19] rounded-[1.5rem] sm:rounded-[1.75rem] border-[5px] sm:border-[6px] border-gray-900 bg-gray-900 shadow-xl ${className}`}
    >
      {/* Notch */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-16 bg-gray-900 rounded-b-xl z-10" />
      {/* Tela (placeholder) */}
      <div
        className={`h-full w-full rounded-[1.25rem] overflow-hidden flex flex-col ${
          highlight
            ? 'bg-gradient-to-b from-brand-green/10 to-white'
            : 'bg-gradient-to-b from-gray-50 to-white'
        }`}
      >
        <div className="h-12 bg-brand-green flex items-center px-3">
          <div className="h-2 w-12 bg-white/80 rounded-full" />
        </div>
        <div className="flex-1 p-2.5 space-y-2">
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
        </div>
        <div className="px-3 pb-3">
          <span className="text-[10px] font-medium text-gray-400">{label}</span>
        </div>
      </div>
    </div>
  );
}

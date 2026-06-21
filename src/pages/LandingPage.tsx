/**
 * LandingPage — página de entrada pública do FreteGO (rota `/` para
 * visitantes não logados).
 *
 * Estrutura atual (construída em passos):
 *  - Header fixo: logo (esquerda), navegação (Início, Como funciona,
 *    Vantagens, Planos) e botão "Entrar" (direita). No mobile a nav vira um
 *    menu hambúrguer; a ordem da direita fica [Entrar] [☰]. Transparente
 *    sobre o hero no topo; vira barra cinza-clara ao rolar.
 *  - Hero: foto de fundo real (`/landing-fundo.jpg`) com overlay para
 *    legibilidade, headline autoral e os dois botões de loja
 *    (App Store + Google Play).
 *  - Footer (SiteFooter na web / AppMiniFooter no app nativo).
 *
 * As demais seções (Como funciona, Vantagens, etc.) serão adicionadas
 * incrementalmente abaixo do hero. Enquanto não existirem, os links de nav
 * correspondentes apenas não rolam (no-op seguro).
 *
 * Identidade visual (cores da logo, ver tailwind.config.js):
 *  - brand-green #007848 / brand-greenDark / brand-navy / brand-navyDeep /
 *    brand-lime (acento).
 *
 * Foto de fundo: `public/landing-fundo.jpg` (versão web otimizada da arte
 * original em `fotos/`). Para trocar, basta substituir esse arquivo.
 *
 * Lojas: o app ainda não está publicado — os botões apontam para a página
 * oficial "App em breve" (`/links/app.html`). Quando publicar, troque as
 * constantes APP_STORE_URL / PLAY_STORE_URL pelos links reais.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import SiteFooter from '../components/SiteFooter';
import AppMiniFooter from '../components/AppMiniFooter';
import { getPublicStats, type PublicStats } from '../services/publicStats';

/** Links de navegação do header (id = âncora da seção correspondente). */
export const NAV_LINKS = [
  { id: 'inicio', label: 'Início' },
  { id: 'como-funciona', label: 'Como funciona' },
  { id: 'vantagens', label: 'Vantagens' },
  { id: 'planos', label: 'Planos' },
] as const;

/**
 * URLs das lojas. App ainda não publicado: ambos apontam para a página
 * "App em breve". Trocar pelos links reais quando publicar:
 *  - Play Store: https://play.google.com/store/apps/details?id=br.com.fretego.app
 *  - App Store:  https://apps.apple.com/app/id<APP_ID_NUMERICO>
 */
export const PLAY_STORE_URL = '/links/app.html';
export const APP_STORE_URL = '/links/app.html';

/**
 * Mídia de fundo do hero. Em vez de uma foto estática, usamos um vídeo curto
 * em loop (mudo) pra dar movimento. A foto-poster aparece na hora enquanto o
 * vídeo carrega e também é o fallback pra quem prefere menos animação
 * (prefers-reduced-motion). Ambos otimizados para web em public/:
 *  - landing-hero.mp4 (540p, ~6,5 MB, H.264, autoplay-ready)
 *  - landing-hero-poster.jpg (~250 KB, frame do próprio vídeo)
 * Para trocar, substitua esses arquivos (gerados a partir da arte em fotos/).
 */
const HERO_VIDEO = '/landing-hero.mp4';
const HERO_POSTER = '/landing-hero-poster.jpg';

/**
 * Definição das métricas da seção "Nossos números". Os valores vêm ao vivo
 * do banco (RPC public_stats via getPublicStats); `key` casa com as chaves
 * retornadas. Conteúdo: quantidade de fretes, caminhoneiros e embarcadores.
 */
const STAT_DEFS = [
  { key: 'fretes', label: 'Fretes ativos' },
  { key: 'motoristas', label: 'Caminhoneiros' },
  { key: 'embarcadores', label: 'Embarcadores' },
] as const;

/** Formata contagem no padrão pt-BR (ex.: 1234 → "1.234"). */
function formatCount(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

/* ===================== Ícones (SVG inline — convenção do projeto) ===================== */
type IconProps = { className?: string };

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

/** Logo da Apple (monocromática) para o botão da App Store. */
function Apple({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.564 13.13c-.03-3.05 2.49-4.51 2.6-4.58-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.41-1.07-3.96-1.04-2.04.03-3.92 1.18-4.97 3.01-2.12 3.68-.54 9.12 1.52 12.11 1.01 1.46 2.21 3.1 3.78 3.04 1.52-.06 2.09-.98 3.93-.98 1.83 0 2.35.98 3.96.95 1.63-.03 2.66-1.49 3.66-2.96 1.15-1.69 1.62-3.32 1.65-3.41-.04-.02-3.17-1.22-3.2-4.83z" />
      <path d="M14.78 4.27c.84-1.02 1.41-2.43 1.25-3.84-1.21.05-2.68.81-3.54 1.83-.78.9-1.46 2.34-1.28 3.71 1.35.11 2.73-.68 3.57-1.7z" />
    </svg>
  );
}

/** Logo do Google Play (monocromática) para o botão da Play Store. */
function GooglePlay({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.6 1.81C3.24 2 3 2.36 3 2.83v18.34c0 .47.24.83.6 1.02l.06.06 10.28-10.28v-.12L3.66 1.75l-.06.06z" />
      <path d="M17.3 8.42 13.94 12.06v.12l3.36 3.64.08-.05 4.06-2.31c1.16-.66 1.16-1.74 0-2.4l-4.06-2.31-.08-.04z" />
      <path d="M13.94 12.06 3.6 22.19c.38.4 1.01.45 1.72.05l11.98-6.81-3.36-3.37z" />
      <path d="M5.32 1.71C4.61 1.31 3.98 1.36 3.6 1.76l10.34 10.3 3.36-3.64L5.32 1.71z" />
    </svg>
  );
}

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

function Shield({ className }: IconProps) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/* ===================== Botão de loja (App Store / Google Play) ===================== */
function StoreBadge({
  href,
  topLabel,
  bottomLabel,
  icon,
}: {
  href: string;
  topLabel: string;
  bottomLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-black/70 px-2 py-1 text-white shadow-lg shadow-black/30 backdrop-blur-sm transition-colors hover:bg-black/85 sm:w-auto sm:justify-start sm:gap-2.5 sm:rounded-xl sm:px-4 sm:py-2.5"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col text-center leading-none sm:text-left">
        <span className="text-[9px] font-medium text-white/70 sm:text-[10px]">{topLabel}</span>
        <span className="text-[11px] font-semibold tracking-tight sm:text-sm">{bottomLabel}</span>
      </span>
    </a>
  );
}

/* ===================== Página ===================== */
export default function LandingPage() {
  useDocumentTitle(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Header fixo: transparente sobre o hero no topo; ao rolar para baixo vira
  // uma barra cinza-clara (frosted) e o texto/ícones passam a ser escuros.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll(); // estado inicial (ex.: reload já rolado)
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Vídeo de fundo do hero em loop (mudo). Reforçamos o autoplay via ref —
  // alguns browsers ignoram o atributo `muted` quando setado só pelo React,
  // o que bloqueia o autoplay. O poster (frame do próprio vídeo) cobre o
  // intervalo até o vídeo começar e serve de fallback se o autoplay falhar.
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = heroVideoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {
      /* autoplay bloqueado pelo navegador: o poster permanece visível */
    });
  }, []);

  // Números públicos (RPC public_stats): undefined = carregando, null = erro/
  // indisponível (esconde a seção), objeto = dados reais do banco.
  const [stats, setStats] = useState<PublicStats | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getPublicStats().then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // App nativo (Android/iOS): rodapé mínimo. Web: SiteFooter completo.
  const isApp = Capacitor.isNativePlatform();

  /** Scroll suave até a seção e fecha o menu mobile. */
  function goToSection(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setMenuOpen(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      {/* ===================== HEADER (fixo) =====================
          No topo: transparente sobre a foto do hero (texto branco).
          Ao rolar: barra cinza-clara translúcida (texto escuro). */}
      <header
        className={`fixed inset-x-0 top-0 z-50 border-b px-4 backdrop-blur-md transition-all duration-300 ${
          scrolled
            ? 'border-gray-200 bg-white/90 py-2.5 shadow-sm sm:py-3'
            : 'border-white/40 bg-white/80 py-3 sm:py-4'
        }`}
      >
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

          {/* Navegação (desktop, centro) */}
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => goToSection(e, link.id)}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-900/5 hover:text-brand-green"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Direita: Entrar + hambúrguer (☰ é o item mais à direita no mobile) */}
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-full bg-brand-green px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-greenDark"
            >
              Entrar
            </Link>
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
                  href={`#${link.id}`}
                  onClick={(e) => goToSection(e, link.id)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-900/5"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* ===================== HERO ===================== */}
      <section id="inicio" className="relative overflow-hidden scroll-mt-20">
        {/* Camada 1: vídeo de fundo em loop (mudo, autoplay). O poster é um
            frame do próprio vídeo: aparece na hora e cobre o intervalo até o
            vídeo começar (ou caso o navegador bloqueie o autoplay). */}
        <video
          ref={heroVideoRef}
          className="absolute inset-0 h-full w-full object-cover"
          poster={HERO_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        >
          <source src={HERO_VIDEO} type="video/mp4" />
        </video>
        {/* Scrim neutro leve só à esquerda: mantém o texto branco legível
            sem jogar tom de cor sobre a imagem (removido o degradê colorido). */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/10 to-transparent" />

        {/* Conteúdo do hero acima das camadas de fundo. O header é fixo e
            mora fora desta seção (acima), sobreposto pela barra translúcida. */}
        <div className="relative z-10 flex min-h-[88vh] flex-col">
          {/* ---------- HERO CONTENT ----------
              Coluna que ocupa a altura do hero. No mobile o bloco de download
              é empurrado para o rodapé (mt-auto); no desktop volta a ficar logo
              abaixo do texto, com tudo centralizado verticalmente. */}
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8 pt-20 sm:justify-center sm:py-16">
            {/* Bloco de texto — no mobile fica centralizado verticalmente
                (my-auto), descendo pro meio do hero; no desktop volta a
                agrupar com o download (sm:my-0). */}
            <div className="my-auto max-w-2xl sm:my-0">
              <h1 className="text-shadow-soft text-2xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
                Fretes que ficam
                <br className="hidden sm:block" /> na sua rota.
                <span className="mt-1 block text-brand-lime">Sem intermediário.</span>
              </h1>

              <p className="text-shadow-soft mt-3 max-w-xl text-[0.82rem] leading-relaxed text-white/85 sm:mt-4 sm:text-base sm:leading-normal lg:text-lg">
                O FreteGO conecta caminhoneiros e embarcadores em todo o Brasil. Ache cargas perto
                de você, fale direto com quem contrata e feche o frete sem atravessador no meio.
              </p>

              {/* Pills de destaque */}
              <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-5 sm:gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                  <BadgeCheck className="h-3 w-3 text-brand-lime sm:h-3.5 sm:w-3.5" />
                  Grátis para começar
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                  <Zap className="h-3 w-3 text-brand-lime sm:h-3.5 sm:w-3.5" />
                  Sem burocracia
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                  <MapPin className="h-3 w-3 text-brand-lime sm:h-3.5 sm:w-3.5" />
                  Cargas perto de você
                </span>
              </div>
            </div>

            {/* Bloco de download — empurrado pro rodapé do hero pelo my-auto do
                bloco de texto; no desktop fica logo abaixo do texto (sm:mt-7). */}
            <div className="max-w-2xl pt-8 sm:mt-7 sm:pt-0">
              {/* Botões de loja (lado a lado e finos no mobile) */}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3">
                <StoreBadge
                  href={APP_STORE_URL}
                  topLabel="Baixar na"
                  bottomLabel="App Store"
                  icon={<Apple className="h-4 w-4 sm:h-7 sm:w-7" />}
                />
                <StoreBadge
                  href={PLAY_STORE_URL}
                  topLabel="Disponível no"
                  bottomLabel="Google Play"
                  icon={<GooglePlay className="h-[15px] w-[15px] sm:h-6 sm:w-6" />}
                />
              </div>

              {/* CTA secundário: explorar fretes sem baixar o app */}
              <p className="text-shadow-soft mt-3 text-center text-xs text-white/75 sm:mt-5 sm:text-left">
                <Link
                  to="/fretes"
                  className="inline-flex items-center gap-1 font-medium text-brand-lime hover:underline"
                >
                  Ou veja os fretes disponíveis
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== COMO FUNCIONA =====================
          Layout: cabeçalho centralizado, celular ao centro e 4 passos
          numerados em volta (2 à esquerda, 2 à direita) no desktop. No
          mobile vira coluna: celular no topo e os passos em sequência. */}
      <section id="como-funciona" className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          {/* Cabeçalho */}
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
              Como funciona
            </span>
            <h2 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              Como funciona o FreteGO
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
              Do cadastro ao frete fechado em poucos passos. Simples, direto e sem burocracia —
              pensado pra quem vive na estrada.
            </p>
          </div>

          {/* Passos + celular */}
          <div className="mt-10 grid items-center gap-x-6 gap-y-10 sm:mt-14 lg:grid-cols-[1fr_auto_1fr] lg:grid-rows-2 lg:gap-x-10">
            {/* Celular (centro) */}
            <div className="order-first flex justify-center lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <PhoneShot src="/app-tela.jpg" alt="Tela do app FreteGO" />
            </div>

            <Step
              n="1"
              side="left"
              title="Crie sua conta"
              desc="Baixe o FreteGO, cadastre-se de graça e complete seu perfil em poucos minutos."
              className="lg:col-start-1 lg:row-start-1"
            />
            <Step
              n="2"
              side="right"
              title="Encontre o frete"
              desc="Veja cargas perto de você e na sua rota, filtradas por tipo de veículo e região."
              className="lg:col-start-3 lg:row-start-1"
            />
            <Step
              n="3"
              side="left"
              title="Negocie direto"
              desc="Fale com o embarcador sem intermediário e combine valor e prazo do seu jeito."
              className="lg:col-start-1 lg:row-start-2"
            />
            <Step
              n="4"
              side="right"
              title="Feche e rode"
              desc="Aceite o frete, rode com a carga certa e acompanhe tudo pelo app."
              className="lg:col-start-3 lg:row-start-2"
            />
          </div>
        </div>
      </section>

      {/* ===================== PARA QUEM É (embarcador / motorista) =====================
          Dois cards com foto de fundo, título, subtítulo e CTA "Saiba mais".
          O card inteiro é um link para o cadastro. */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 pb-14 sm:pb-20">
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
            <AudienceCard
              img="/audience-embarcador.jpg"
              title="Para embarcadores"
              desc="Publique seus fretes e encontre caminhoneiros perto da carga."
              to="/para-embarcadores"
            />
            <AudienceCard
              img="/audience-motorista.jpg"
              title="Para caminhoneiros"
              desc="Encontre as melhores cargas para o seu veículo e a sua rota."
              to="/para-caminhoneiros"
            />
          </div>
        </div>
      </section>

      {/* ===================== SEGURANÇA / ANTIFRAUDE =====================
          Painel branco arredondado: à esquerda a mensagem (pill + headline),
          à direita dois tiles de imagem com selo. Conteúdo autoral do FreteGO
          (sem números de marketing inventados). As imagens são placeholders
          até o Bruno enviar as definitivas em fotos/. */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 pb-14 sm:pb-20">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-100 sm:p-10 lg:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
              {/* Texto (esquerda) */}
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
                  <Shield className="h-4 w-4 text-brand-green" />
                  Sua carga mais segura
                </span>
                <h2 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
                  Menos risco, <span className="text-brand-green">mais confiança</span> em cada
                  frete.
                </h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600 sm:text-base">
                  No FreteGO a gente verifica identidade e documentos pra manter fraudador fora da
                  plataforma. Você negocia direto com quem está checado e fecha o frete com mais
                  tranquilidade.
                </p>

                {/* Pontos de confiança */}
                <ul className="mt-6 space-y-3">
                  <TrustItem
                    icon={<BadgeCheck className="h-5 w-5 text-brand-green" />}
                    title="Cadastro verificado"
                    desc="Conferimos documentos e dados antes de liberar o acesso."
                  />
                  <TrustItem
                    icon={<Shield className="h-5 w-5 text-brand-green" />}
                    title="Antifraude ativo"
                    desc="Monitoramos comportamentos suspeitos pra proteger as negociações."
                  />
                  <TrustItem
                    icon={<MapPin className="h-5 w-5 text-brand-green" />}
                    title="Frete na sua rota"
                    desc="Você vê de onde sai e pra onde vai a carga antes de aceitar."
                  />
                </ul>
              </div>

              {/* Tiles de imagem (direita) */}
              <div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <ImageTile
                    img="/landing-fundo.jpg"
                    alt="Caminhão na estrada com a rota acompanhada pelo app"
                    badge="Rota no mapa"
                    icon={<MapPin className="h-3.5 w-3.5 text-brand-green" />}
                  />
                  <ImageTile
                    img="/audience-embarcador.jpg"
                    alt="Negociação de frete entre pessoas verificadas"
                    badge="Antifraude"
                    icon={<Shield className="h-3.5 w-3.5 text-brand-green" />}
                  />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-gray-500">
                  Verificamos identidade e documentos pra deixar suas negociações mais seguras e
                  manter fraudadores longe da plataforma.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== NOSSOS NÚMEROS =====================
          Sempre renderizada (mesmo sem dados). Valores ao vivo do banco
          (RPC public_stats): enquanto carrega mostra esqueleto; se a RPC
          falhar/indisponível, mostra 0. */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-center lg:gap-16">
            <h2 className="text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              Nossos números em constante crescimento
            </h2>

            <div className="grid grid-cols-3 gap-4 sm:gap-8">
              {STAT_DEFS.map((def) => (
                <div key={def.key}>
                  <div className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
                    {stats === undefined ? (
                      <span className="inline-block h-8 w-14 animate-pulse rounded-md bg-gray-200 align-middle sm:h-10 sm:w-20" />
                    ) : (
                      formatCount(stats ? stats[def.key] : 0)
                    )}
                  </div>
                  <div className="mt-2 text-xs text-gray-600 sm:text-sm">{def.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {isApp ? <AppMiniFooter /> : <SiteFooter />}
    </div>
  );
}

/**
 * Step — passo numerado da seção "Como funciona".
 * `side="left"` inverte no desktop (número à direita, texto alinhado à
 * direita) para os passos da coluna esquerda; no mobile fica sempre
 * número à esquerda + texto à esquerda.
 */
function Step({
  n,
  title,
  desc,
  side,
  className = '',
}: {
  n: string;
  title: string;
  desc: string;
  side: 'left' | 'right';
  className?: string;
}) {
  const isLeft = side === 'left';
  return (
    <div
      className={`flex items-start gap-3.5 ${isLeft ? 'lg:flex-row-reverse lg:text-right' : ''} ${className}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-green/10 text-lg font-extrabold text-brand-green ring-1 ring-inset ring-brand-green/15">
        {n}
      </span>
      <div>
        <h3 className="text-base font-bold text-gray-900 sm:text-lg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{desc}</p>
      </div>
    </div>
  );
}

/**
 * PhoneShot — moldura de celular exibindo uma screenshot real do app,
 * com um círculo verde decorativo atrás (estilo da referência).
 */
function PhoneShot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative flex items-center justify-center py-4">
      {/* Círculo verde decorativo atrás do celular */}
      <span
        className="absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-green sm:h-72 sm:w-72"
        aria-hidden="true"
      />
      {/* Moldura do celular */}
      <div className="relative w-44 overflow-hidden rounded-[2rem] border-[6px] border-gray-900 bg-gray-900 shadow-2xl sm:w-52">
        <img src={src} alt={alt} className="block w-full rounded-[1.5rem]" draggable={false} />
      </div>
    </div>
  );
}

/**
 * AudienceCard — card com foto de fundo para os dois públicos (embarcador /
 * caminhoneiro). O card inteiro é um link; ao passar o mouse a foto dá um
 * leve zoom e o botão "Saiba mais" preenche de branco.
 */
function AudienceCard({
  img,
  title,
  desc,
  to,
}: {
  img: string;
  title: string;
  desc: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group relative flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-2xl shadow-sm sm:min-h-[20rem]"
    >
      {/* Foto de fundo */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: `url('${img}')` }}
        aria-hidden="true"
      />
      {/* Overlay para legibilidade do texto */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/5" />
      {/* Conteúdo */}
      <div className="relative p-6 sm:p-8">
        <h3 className="text-shadow-soft text-2xl font-extrabold text-white sm:text-3xl">{title}</h3>
        <p className="text-shadow-soft mt-1.5 max-w-xs text-sm text-white/85">{desc}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/60 px-4 py-1.5 text-sm font-semibold text-white transition-colors group-hover:bg-white group-hover:text-gray-900">
          Saiba mais
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

/**
 * TrustItem — item da lista de pontos de confiança da seção de segurança
 * (ícone em selo verde + título + descrição curta).
 */
function TrustItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 ring-1 ring-inset ring-brand-green/15">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-bold text-gray-900 sm:text-base">{title}</h3>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{desc}</p>
      </div>
    </li>
  );
}

/**
 * ImageTile — tile de imagem da seção de segurança, com um selo branco
 * (ícone + texto) centralizado na base. As imagens são placeholders até as
 * definitivas chegarem em fotos/.
 */
function ImageTile({
  img,
  alt,
  badge,
  icon,
}: {
  img: string;
  alt: string;
  badge: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gray-100">
      <img src={img} alt={alt} className="h-full w-full object-cover" draggable={false} />
      <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-md backdrop-blur-sm">
        {icon}
        {badge}
      </span>
    </div>
  );
}

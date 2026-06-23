/**
 * LandingPage — página de entrada pública do FreteGO (rota `/` para
 * visitantes não logados).
 *
 * Estrutura (de cima pra baixo):
 *  - Cabeçalho e rodapé compartilhados via PublicLayout (PublicHeader +
 *    SiteFooter/AppMiniFooter) — os mesmos em todas as páginas públicas.
 *  - Hero: vídeo de fundo em loop, headline autoral e os dois botões de loja.
 *  - Dor do caminhoneiro (+ virada de desejo).
 *  - Vantagens (#vantagens) — cards clicáveis que levam a /saiba/<slug>.
 *  - Funcionalidades — layout alternado imagem/texto, com "Ver mais".
 *  - Como funciona — passos ao redor do celular.
 *  - Para quem é (embarcador / caminhoneiro).
 *  - Segurança / antifraude.
 *  - Depoimentos (conteúdo de exemplo até termos reais).
 *  - Nossos números (ao vivo via RPC public_stats).
 *  - CTA final + Sobre (curto).
 *
 * Sem planos/preços: a estratégia é atrair e converter pro trial (cobrança
 * só depois). O texto das seções de marketing vive em src/data/landingContent.
 *
 * Identidade visual (cores da logo, ver tailwind.config.js):
 *  - brand-green #007848 / brand-greenDark / brand-navy / brand-navyDeep /
 *    brand-lime (acento).
 *
 * Lojas: o app ainda não está publicado — os botões apontam para a página
 * oficial "App em breve" (`/links/app.html`). Quando publicar, troque as
 * constantes APP_STORE_URL / PLAY_STORE_URL pelos links reais.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import PublicLayout from '../components/public/PublicLayout';
import FreteTicker from '../components/public/FreteTicker';
import SocialRail from '../components/public/SocialRail';
import { AccessButton } from '../components/public/AccessChoice';
import BrandedTitle from '../components/public/BrandedTitle';
import CommunityButton from '../components/public/CommunityButton';
import { APP_STORE_URL, PLAY_STORE_URL } from '../data/appLinks';
import { getPublicStats, type PublicStats } from '../services/publicStats';
import {
  PAIN_TITLE,
  PAIN_SUBTITLE,
  PAINS,
  DESIRE_TITLE,
  DESIRE_POINTS,
  BENEFITS_TITLE,
  BENEFITS_SUBTITLE,
  BENEFITS,
  FEATURES_TITLE,
  FEATURES_SUBTITLE,
  FEATURES,
  TESTIMONIALS_TITLE,
  TESTIMONIALS,
  ABOUT,
  FINAL_CTA_TITLE,
  FINAL_CTA_TEXT,
  type BenefitIcon,
} from '../data/landingContent';

/**
 * NAV_LINKS agora mora no PublicHeader (cabeçalho compartilhado). Re-exportado
 * aqui por compatibilidade — testes e outros módulos importam de LandingPage.
 */
export { NAV_LINKS } from '../components/public/PublicHeader';

/**
 * URLs das lojas — definidas em src/data/appLinks e reexportadas aqui por
 * compatibilidade (testes e StoreBadge importam de LandingPage).
 */
export { PLAY_STORE_URL, APP_STORE_URL };

/**
 * Mídia de fundo do hero. Em vez de uma foto estática, usamos um vídeo curto
 * em loop (mudo) pra dar movimento. A foto-poster aparece na hora enquanto o
 * vídeo carrega e também é o fallback pra quem prefere menos animação
 * (prefers-reduced-motion). Ambos otimizados para web em public/:
 *  - landing-hero.mp4 (540p, ~6,5 MB, H.264, autoplay-ready)
 *  - landing-hero-poster.jpg (~250 KB, frame do próprio vídeo)
 * Para trocar, substitua esses arquivos (gerados a partir da arte em fotos/).
 */
const HERO_VIDEO = '/landing-hero.mp4?v=2';
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

/** Sparkles — usado pra sinalizar a busca com Inteligência Artificial. */
function Sparkles({ className }: IconProps) {
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
      <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z" />
      <path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
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
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#00C3FF"
        d="M3.6 1.81C3.24 2 3 2.36 3 2.83v18.34c0 .47.24.83.6 1.02l.06.06 10.28-10.28v-.12L3.66 1.75l-.06.06z"
      />
      <path
        fill="#FFCE00"
        d="M17.3 8.42 13.94 12.06v.12l3.36 3.64.08-.05 4.06-2.31c1.16-.66 1.16-1.74 0-2.4l-4.06-2.31-.08-.04z"
      />
      <path
        fill="#FF424D"
        d="M13.94 12.06 3.6 22.19c.38.4 1.01.45 1.72.05l11.98-6.81-3.36-3.37z"
      />
      <path fill="#00D76F" d="M5.32 1.71C4.61 1.31 3.98 1.36 3.6 1.76l10.34 10.3 3.36-3.64L5.32 1.71z" />
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

/* Ícones das Vantagens (mapeados por chave em BENEFIT_ICONS). */
function RouteIcon({ className }: IconProps) {
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
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h5a4 4 0 0 0 4-4V8" />
    </svg>
  );
}

function ReturnIcon({ className }: IconProps) {
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
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function MoneyIcon({ className }: IconProps) {
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
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
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
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function PhoneIcon({ className }: IconProps) {
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
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12" y2="18" />
    </svg>
  );
}

/** Quotes decorativas para os cards de depoimento. */
function QuoteIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.17 6A5.17 5.17 0 0 0 2 11.17V18h6.83v-6.83H5.5A1.67 1.67 0 0 1 7.17 9.5zM18.5 6a5.17 5.17 0 0 0-5.17 5.17V18H20.16v-6.83h-3.33A1.67 1.67 0 0 1 18.5 9.5z" />
    </svg>
  );
}

/** Mapa chave→ícone usado pelos cards de Vantagens. */
const BENEFIT_ICONS: Record<BenefitIcon, (p: IconProps) => JSX.Element> = {
  route: RouteIcon,
  return: ReturnIcon,
  money: MoneyIcon,
  chat: ChatIcon,
  shield: Shield,
  phone: PhoneIcon,
};

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
  const location = useLocation();

  // Quando a landing é aberta com uma âncora (ex.: vindo de outra página via
  // `/#vantagens`), rola suavemente até a seção depois que o conteúdo montou.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === 'function') {
      const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return () => clearTimeout(t);
    }
  }, [location.hash]);

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

  return (
    <PublicLayout headerVariant="landing">
      {/* Redes sociais fixas à esquerda (só web) */}
      <SocialRail />

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
              {/* Selo de destaque: busca de fretes com Inteligência Artificial */}
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-lime/40 bg-brand-lime/15 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm sm:mb-4 sm:text-xs">
                <Sparkles className="h-3.5 w-3.5 text-brand-lime sm:h-4 sm:w-4" />
                Busca de fretes com <span className="text-brand-lime">Inteligência Artificial</span>
              </span>

              <h1 className="text-shadow-soft text-2xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
                Fretes que ficam
                <br className="hidden sm:block" /> na sua rota.
                <span className="mt-1 block text-brand-lime">Sem intermediário.</span>
              </h1>

              <p className="text-shadow-soft mt-3 max-w-xl text-[0.82rem] leading-relaxed text-white/85 sm:mt-4 sm:text-base sm:leading-normal lg:text-lg">
                O FreteGO usa{' '}
                <span className="font-semibold text-white">inteligência artificial</span> pra achar
                os melhores fretes na sua rota — de{' '}
                <span className="font-semibold text-brand-lime">ida e de volta</span>. Você fala
                direto com quem contrata e fecha sem atravessador no meio.
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
                <span className="inline-flex items-center gap-1 rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                  <Sparkles className="h-3 w-3 text-brand-lime sm:h-3.5 sm:w-3.5" />
                  Fretes de ida e volta
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

          {/* Ticker de fretes passando no rodapé do hero (faixa full-width) */}
          <FreteTicker />
        </div>
      </section>

      {/* ===================== DOR (logo após o hero) =====================
          Conexão emocional: as dores reais de quem vive de frete. Fundo
          escuro pra dar peso, seguido da virada de desejo (dor → ganho). */}
      <section className="bg-brand-navyDeep">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold leading-tight text-white sm:text-3xl lg:text-4xl">
              {PAIN_TITLE}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">{PAIN_SUBTITLE}</p>
          </div>

          <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
            {PAINS.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
              >
                <h3 className="text-base font-bold text-white sm:text-lg">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{p.desc}</p>
              </div>
            ))}
          </div>

          {/* Virada: dor → desejo */}
          <div className="relative mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-brand-green/30 bg-brand-green/10 p-6 sm:mt-12 sm:p-8">
            {/* Imagem da IA fixada no canto inferior direito do card. */}
            <img
              src="/IA_foto.png"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute bottom-1 right-2 h-24 w-auto select-none ia-glow"
            />
            <h3 className="text-center text-lg font-bold text-white sm:text-xl">{DESIRE_TITLE}</h3>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {DESIRE_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-white/90">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-lime" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-start sm:justify-center">
              <AccessButton
                to="/ia"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
              >
                Entenda mais
                <ArrowRight className="h-4 w-4" />
              </AccessButton>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== VANTAGENS (Benefícios) =====================
          Grid de cards clicáveis; cada um leva a /saiba/<slug> com mais
          detalhe. Âncora #vantagens (item do menu). */}
      <section id="vantagens" className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
              Vantagens
            </span>
            <h2 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              {BENEFITS_TITLE}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
              {BENEFITS_SUBTITLE}
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => {
              const Icon = BENEFIT_ICONS[b.icon];
              const bg = `/vantagens/${b.slug}.jpg`;
              return (
                <Link
                  key={b.slug}
                  to={`/saiba/${b.slug}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  {/* Imagem de fundo (levemente desfocada). */}
                  <span
                    className="absolute inset-0 scale-110 bg-cover bg-center blur-[2px]"
                    style={{ backgroundImage: `url('${bg}')` }}
                    aria-hidden="true"
                  />
                  {/* Tom de cor por cima — dá identidade e mantém o texto legível. */}
                  <span
                    className="absolute inset-0 bg-gradient-to-t from-brand-navyDeep/90 via-brand-navyDeep/70 to-brand-navyDeep/55"
                    aria-hidden="true"
                  />
                  {/* Conteúdo */}
                  <div className="relative z-10 flex flex-1 flex-col">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-white drop-shadow sm:text-lg">
                      {b.title}
                    </h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-white/85">{b.desc}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-lime">
                      Saiba mais
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== FUNCIONALIDADES =====================
          Layout alternado imagem/texto. Cada bloco tem "Ver mais" levando a
          /saiba/<slug>. (Screenshots provisórios — trocar pelos reais.) */}
      <section id="funcionalidades" className="scroll-mt-20 bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              {FEATURES_TITLE}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
              {FEATURES_SUBTITLE}
            </p>
          </div>

          <div className="mt-12 flex flex-col gap-12 sm:gap-16">
            {FEATURES.map((f, i) => {
              const flip = i % 2 === 1;
              return (
                <div key={f.slug} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
                  <div className={`flex justify-center ${flip ? 'lg:order-2' : ''}`}>
                    <div className="relative">
                      {f.framed === false ? (
                        // Imagem já é um mockup de celular pronto (PNG transparente):
                        // mostramos só a imagem, sem moldura nem fundo.
                        <img
                          src={f.image}
                          alt={f.title}
                          className="relative block w-44 drop-shadow-2xl sm:w-52"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <>
                          {/* brilho verde suave atrás do mockup */}
                          <span
                            className="absolute -inset-5 rounded-[2.5rem] bg-brand-green/10 blur-2xl"
                            aria-hidden="true"
                          />
                          {/* moldura de celular (o print é só a tela, vertical) */}
                          <div className="relative w-40 overflow-hidden rounded-[2rem] border-[6px] border-gray-900 bg-gray-900 shadow-2xl sm:w-48">
                            <img
                              src={f.image}
                              alt={f.title}
                              className="block w-full"
                              loading="lazy"
                              draggable={false}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={flip ? 'lg:order-1' : ''}>
                    <h3 className="text-xl font-extrabold text-gray-900 sm:text-2xl">
                      <BrandedTitle title={f.title} logo={f.titleLogo} />
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600 sm:text-base">{f.desc}</p>
                    <ul className="mt-4 space-y-2">
                      {f.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2.5 text-sm text-gray-700">
                          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/saiba/${f.slug}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition-colors hover:border-brand-green/40 hover:text-brand-green"
                      >
                        Ver mais
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      {f.communityUrl && (
                        <CommunityButton
                          href={f.communityUrl}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1fb457]"
                        >
                          Comunidade FreteGO
                        </CommunityButton>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* ===================== DEPOIMENTOS =====================
          Grid de depoimentos. Conteúdo de EXEMPLO até termos reais — cada
          card marcado com selo "exemplo" (trocar quando vierem os reais). */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
              {TESTIMONIALS_TITLE}
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure
                key={t.name}
                className="flex h-full flex-col rounded-2xl border border-gray-100 bg-gray-50 p-6 shadow-sm"
              >
                <QuoteIcon className="h-7 w-7 text-brand-green/30" />
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-gray-700">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-sm font-bold text-brand-green">
                    {t.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{t.name}</span>
                    <span className="block text-xs text-gray-500">
                      {t.role} · {t.location}
                    </span>
                  </span>
                  {t.placeholder && (
                    <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                      exemplo
                    </span>
                  )}
                </figcaption>
              </figure>
            ))}
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

      {/* ===================== CTA FINAL =====================
          Fechamento emocional com fundo diferenciado e os botões de loja. */}
      <section className="relative overflow-hidden bg-brand-navy">
        <div
          className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navyDeep to-brand-navy"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:py-24">
          <h2 className="text-2xl font-extrabold leading-tight text-white sm:text-3xl lg:text-4xl">
            {FINAL_CTA_TITLE}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
            {FINAL_CTA_TEXT}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <StoreBadge
              href={APP_STORE_URL}
              topLabel="Baixar na"
              bottomLabel="App Store"
              icon={<Apple className="h-7 w-7" />}
            />
            <StoreBadge
              href={PLAY_STORE_URL}
              topLabel="Disponível no"
              bottomLabel="Google Play"
              icon={<GooglePlay className="h-6 w-6" />}
            />
          </div>
          <p className="mt-5 text-xs text-white/70">
            <AccessButton
              to="/register"
              className="align-baseline font-semibold text-brand-lime hover:underline"
            >
              Criar conta grátis
            </AccessButton>{' '}
            e começar agora — sem cartão, sem compromisso.
          </p>
        </div>
      </section>

      {/* ===================== SOBRE (curta) =====================
          Bloco institucional mínimo, colado no rodapé. */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:py-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
            Sobre o FreteGO
          </span>
          <h2 className="mt-4 text-xl font-extrabold text-gray-900 sm:text-2xl">{ABOUT.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
            {ABOUT.body}
          </p>
        </div>
      </section>
    </PublicLayout>
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

/**
 * AudienceLandingPage — páginas públicas de "Saiba mais" para os dois
 * públicos do FreteGO. Servida em duas rotas:
 *   - /para-embarcadores  → audience="embarcador"
 *   - /para-caminhoneiros → audience="motorista"
 *
 * Mesmo layout (header simples, hero com a foto do público, lista de
 * benefícios e CTA final), com conteúdo definido em src/data/audienceContent.
 * CTA principal leva ao cadastro (/register).
 */

import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import SiteFooter from '../components/SiteFooter';
import AppMiniFooter from '../components/AppMiniFooter';
import { CONTENT, type Audience } from '../data/audienceContent';

/* Ícones em SVG inline (convenção do projeto). */
type IconProps = { className?: string };

function Check({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m20 6-11 11-5-5" />
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

function ArrowLeft({ className }: IconProps) {
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
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export default function AudienceLandingPage({ audience }: { audience: Audience }) {
  const cfg = CONTENT[audience];
  useDocumentTitle(cfg.docTitle);
  const isApp = Capacitor.isNativePlatform();

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      {/* Header simples (logo + voltar + entrar) */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="FreteGO" className="flex items-center">
            <img
              src="/logo.png"
              alt="FreteGO"
              className="h-8 w-auto select-none object-contain sm:h-9"
              draggable={false}
            />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Link>
            <Link
              to="/login"
              className="rounded-full bg-brand-green px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-greenDark"
            >
              Entrar
            </Link>
          </div>
        </div>
      </header>

      {/* Hero com a foto do público */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${cfg.image}')` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/25" />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              {cfg.tag}
            </span>

            <h1 className="text-shadow-soft mt-4 text-2xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
              {cfg.heroTitle}
            </h1>
            <p className="text-shadow-soft mt-4 max-w-xl text-sm text-white/85 sm:text-base lg:text-lg">
              {cfg.heroSubtitle}
            </p>

            <div className="mt-7 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              <Link
                to="/register"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
              >
                {cfg.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/fretes"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:text-base"
              >
                Ver fretes
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Benefícios */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h2 className="text-center text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl lg:text-4xl">
            {cfg.benefitsTitle}
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {cfg.benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-gray-100 bg-surface-section p-5 shadow-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
                  <Check className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-base font-semibold text-gray-900">{b.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-brand-navyDeep">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:py-20">
          <h2 className="text-2xl font-extrabold leading-tight text-white sm:text-3xl">
            {cfg.finalTitle}
          </h2>
          <div className="mt-7 flex justify-center">
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
            >
              {cfg.ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {isApp ? <AppMiniFooter /> : <SiteFooter />}
    </div>
  );
}

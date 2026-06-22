/**
 * SaibaMaisPage — página de detalhe ("Saiba mais") das vantagens e
 * funcionalidades da landing. Servida em `/saiba/:slug`, orientada a dados:
 * o conteúdo de cada tópico vem de TOPICS (src/data/landingContent). Reaproveita
 * o cabeçalho e o rodapé compartilhados (PublicLayout, variante sólida), como
 * todas as páginas públicas.
 *
 * Slug inexistente → NotFoundPage (mesma experiência do 404 do app).
 */

import { Link, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import PublicLayout from '../components/public/PublicLayout';
import { AccessButton } from '../components/public/AccessChoice';
import NotFoundPage from './NotFoundPage';
import { getTopic } from '../data/landingContent';

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

export default function SaibaMaisPage() {
  const { slug } = useParams<{ slug: string }>();
  const topic = getTopic(slug);
  // Hook sempre chamado (Rules of Hooks); título só muda se o tópico existe.
  useDocumentTitle(topic ? topic.title : null);

  if (!topic) return <NotFoundPage />;

  return (
    <PublicLayout>
      {/* Hero do tópico */}
      <section className="relative overflow-hidden bg-brand-navyDeep">
        <div
          className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navyDeep to-brand-navy"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
            {topic.eyebrow}
          </span>
          <h1 className="text-shadow-soft mt-4 text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
            {topic.title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base lg:text-lg">
            {topic.subtitle}
          </p>
          <div className="mt-7 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
            <AccessButton
              to={topic.ctaTo}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
            >
              {topic.ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </AccessButton>
            <Link
              to="/#vantagens"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:text-base"
            >
              Ver todas as vantagens
            </Link>
          </div>
        </div>
      </section>

      {/* Blocos de conteúdo */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
          <div className="grid gap-5 sm:gap-6">
            {topic.blocks.map((block, i) => (
              <div
                key={block.heading}
                className="flex gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-5 shadow-sm sm:p-6"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-sm font-extrabold text-brand-green ring-1 ring-inset ring-brand-green/15">
                  {i + 1}
                </span>
                <div>
                  <h2 className="text-base font-bold text-gray-900 sm:text-lg">{block.heading}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600 sm:text-base">
                    {block.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA de fechamento + voltar */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 pb-16 text-center sm:pb-20">
          <div className="rounded-3xl bg-brand-navy p-8 shadow-sm sm:p-10">
            <h2 className="text-xl font-extrabold leading-tight text-white sm:text-2xl">
              Pronto pra achar frete bom na sua rota?
            </h2>
            <div className="mt-6 flex justify-center">
              <AccessButton
                to={topic.ctaTo}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
              >
                {topic.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </AccessButton>
            </div>
          </div>

          <Link
            to="/"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a página inicial
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}

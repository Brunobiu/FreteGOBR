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
import BrandedTitle from '../components/public/BrandedTitle';
import CommunityButton from '../components/public/CommunityButton';
import NotFoundPage from './NotFoundPage';
import { getTopic, BENEFITS } from '../data/landingContent';

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

  // Páginas de comunidade (Frete Comunidade) usam um layout enxuto: hero com
  // imagem de fundo + só o botão da comunidade, e logo abaixo a lista de
  // estados. Sem os blocos numerados e sem os CTAs de "ver fretes" / "ver
  // todas as vantagens".
  const isCommunity = Boolean(topic.communityUrl);

  // Imagem de fundo do hero: explícita (topic.heroImage) ou, no caso das
  // vantagens, a mesma da landing (/vantagens/<slug>.jpg). Funcionalidades sem
  // imagem ficam com o gradiente sólido.
  const heroBg =
    topic.heroImage ?? (BENEFITS.some((b) => b.slug === slug) ? `/vantagens/${slug}.jpg` : null);

  return (
    <PublicLayout>
      {/* Hero do tópico */}
      <section className="relative overflow-hidden bg-brand-navyDeep">
        {heroBg ? (
          <>
            <div
              className="absolute inset-0 scale-105 bg-cover bg-center blur-[2px]"
              style={{ backgroundImage: `url('${heroBg}')` }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-brand-navyDeep/90 via-brand-navyDeep/75 to-brand-navyDeep/60"
              aria-hidden="true"
            />
          </>
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navyDeep to-brand-navy"
            aria-hidden="true"
          />
        )}
        <div className="relative mx-auto max-w-4xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
            {topic.eyebrow}
          </span>
          <h1 className="text-shadow-soft mt-4 text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
            <BrandedTitle title={topic.title} logo={topic.titleLogo} />
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base lg:text-lg">
            {topic.subtitle}
          </p>
          <div className="mt-7 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
            {!isCommunity && (
              <AccessButton
                to={topic.ctaTo}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
              >
                {topic.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </AccessButton>
            )}
            {topic.communityUrl && (
              <CommunityButton
                href={topic.communityUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-[#1fb457] sm:text-base"
              >
                Comunidade FreteGO
              </CommunityButton>
            )}
            {!isCommunity && (
              <Link
                to="/#vantagens"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:text-base"
              >
                Ver todas as vantagens
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Blocos de conteúdo (escondidos nas páginas de comunidade). */}
      {!isCommunity && (
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
      )}

      {/* Cobertura nacional — lista os 26 estados (só quando o tópico tem). */}
      {topic.states && topic.states.length > 0 && (
        <section className="border-t border-gray-100 bg-gray-50">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-green sm:text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
                Cobertura nacional
              </span>
              <h2 className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl">
                Frete em todos os estados do Brasil
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base">
                Tem carga rolando na comunidade nos 26 estados. Onde você roda, o FreteGO está.
              </p>
            </div>

            <ul className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {topic.states.map((estado) => (
                <li
                  key={estado.uf}
                  className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-green/10 text-[11px] font-extrabold text-brand-green ring-1 ring-inset ring-brand-green/15">
                    {estado.uf}
                  </span>
                  <span className="truncate text-sm font-medium text-gray-800">{estado.nome}</span>
                </li>
              ))}
            </ul>

            {topic.communityUrl && (
              <div className="mt-10 flex justify-center">
                <CommunityButton
                  href={topic.communityUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/20 transition-colors hover:bg-[#1fb457] sm:text-base"
                >
                  Entrar na Comunidade FreteGO
                </CommunityButton>
              </div>
            )}
          </div>
        </section>
      )}

      {/* CTA de fechamento (escondido nas páginas de comunidade) + voltar */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 pb-16 text-center sm:pb-20">
          {!isCommunity && (
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
          )}

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

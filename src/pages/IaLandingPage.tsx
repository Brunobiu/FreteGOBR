/**
 * IaLandingPage — página pública (`/ia`) que apresenta a Inteligência
 * Artificial do FreteGO para o motorista: como a IA ajuda a achar frete de
 * ida, frete de retorno, cargas mais perto/na rota certa e a somar os custos
 * da viagem. Reaproveita o cabeçalho/rodapé públicos (PublicLayout) e o
 * AccessButton para o CTA de cadastro.
 */

import { useEffect, useRef } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import PublicLayout from '../components/public/PublicLayout';
import { AccessButton } from '../components/public/AccessChoice';

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

/** Benefícios da IA apresentados em blocos alternados imagem/texto. As
 *  imagens são placeholders (fotos de /vantagens) — trocar depois. */
const AI_FEATURES: { title: string; desc: string; image: string; icon: React.ReactNode }[] = [
  {
    title: 'Acha o frete de ida',
    desc: 'A IA procura cargas na sua rota e perto de você — você sai de casa já sabendo o que pegar, sem ficar caçando em mil grupos.',
    image: '/vantagens/frete-na-rota.jpg',
    icon: (
      <path d="M3 12h13l-3-3m3 3-3 3M21 5v14" />
    ),
  },
  {
    title: 'Encontra o frete de retorno',
    desc: 'Antes mesmo de você sair, a IA já procura o frete de volta — pra você não voltar vazio e não perder dinheiro com o caminhão rodando à toa.',
    image: '/vantagens/menos-viagem-vazia.jpg',
    icon: (
      <path d="M21 12H8l3 3m-3-3 3-3M3 19V5" />
    ),
  },
  {
    title: 'Cargas mais perto e na localização certa',
    desc: 'A IA usa a sua localização pra mostrar fretes nos pontos mais próximos e precisos — menos quilômetro vazio até a carga.',
    image: '/vantagens/simples-no-celular.jpg',
    icon: (
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    ),
  },
  {
    title: 'Soma os custos da viagem',
    desc: 'Combustível, pedágio, distância — a IA calcula os gastos da viagem pra você enxergar o lucro real antes de fechar o frete.',
    image: '/vantagens/sem-atravessador.jpg',
    icon: (
      <path d="M4 5h16v14H4zM8 9h8M8 13h5M8 17h3" />
    ),
  },
];

export default function IaLandingPage() {
  useDocumentTitle('Inteligência Artificial');

  // Vídeo de fundo do hero em loop (mudo). Reforçamos o autoplay via ref —
  // alguns navegadores ignoram o atributo `muted` setado só pelo React e
  // bloqueiam o autoplay. Se falhar, o fundo escuro (bg-brand-navyDeep) cobre.
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = heroVideoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {
      /* autoplay bloqueado: o fundo escuro permanece */
    });
  }, []);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-navyDeep">
        {/* Vídeo de fundo (mudo, autoplay, loop) com desfoque bem leve — dá
            movimento de "IA trabalhando" sem competir com o texto. */}
        <video
          ref={heroVideoRef}
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-[2px]"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        >
          <source src="/ia-hero.mp4" type="video/mp4" />
        </video>
        {/* Scrim escuro (tom da marca): mantém o texto legível e dá aquele
            "fundinho preto" pra destacar bem o nome, sem esconder o vídeo. */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-brand-navyDeep/85 via-brand-navyDeep/65 to-brand-navyDeep/90"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm sm:text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
            Inteligência Artificial
          </span>

          <img
            src="/IA_foto.png"
            alt="Inteligência artificial do FreteGO"
            className="ia-glow mx-auto mt-6 h-28 w-auto sm:h-36"
          />

          <h1 className="text-shadow-soft mt-6 text-2xl font-extrabold leading-tight text-white sm:text-3xl lg:text-4xl">
            Uma inteligência artificial trabalhando por você
          </h1>
          <p className="text-shadow-soft mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
            Enquanto você foca em rodar, a IA do FreteGO procura as melhores cargas, evita a
            viagem vazia e te mostra quanto você realmente vai ganhar. Olha o que ela faz por você:
          </p>
        </div>
      </section>

      {/* Como a IA ajuda — blocos alternados imagem/texto (vice-versa) */}
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <div className="flex flex-col gap-12 sm:gap-16">
            {AI_FEATURES.map((f, i) => {
              const flip = i % 2 === 1;
              return (
                <div key={f.title} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
                  <div className={`flex justify-center ${flip ? 'lg:order-2' : ''}`}>
                    <img
                      src={f.image}
                      alt={f.title}
                      className="aspect-[4/3] w-full max-w-md rounded-2xl object-cover shadow-md"
                      loading="lazy"
                      draggable={false}
                    />
                  </div>
                  <div className={flip ? 'lg:order-1' : ''}>
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-green/10">
                      <svg
                        className="h-6 w-6 text-brand-green"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {f.icon}
                      </svg>
                    </div>
                    <h2 className="mt-4 text-xl font-extrabold text-gray-900 sm:text-2xl">
                      {f.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600 sm:text-base">
                      {f.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-brand-navyDeep">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:py-16">
          <h2 className="text-xl font-extrabold text-white sm:text-2xl">
            Deixa a inteligência artificial achar o frete bom por você
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
            É grátis pra começar. Crie sua conta e veja a IA trabalhando na sua rota.
          </p>
          <div className="mt-6 flex justify-center">
            <AccessButton
              to="/register"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-brand-greenDark sm:text-base"
            >
              Começar de graça
              <ArrowRight className="h-4 w-4" />
            </AccessButton>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

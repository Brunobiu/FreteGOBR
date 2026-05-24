/**
 * Boas-vindas com skeleton de cards enquanto a primeira leva de fretes
 * carrega. A ideia é distrair o usuário com um conteúdo bonito em vez
 * de mostrar um "Carregando..." chato.
 */
interface WelcomeLoadingProps {
  isMotorista: boolean;
  userName?: string;
}

export default function WelcomeLoading({ isMotorista, userName }: WelcomeLoadingProps) {
  const firstName = (userName ?? '').split(' ')[0];
  const greeting = firstName ? `Olá, ${firstName}!` : 'Bem-vindo ao FreteGO!';
  const subtitle = isMotorista
    ? 'Estamos buscando os melhores fretes pra você. Em segundos eles aparecem aqui.'
    : userName
      ? 'Estamos preparando sua área. Em segundos seus fretes aparecem aqui.'
      : 'Encontre fretes de todos os estados do Brasil. Em segundos eles aparecem aqui.';

  return (
    <div className="py-6 sm:py-8">
      {/* Hero de boas-vindas */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-purple-50 border border-blue-100 rounded-xl px-4 py-5 sm:p-6 mb-4 shadow-sm">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 w-44 h-44 bg-purple-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex items-start gap-3">
          <div className="shrink-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-md">
              <svg
                className="w-7 h-7 sm:w-8 sm:h-8 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3 17h2a3 3 0 006 0h4a3 3 0 006 0h2v-5l-3-4h-3V5H3v12zm14-7h2.5L21 12v3h-1.05a3 3 0 00-5.9 0H17v-5zM7 18a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm10 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-gray-800">{greeting}</h2>
            <p className="text-xs sm:text-sm text-gray-600 mt-0.5">{subtitle}</p>
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-blue-600">
              <span className="welcome-dot welcome-dot-1" />
              <span className="welcome-dot welcome-dot-2" />
              <span className="welcome-dot welcome-dot-3" />
              <span className="ml-1">Carregando fretes...</span>
            </div>
          </div>
        </div>
      </div>

      {/* Skeleton de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} delay={i * 80} />
        ))}
      </div>
    </div>
  );
}

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="welcome-shimmer h-3.5 rounded w-3/4" />
        <div className="welcome-shimmer h-3 rounded w-12 shrink-0" />
      </div>
      <div className="welcome-shimmer h-3 rounded w-1/2 mb-2" />
      <div className="welcome-shimmer h-3 rounded w-2/3 mb-3" />
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="welcome-shimmer h-4 rounded w-20" />
        <div className="welcome-shimmer h-3 rounded w-12" />
      </div>
    </div>
  );
}

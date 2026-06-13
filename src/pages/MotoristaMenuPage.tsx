/**
 * MotoristaMenuPage — pagina dedicada do motorista, acessada pelo
 * slot "Menu" do `MotoristaBottomNav`.
 *
 * Layout (revisao 5 — grid 3 colunas, tamanhos variados):
 *   - Header: foto + nome + descricao do veiculo + toggle tema (sol/lua).
 *   - Grid 3 colunas: Perfil(1) + Tracao(2) | Carroceria + Complemento +
 *     Referencias | Contrato(1) + Planos(2) | Configuracoes(1).
 *   - Secao Tutorial: scroll horizontal com cards 9:16 (formato video vertical).
 */

import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useTabSlideClass } from '../hooks/useTabTransition';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMotoristaCompletude } from '../hooks/useMotoristaCompletude';
import { useMotoristaDocStatus, type DocReviewStatus } from '../hooks/useMotoristaDocStatus';
import { useDocRevalidation } from '../hooks/useDocRevalidation';
import { resolveProfilePhotoUrl } from '../services/documents';
import { capitalizeName } from '../utils/textCase';
import type { RevalidationGroup } from '../utils/docRevalidation';

interface Tile {
  key: string;
  label: string;
  subtitle?: string;
  icon: JSX.Element;
  onClick: () => void;
  badge?: { text: string; color: string };
  alert?: boolean;
  docStatus?: DocReviewStatus;
  revalExpired?: boolean;
  complete?: boolean;
  /** Ocupa 2 colunas (grande) */
  wide?: boolean;
  /** Label extra no canto inferior esquerdo (ex: "FREE" no card Planos) */
  bottomLabel?: string;
}

export default function MotoristaMenuPage() {
  useDocumentTitle('Menu do Motorista');
  const navigate = useNavigate();
  const slideClass = useTabSlideClass();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { daysLeft, isExpired, isSubscribed } = useTrialStatus();
  const { groups } = useMotoristaCompletude();
  const { groups: docStatus } = useMotoristaDocStatus();
  const { expiredGroups } = useDocRevalidation();
  const isRevalExpired = (g: RevalidationGroup) => expiredGroups.includes(g);

  // Foto do motorista para o header
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.profilePhotoUrl) {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    resolveProfilePhotoUrl(user.profilePhotoUrl)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.profilePhotoUrl]);

  const planoBadge = isSubscribed
    ? { text: 'PRO', color: 'menu-badge-pro' }
    : !isExpired && daysLeft > 0
      ? { text: `${daysLeft} dias restantes`, color: 'menu-badge-trial' }
      : { text: 'FREE', color: 'menu-badge-free' };

  // Label do plano atual para mostrar no canto inferior esquerdo do card
  const planoLabel = isSubscribed ? 'PRO' : 'FREE';

  // Grid: 3 colunas. Ordem: Perfil(1), Tracao(2), Carroceria(1),
  // Complemento(1), Referencias(1), Contrato(1), Planos(2), Configuracoes(1).
  const tiles: Tile[] = [
    {
      key: 'perfil',
      label: 'Perfil',
      subtitle: 'Dados pessoais',
      icon: <UserIllustration />,
      onClick: () => navigate('/motorista/perfil'),
      alert: groups.perfil,
      docStatus: docStatus.perfil,
    },
    {
      key: 'tracao',
      label: 'Tração',
      subtitle: 'Cavalo mecânico',
      icon: <TruckIllustration />,
      onClick: () => navigate('/motorista/tracao'),
      alert: groups.tracao,
      docStatus: docStatus.tracao,
      revalExpired: isRevalExpired('tracao'),
      wide: true,
    },
    {
      key: 'carroceria',
      label: 'Carroceria',
      subtitle: 'Implemento',
      icon: <TrailerIllustration />,
      onClick: () => navigate('/motorista/carroceria'),
      alert: groups.carroceria,
      docStatus: docStatus.carroceria,
      revalExpired: isRevalExpired('carroceria'),
    },
    {
      key: 'complemento',
      label: 'Complemento',
      subtitle: 'Consumo/peso',
      icon: <GaugeIllustration />,
      onClick: () => navigate('/motorista/complemento'),
      alert: groups.complemento,
      revalExpired: isRevalExpired('complemento'),
      complete: !groups.complemento,
    },
    {
      key: 'referencias',
      label: 'Referências',
      subtitle: 'Contatos',
      icon: <ReferencesIllustration />,
      onClick: () => navigate('/motorista/referencias'),
      alert: groups.referencias,
      revalExpired: isRevalExpired('referencias'),
      complete: !groups.referencias,
    },
    {
      key: 'contrato',
      label: 'Contrato',
      subtitle: 'Documentos',
      icon: <ContractIllustration />,
      onClick: () => navigate('/motorista/contrato'),
      docStatus: docStatus.contrato,
      revalExpired: isRevalExpired('contrato'),
    },
    {
      key: 'planos',
      label: 'Planos',
      subtitle: 'Assinatura',
      icon: <ShieldIllustration />,
      onClick: () => navigate('/motorista/plano'),
      badge: planoBadge,
      wide: true,
      bottomLabel: planoLabel,
    },
    {
      key: 'config',
      label: 'Configurações',
      subtitle: 'Conta e app',
      icon: <CogIllustration />,
      onClick: () => navigate('/configuracoes'),
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const displayName = user?.name ? capitalizeName(user.name) : 'Motorista';

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <main className={`max-w-md mx-auto px-4 pt-6 ${slideClass}`}>
        {/* Header: seta voltar + foto + nome + toggle tema */}
        <div className="mb-5 flex items-center gap-2.5">
          {/* Seta voltar */}
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
            aria-label="Voltar"
          >
            <svg
              className="w-5 h-5 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 border-2 border-gray-300 flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setPhotoUrl(null)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-gray-900 truncate">{displayName}</h1>
          </div>
          {/* Toggle tema (sol/lua) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>

        {/* Grid de cards — 3 colunas */}
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={tile.onClick}
              className={`relative flex flex-col justify-between rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 active:scale-[0.97] transition overflow-hidden ${
                tile.wide ? 'col-span-2 h-28' : 'col-span-1 h-28'
              }`}
            >
              {/* Textos no canto superior esquerdo */}
              <div className="p-2.5 pb-0 text-left z-10">
                <span className="text-[11px] sm:text-xs font-semibold text-gray-900 block leading-tight">
                  {tile.label}
                </span>
                {tile.subtitle && (
                  <span className="text-[9px] sm:text-[10px] text-gray-400 block mt-0.5">
                    {tile.subtitle}
                  </span>
                )}
              </div>

              {/* Ilustracao no canto inferior direito */}
              <div className="absolute bottom-1.5 right-2 opacity-80">{tile.icon}</div>

              {/* Label do plano no canto inferior esquerdo (ex: "FREE") */}
              {tile.bottomLabel && (
                <div className="absolute bottom-2 left-2.5 z-10">
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 border border-gray-300 rounded text-gray-700">
                    {tile.bottomLabel}
                  </span>
                </div>
              )}

              {/* Badges e alertas */}
              {tile.revalExpired && !tile.badge ? (
                <span
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-yellow-400 text-yellow-900 text-[10px] font-bold flex items-center justify-center shadow-sm z-10"
                  title="Confirme seus documentos (30 dias)"
                  aria-label="Confirme seus documentos"
                >
                  ?
                </span>
              ) : (
                <>
                  {tile.docStatus && tile.docStatus !== 'nenhum' && !tile.badge && (
                    <span
                      className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-sm z-10 ${
                        tile.docStatus === 'aprovado'
                          ? 'bg-green-500'
                          : tile.docStatus === 'rejeitado'
                            ? 'bg-red-500'
                            : 'bg-blue-500'
                      }`}
                      title={
                        tile.docStatus === 'aprovado'
                          ? 'Documentos confirmados'
                          : tile.docStatus === 'rejeitado'
                            ? 'Documento recusado — reenvie'
                            : 'Documentos em análise'
                      }
                      aria-label={
                        tile.docStatus === 'aprovado'
                          ? 'Documentos confirmados'
                          : tile.docStatus === 'rejeitado'
                            ? 'Documento recusado'
                            : 'Documentos em análise'
                      }
                    >
                      {tile.docStatus === 'aprovado'
                        ? '✓'
                        : tile.docStatus === 'rejeitado'
                          ? '!'
                          : '?'}
                    </span>
                  )}

                  {tile.alert &&
                    !tile.badge &&
                    (!tile.docStatus || tile.docStatus === 'nenhum') && (
                      <span
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm z-10"
                        title="Faltam dados para completar"
                        aria-label="Faltam dados"
                      >
                        !
                      </span>
                    )}

                  {tile.complete &&
                    !tile.alert &&
                    !tile.badge &&
                    (!tile.docStatus || tile.docStatus === 'nenhum') && (
                      <span
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm z-10"
                        title="Preenchido"
                        aria-label="Preenchido"
                      >
                        ✓
                      </span>
                    )}
                </>
              )}

              {tile.badge && (
                <span
                  className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded z-10 ${tile.badge.color}`}
                >
                  {tile.badge.text}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Secao Tutorial — scroll horizontal com cards 9:16 */}
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Tutorial</h2>
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
            <TutorialCard title="Como cadastrar" onClick={() => navigate('/tutorial')} />
            <TutorialCard title="Buscar fretes" onClick={() => navigate('/tutorial')} />
            <TutorialCard title="Documentos" onClick={() => navigate('/tutorial')} />
            <TutorialCard title="Plano PRO" onClick={() => navigate('/tutorial')} />
          </div>
        </div>

        {/* Sair */}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium border border-red-100"
          >
            <LogoutIcon />
            Sair
          </button>
        </div>
      </main>
    </div>
  );
}

// ─── Tutorial Card (9:16 vertical) ──────────────────────────────────────────

function TutorialCard({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 w-32 snap-start rounded-2xl overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900 text-left active:scale-[0.97] transition shadow-md"
    >
      {/* Aspect ratio 9:16 */}
      <div className="relative w-full" style={{ aspectRatio: '9/16' }}>
        {/* Play icon centralizado */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {/* Titulo no rodape do card */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/70 to-transparent">
          <p className="text-[11px] font-semibold text-white leading-tight">{title}</p>
        </div>
      </div>
    </button>
  );
}

// ─── Ilustracoes para os cards ──────────────────────────────────────────────

const UserIllustration = () => (
  <svg className="w-12 h-12 text-green-200" fill="currentColor" viewBox="0 0 64 64">
    <circle cx="32" cy="22" r="10" opacity={0.7} />
    <ellipse cx="32" cy="50" rx="16" ry="10" opacity={0.4} />
  </svg>
);

const TruckIllustration = () => (
  <svg className="w-16 h-12" viewBox="0 0 72 48" fill="none">
    <rect x="2" y="16" width="38" height="18" rx="3" fill="#d1fae5" />
    <rect x="40" y="20" width="20" height="14" rx="2" fill="#a7f3d0" />
    <path d="M40 26h14l6 5v3H40v-8z" fill="#6ee7b7" />
    <circle cx="16" cy="38" r="5" fill="#065f46" />
    <circle cx="52" cy="38" r="5" fill="#065f46" />
    <circle cx="16" cy="38" r="2.5" fill="#d1fae5" />
    <circle cx="52" cy="38" r="2.5" fill="#d1fae5" />
  </svg>
);

const TrailerIllustration = () => (
  <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none">
    <rect x="2" y="12" width="38" height="18" rx="3" fill="#d1fae5" />
    <rect x="5" y="15" width="10" height="12" rx="1" fill="#6ee7b7" opacity={0.6} />
    <rect x="17" y="15" width="10" height="12" rx="1" fill="#6ee7b7" opacity={0.6} />
    <rect x="29" y="15" width="8" height="12" rx="1" fill="#6ee7b7" opacity={0.6} />
    <circle cx="12" cy="34" r="4" fill="#065f46" />
    <circle cx="28" cy="34" r="4" fill="#065f46" />
    <circle cx="12" cy="34" r="2" fill="#d1fae5" />
    <circle cx="28" cy="34" r="2" fill="#d1fae5" />
  </svg>
);

const GaugeIllustration = () => (
  <svg className="w-11 h-11" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="28" r="14" fill="#d1fae5" />
    <path d="M24 28l-5-9" stroke="#065f46" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M13 34a13 13 0 0122 0" stroke="#6ee7b7" strokeWidth="3" strokeLinecap="round" />
    <circle cx="24" cy="28" r="2.5" fill="#065f46" />
  </svg>
);

const ReferencesIllustration = () => (
  <svg className="w-11 h-11" viewBox="0 0 48 48" fill="none">
    <circle cx="16" cy="18" r="6" fill="#a7f3d0" />
    <circle cx="32" cy="18" r="6" fill="#6ee7b7" />
    <ellipse cx="16" cy="36" rx="8" ry="6" fill="#d1fae5" />
    <ellipse cx="32" cy="36" rx="8" ry="6" fill="#a7f3d0" />
  </svg>
);

const ContractIllustration = () => (
  <svg className="w-11 h-11" viewBox="0 0 48 48" fill="none">
    <rect x="10" y="4" width="24" height="36" rx="3" fill="#d1fae5" />
    <rect x="14" y="10" width="14" height="2" rx="1" fill="#6ee7b7" />
    <rect x="14" y="15" width="10" height="2" rx="1" fill="#6ee7b7" />
    <rect x="14" y="20" width="14" height="2" rx="1" fill="#6ee7b7" />
    <rect x="14" y="25" width="8" height="2" rx="1" fill="#6ee7b7" />
    <path
      d="M22 30l3 3 6-6"
      stroke="#065f46"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CogIllustration = () => (
  <svg className="w-11 h-11" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="12" fill="#d1fae5" />
    <circle cx="24" cy="24" r="5" fill="#6ee7b7" />
    <rect x="22" y="6" width="4" height="7" rx="2" fill="#a7f3d0" />
    <rect x="22" y="35" width="4" height="7" rx="2" fill="#a7f3d0" />
    <rect x="6" y="22" width="7" height="4" rx="2" fill="#a7f3d0" />
    <rect x="35" y="22" width="7" height="4" rx="2" fill="#a7f3d0" />
  </svg>
);

const ShieldIllustration = () => (
  <svg className="w-14 h-12" viewBox="0 0 56 48" fill="none">
    <path d="M28 4L10 12v12c0 10 8 18 18 20 10-2 18-10 18-20V12L28 4z" fill="#d1fae5" />
    <path
      d="M22 24l4 4 8-8"
      stroke="#065f46"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
    />
  </svg>
);

/**
 * MotoristaMenuPage — pagina dedicada do motorista, acessada pelo
 * slot "Menu" do `MotoristaBottomNav`.
 *
 * Layout (revisao 3):
 *   - Sem AppHeader. Titulo a esquerda.
 *   - Tile "Veiculo" foi quebrado em 3: Tracao (cavalo), Carroceria
 *     e Complemento (consumo/peso/diesel).
 *   - Cada tile mostra um alertinha "!" laranja quando o grupo
 *     correspondente esta incompleto (via useMotoristaCompletude).
 *   - Tiles brancos com borda fina, mini-quadrado verde-claro com
 *     icone preto, label preta. Sair em destaque no rodape.
 */

import { useNavigate } from 'react-router-dom';
import MotoristaBottomNav from '../components/MotoristaBottomNav';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMotoristaCompletude } from '../hooks/useMotoristaCompletude';
import { useMotoristaDocStatus, type DocReviewStatus } from '../hooks/useMotoristaDocStatus';
import { useDocRevalidation } from '../hooks/useDocRevalidation';
import type { RevalidationGroup } from '../utils/docRevalidation';

interface Tile {
  key: string;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  badge?: { text: string; color: string };
  /** Se true, exibe alertinha "!" laranja indicando dados incompletos. */
  alert?: boolean;
  /** Status de revisão dos documentos do grupo (selo azul/verde/vermelho). */
  docStatus?: DocReviewStatus;
  /** Grupo venceu a revalidação de 30 dias (selo amarelo "?"). */
  revalExpired?: boolean;
  /** Grupo está completo (selo verde ✓) — usado quando não há docStatus próprio. */
  complete?: boolean;
}

export default function MotoristaMenuPage() {
  useDocumentTitle('Menu do Motorista');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { daysLeft, isExpired, isSubscribed } = useTrialStatus();
  const { groups } = useMotoristaCompletude();
  const { groups: docStatus } = useMotoristaDocStatus();
  const { expiredGroups } = useDocRevalidation();
  const isRevalExpired = (g: RevalidationGroup) => expiredGroups.includes(g);

  const planoBadge = isSubscribed
    ? { text: 'PRO', color: 'menu-badge-pro' }
    : !isExpired && daysLeft > 0
      ? { text: `${daysLeft}d`, color: 'menu-badge-trial' }
      : { text: 'FREE', color: 'menu-badge-free' };

  const tiles: Tile[] = [
    {
      key: 'perfil',
      label: 'Perfil',
      icon: <UserIcon />,
      onClick: () => navigate('/motorista/perfil'),
      alert: groups.perfil,
      docStatus: docStatus.perfil,
    },
    {
      key: 'tracao',
      label: 'Tração',
      icon: <TruckIcon />,
      onClick: () => navigate('/motorista/tracao'),
      alert: groups.tracao,
      docStatus: docStatus.tracao,
      revalExpired: isRevalExpired('tracao'),
    },
    {
      key: 'carroceria',
      label: 'Carroceria',
      icon: <TrailerIcon />,
      onClick: () => navigate('/motorista/carroceria'),
      alert: groups.carroceria,
      docStatus: docStatus.carroceria,
      revalExpired: isRevalExpired('carroceria'),
    },
    {
      key: 'complemento',
      label: 'Complemento',
      icon: <GaugeIcon />,
      onClick: () => navigate('/motorista/complemento'),
      alert: groups.complemento,
      revalExpired: isRevalExpired('complemento'),
      complete: !groups.complemento,
    },
    {
      key: 'referencias',
      label: 'Referências',
      icon: <ReferencesIcon />,
      onClick: () => navigate('/motorista/referencias'),
      alert: groups.referencias,
      revalExpired: isRevalExpired('referencias'),
      complete: !groups.referencias,
    },
    {
      key: 'contrato',
      label: 'Contrato',
      icon: <ContractIcon />,
      onClick: () => navigate('/motorista/contrato'),
      docStatus: docStatus.contrato,
      revalExpired: isRevalExpired('contrato'),
    },
    {
      key: 'tema',
      label: theme === 'dark' ? 'Tema claro' : 'Tema escuro',
      icon: theme === 'dark' ? <SunIcon /> : <MoonIcon />,
      onClick: () => toggleTheme(),
    },
    {
      key: 'config',
      label: 'Configurações',
      icon: <CogIcon />,
      onClick: () => navigate('/configuracoes'),
    },
    {
      key: 'planos',
      label: 'Planos',
      icon: <ShieldIcon />,
      onClick: () => navigate('/motorista/plano'),
      badge: planoBadge,
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <main className="max-w-md mx-auto px-4 pt-6">
        {/* Cabecalho da pagina (sem AppHeader, alinhado a esquerda) */}
        <div className="mb-5 text-left">
          <h1 className="text-xl font-semibold text-gray-900">Menu</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Acesse seu perfil, veículo e configurações.
          </p>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={tile.onClick}
              className="relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm active:scale-[0.98] transition p-2"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-50 text-gray-900">
                {tile.icon}
              </span>
              <span className="text-[11px] sm:text-xs font-medium text-gray-900 text-center leading-tight px-1">
                {tile.label}
              </span>

              {/* Selo amarelo "?" — grupo venceu a revalidação de 30 dias.
                  Tem prioridade sobre os demais selos: o motorista precisa
                  confirmar para voltar a interagir. */}
              {tile.revalExpired && !tile.badge ? (
                <span
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-yellow-400 text-yellow-900 text-[11px] font-bold flex items-center justify-center shadow-sm"
                  title="Confirme seus documentos (30 dias)"
                  aria-label="Confirme seus documentos"
                >
                  ?
                </span>
              ) : (
                <>
                  {/* Selo de status dos documentos — apenas um pontinho colorido,
                  sem texto (laranja=faltam dados, azul=em análise, verde=confirmado).
                  Tem prioridade sobre o "!" de campos incompletos. */}
                  {tile.docStatus && tile.docStatus !== 'nenhum' && !tile.badge && (
                    <span
                      className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shadow-sm ${
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

                  {/* Alerta "!" laranja - dados incompletos (só quando não há selo
                  de documento nem badge de plano). */}
                  {tile.alert &&
                    !tile.badge &&
                    (!tile.docStatus || tile.docStatus === 'nenhum') && (
                      <span
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm"
                        title="Faltam dados para completar"
                        aria-label="Faltam dados"
                      >
                        !
                      </span>
                    )}

                  {/* Selo verde "✓" - grupo completo (sem docStatus próprio, sem
                  alerta de dados faltando e sem badge). Ex: Complemento e
                  Referências, que não têm documento revisável próprio. */}
                  {tile.complete &&
                    !tile.alert &&
                    !tile.badge &&
                    (!tile.docStatus || tile.docStatus === 'nenhum') && (
                      <span
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm"
                        title="Preenchido"
                        aria-label="Preenchido"
                      >
                        ✓
                      </span>
                    )}
                </>
              )}

              {/* Badge (Planos) */}
              {tile.badge && (
                <span
                  className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded ${tile.badge.color}`}
                >
                  {tile.badge.text}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sair */}
        <div className="mt-6">
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

      <MotoristaBottomNav />
    </div>
  );
}

// ─── Icones ───────────────────────────────────────────────────────────────

const UserIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

// Tracao = cavalo (icone do truck/cabine)
const TruckIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 7h11v9H3V7zm11 3h4l3 3v3h-7v-6zM6.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm11 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
    />
  </svg>
);

// Carroceria = trailer/carreta
const TrailerIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16V8a1 1 0 011-1h13a1 1 0 011 1v8M3 16h18M3 16l-1 2h22l-1-2M8 19a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm11 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
    />
  </svg>
);

// Complemento = mostrador/peso (chart-bar com seta)
const GaugeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6m6 6V9m6 10V5M3 19h18" />
  </svg>
);

const ReferencesIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const ContractIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const MoonIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    />
  </svg>
);

const SunIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const CogIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
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

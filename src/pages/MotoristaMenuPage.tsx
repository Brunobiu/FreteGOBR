/**
 * MotoristaMenuPage — pagina dedicada do motorista, acessada pelo
 * slot "Menu" do `MotoristaBottomNav`.
 *
 * Layout (revisao 2):
 *   - Sem AppHeader. A pagina abre direto no titulo.
 *   - Titulo "Menu" + subtitulo alinhados a ESQUERDA.
 *   - Tiles em grid 3 colunas:
 *       * fundo branco com borda fina clara (sem cinza pesado)
 *       * mini-quadrado verde-claro contendo o icone PRETO
 *       * label preto, peso medio
 *   - Sair em destaque vermelho no rodape.
 */

import { useNavigate } from 'react-router-dom';
import MotoristaBottomNav from '../components/MotoristaBottomNav';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

interface Tile {
  key: string;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  badge?: { text: string; color: string };
}

export default function MotoristaMenuPage() {
  useDocumentTitle('Menu do Motorista');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { daysLeft, isExpired, isSubscribed } = useTrialStatus();

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
    },
    {
      key: 'veiculo',
      label: 'Veículo',
      icon: <TruckIcon />,
      onClick: () => navigate('/motorista/veiculo'),
    },
    {
      key: 'referencias',
      label: 'Referências',
      icon: <ReferencesIcon />,
      onClick: () => navigate('/motorista/referencias'),
    },
    {
      key: 'contrato',
      label: 'Contrato',
      icon: <ContractIcon />,
      onClick: () => navigate('/motorista/contrato'),
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

// ─── Icones (stroke=currentColor; tile aplica text-gray-900 -> ficam pretos) ──

const UserIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

const TruckIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 7h11v9H3V7zm11 3h4l3 3v3h-7v-6zM6.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm11 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
    />
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

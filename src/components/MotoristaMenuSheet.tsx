/**
 * MotoristaMenuSheet — modal de menu do motorista, aberto pelo
 * `MotoristaBottomNav` (slot 4 — "Menu").
 *
 * Layout:
 *   - Header com título "Menu" e botão fechar (X).
 *   - Grid de tiles 3 colunas (cada tile = ícone + label).
 *   - Rodapé fixo com botão "Sair" (logout).
 *
 * Tiles atuais: Perfil, Veículo, Tema, Configurações, Planos.
 * Cada tile fecha o sheet ao ser clicado e dispara navegação
 * (ou ação, no caso do tema).
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useTrialStatus } from '../hooks/useTrialStatus';

interface MotoristaMenuSheetProps {
  open: boolean;
  onClose: () => void;
}

interface Tile {
  key: string;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  badge?: { text: string; color: string };
}

export default function MotoristaMenuSheet({ open, onClose }: MotoristaMenuSheetProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { daysLeft, isExpired, isSubscribed } = useTrialStatus();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Foco inicial no X ao abrir + ESC fecha.
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const planoBadge = isSubscribed
    ? { text: 'PRO', color: 'bg-blue-100 text-blue-700' }
    : !isExpired && daysLeft > 0
      ? { text: `${daysLeft}d`, color: 'bg-green-100 text-green-700' }
      : { text: 'FREE', color: 'bg-green-100 text-green-700' };

  const tiles: Tile[] = [
    {
      key: 'perfil',
      label: 'Perfil',
      icon: <UserIcon />,
      onClick: () => go('/perfil/motorista'),
    },
    {
      key: 'veiculo',
      label: 'Veículo',
      icon: <TruckIcon />,
      onClick: () => go('/perfil/motorista#veiculo'),
    },
    {
      key: 'tema',
      label: theme === 'dark' ? 'Tema claro' : 'Tema escuro',
      icon: theme === 'dark' ? <SunIcon /> : <MoonIcon />,
      onClick: () => {
        toggleTheme();
        // Mantém o sheet aberto pra ver a troca acontecer? Não — fechamos
        // pra ficar coerente com os outros tiles. O usuário já vê a tela
        // toda mudar de cor.
        onClose();
      },
    },
    {
      key: 'config',
      label: 'Configurações',
      icon: <CogIcon />,
      onClick: () => go('/configuracoes'),
    },
    {
      key: 'planos',
      label: 'Planos',
      icon: <ShieldIcon />,
      onClick: () => go('/motorista/plano'),
      badge: planoBadge,
    },
  ];

  const handleLogout = async () => {
    onClose();
    await logout();
    navigate('/');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Fechar menu"
        onClick={onClose}
      />

      {/* Sheet — ocupa a tela inteira em mobile, vira card centralizado em ≥sm */}
      <div className="relative mt-auto sm:m-auto w-full sm:max-w-md sm:rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[80vh] rounded-t-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">Menu</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100"
            aria-label="Fechar"
          >
            <svg
              className="w-5 h-5 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tiles em grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-3">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={tile.onClick}
                className="relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border border-green-100 bg-green-50/40 hover:bg-green-50 active:scale-[0.98] transition p-2"
              >
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100 text-green-700">
                  {tile.icon}
                </span>
                <span className="text-[11px] sm:text-xs font-medium text-gray-700 text-center leading-tight px-1">
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
        </div>

        {/* Rodapé fixo: Sair */}
        <div className="border-t border-gray-200 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium"
          >
            <LogoutIcon />
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ícones ─────────────────────────────────────────────────────────────────

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

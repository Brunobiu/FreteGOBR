/**
 * AdminShell - layout dark do painel admin
 *
 * Sidebar colapsavel. Botao hamburguer fica FORA da sidebar:
 *   - quando aberta: encostado na borda direita da sidebar
 *   - quando fechada: no canto superior esquerdo da tela
 * Sem header superior. Timer escondido continua rodando.
 */

import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import SessionTimer from './SessionTimer';
import { useSessionTimeout } from '../../hooks/useSessionTimeout';

export default function AdminShell() {
  const [open, setOpen] = useState(true);
  const { showWarning, minutesRemaining, dismissWarning } = useSessionTimeout();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex relative">
      <AdminSidebar open={open} onClose={() => setOpen(false)} />

      {/* Botao hamburguer: fora da sidebar, canto INFERIOR esquerdo.
          Aberta: posiciona logo apos os 224px da sidebar (md).
          Fechada: encosta no canto esquerdo. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        className={`fixed bottom-3 z-50 p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 hover:text-white hover:bg-gray-800 transition shadow-lg ${
          open ? 'md:left-[14.5rem] left-3' : 'left-3'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* Timer escondido para auto-logout continuar funcionando */}
      <div className="hidden">
        <SessionTimer />
      </div>

      {showWarning && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded-lg p-4 shadow-lg">
          <div className="text-sm font-semibold mb-1">Sessao expirando</div>
          <p className="text-xs text-amber-200/80 mb-3">
            Sua sessao admin expira em {minutesRemaining} min por inatividade. Mexa o mouse ou tecle
            qualquer coisa pra renovar.
          </p>
          <button
            type="button"
            onClick={dismissWarning}
            className="text-xs px-2 py-1 rounded bg-amber-500/30 hover:bg-amber-500/50 transition"
          >
            Entendi
          </button>
        </div>
      )}
    </div>
  );
}

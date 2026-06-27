/**
 * BiometricLockScreen — overlay de trava biométrica (spec biometria-app).
 *
 * Componente auto-contido: usa `useBiometricGate` e renderiza um overlay em
 * tela cheia APENAS quando a sessão está travada (estados 'locked'/'unlocking').
 * Em web ou quando a biometria não está ativa, o hook fica 'unlocked' e este
 * componente renderiza `null` (no-op). É montado uma vez no topo do app.
 */

import { useBiometricGate } from '../hooks/useBiometricGate';

export default function BiometricLockScreen() {
  const { state, tryUnlock, useFallback } = useBiometricGate();

  if (state !== 'locked' && state !== 'unlocking') return null;
  const busy = state === 'unlocking';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aplicativo bloqueado"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gray-900 px-6 text-center text-white"
    >
      <img src="/logo.png" alt="FreteGO" className="mb-8 h-14 w-auto object-contain opacity-90" />

      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
        <svg
          className="h-10 w-10 text-green-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 11c0 3-1 5-1 5" />
          <path d="M7.5 7.5a6 6 0 0 1 9 5.2" />
          <path d="M5 11a8 8 0 0 1 14-5" />
          <path d="M9.5 12a2.5 2.5 0 0 1 5 0c0 2.5-.5 4.5-1 6" />
          <path d="M7 15c.3 1.5.3 3 0 4.5" />
        </svg>
      </div>

      <h1 className="mb-1 text-lg font-bold">FreteGO bloqueado</h1>
      <p className="mb-8 max-w-xs text-sm text-gray-300">
        Use sua digital ou reconhecimento facial para entrar.
      </p>

      <button
        type="button"
        onClick={() => void tryUnlock()}
        disabled={busy}
        className="w-full max-w-xs rounded-lg bg-green-600 py-3 text-sm font-bold text-white transition-all hover:bg-green-700 active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? 'Verificando...' : 'Desbloquear'}
      </button>

      <button
        type="button"
        onClick={useFallback}
        disabled={busy}
        className="mt-4 text-xs font-semibold text-gray-300 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
      >
        Entrar com senha ou código
      </button>
    </div>
  );
}
